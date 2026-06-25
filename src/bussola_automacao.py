from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator

import pandas as pd

from src.bussola_web import extrair_bussola_web_todos
from src.configuracoes import carregar_login_bussola, carregar_metas
from src.historico import sincronizar_metas_historico_meses_fechados
from src.loader import DATA_DIR, carregar_dados_tratados
from src.persistencia import salvar_json

ROOT_DIR = Path(__file__).resolve().parents[1]
LOCK_FILE = DATA_DIR / ".extracao_bussola_auto.lock"
LOCK_TTL_SECONDS = int(os.environ.get("BUSSOLA_LOCK_TTL_SECONDS", "7200"))


@dataclass
class ExtracaoAutomaticaResultado:
    sucesso: bool
    destino: str = ""
    credenciais_usadas: int = 0
    logs: list[str] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)


def _agora_iso() -> str:
    try:
        from src.datas import agora_brasilia

        return agora_brasilia().isoformat()
    except Exception:
        return pd.Timestamp.now(tz="America/Sao_Paulo").isoformat()


def _registrar_status(status: str, logs: list[str], destino: str = "", erro: str = "") -> None:
    payload = {
        "status": status,
        "updated_at": _agora_iso(),
        "destino": destino,
        "erro": erro,
        "ultimos_logs": logs[-80:],
    }
    try:
        salvar_json("bussola_auto_status", payload, "Atualiza status da extração automática Bússola")
    except Exception:
        # Status não pode derrubar a extração.
        pass


def _adicionar_log(logs: list[str], log_fn: Callable[[str], None] | None, msg: str) -> None:
    logs.append(msg)
    if callable(log_fn):
        log_fn(msg)


def _nome_gd_atual() -> str:
    try:
        dados = carregar_dados_tratados()
        clientes = dados.get("clientes")
        if clientes is None or clientes.empty or "nome_gd" not in clientes.columns:
            return "Gerente Distrital"
        nomes = clientes["nome_gd"].dropna().astype(str).str.strip()
        nomes = nomes[nomes.ne("")]
        if nomes.empty:
            return "Gerente Distrital"
        return str(nomes.iloc[0])
    except Exception:
        return "Gerente Distrital"


def montar_credenciais_bussola(login: dict | None = None, nome_gd: str | None = None) -> tuple[list[dict[str, str]], list[str]]:
    """Monta a mesma lista de credenciais usada pelo botão manual do Streamlit."""
    login = login or carregar_login_bussola()
    avisos: list[str] = []

    gd = login.get("gd", {}) if isinstance(login.get("gd", {}), dict) else {}
    gd_usuario = str(gd.get("usuario", "") or "").strip()
    gd_senha = str(gd.get("senha", "") or "").strip()
    usar_gd = bool(gd.get("usar_gd", True))

    if usar_gd and gd_usuario and gd_senha:
        nome = (nome_gd or _nome_gd_atual() or "Gerente Distrital").strip()
        return ([{"consultor": f"GD - {nome}", "usuario": gd_usuario, "senha": gd_senha}], avisos)

    if usar_gd and (gd_usuario or gd_senha):
        avisos.append("Acesso da GD marcado, mas login ou senha estão incompletos; usando consultores marcados.")

    consultores = login.get("consultores", {}) if isinstance(login.get("consultores", {}), dict) else {}
    solicitados: list[dict[str, str]] = []
    incompletos: list[str] = []

    for consultor, item in consultores.items():
        if not isinstance(item, dict):
            continue
        if not bool(item.get("extrair", True)):
            continue
        usuario = str(item.get("usuario", "") or "").strip()
        senha = str(item.get("senha", "") or "").strip()
        nome_consultor = str(consultor or "Consultor sem nome").strip()
        if usuario and senha:
            solicitados.append({"consultor": nome_consultor, "usuario": usuario, "senha": senha})
        else:
            incompletos.append(nome_consultor)

    if incompletos:
        avisos.append("Sem login/senha, estes consultores foram ignorados: " + ", ".join(incompletos))
    return solicitados, avisos


@contextmanager
def trava_extracao(lock_file: Path = LOCK_FILE) -> Iterator[None]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if lock_file.exists():
        try:
            dados = json.loads(lock_file.read_text(encoding="utf-8"))
            criado_em = float(dados.get("time", 0) or 0)
        except Exception:
            criado_em = 0
        idade = time.time() - criado_em if criado_em else LOCK_TTL_SECONDS + 1
        if idade < LOCK_TTL_SECONDS:
            raise RuntimeError("Já existe uma extração Bússola em andamento. Abortando para não duplicar execução.")
        try:
            lock_file.unlink()
        except FileNotFoundError:
            pass

    lock_payload = {"pid": os.getpid(), "time": time.time(), "created_at": _agora_iso()}
    lock_file.write_text(json.dumps(lock_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        yield
    finally:
        try:
            lock_file.unlink()
        except FileNotFoundError:
            pass


def sincronizar_historico_apos_extracao(logs: list[str], log_fn: Callable[[str], None] | None = None) -> None:
    try:
        dados_atualizados = carregar_dados_tratados()
        resultado = sincronizar_metas_historico_meses_fechados(
            dados_atualizados["vendas"],
            carregar_metas(),
        )
        meses = resultado.get("meses_atualizados") or []
        if meses:
            msg = "Histórico sincronizado: " + ", ".join(str(mes) for mes in meses)
        else:
            msg = "Histórico: nenhum mês fechado para atualizar."
        _adicionar_log(logs, log_fn, msg)
    except Exception as exc:
        _adicionar_log(logs, log_fn, f"Aviso: extração concluída, mas o histórico não foi sincronizado: {exc}")


def executar_extracao_bussola_automatica(
    *,
    headless: bool = True,
    log_fn: Callable[[str], None] | None = None,
    usar_lock: bool = True,
) -> ExtracaoAutomaticaResultado:
    logs: list[str] = []
    avisos: list[str] = []

    def _rodar() -> ExtracaoAutomaticaResultado:
        _adicionar_log(logs, log_fn, "Iniciando extração automática da Bússola.")

        if not os.environ.get("PERSISTENCE_KEY") and not (DATA_DIR / "bussola_login.local.json").exists():
            raise RuntimeError(
                "PERSISTENCE_KEY não está configurada no GitHub Actions. "
                "Adicione o mesmo valor usado no Streamlit Secrets em Settings > Secrets and variables > Actions."
            )

        login = carregar_login_bussola()
        nome_gd = _nome_gd_atual()
        credenciais, avisos_credenciais = montar_credenciais_bussola(login, nome_gd=nome_gd)
        avisos.extend(avisos_credenciais)
        for aviso in avisos_credenciais:
            _adicionar_log(logs, log_fn, "Aviso: " + aviso)

        if not credenciais:
            raise RuntimeError("Nenhum acesso Bússola válido encontrado para extração automática.")

        _adicionar_log(logs, log_fn, f"Credenciais válidas para extração: {len(credenciais)}.")
        destino = extrair_bussola_web_todos(credenciais, headless=headless, log_fn=lambda msg: _adicionar_log(logs, log_fn, msg))
        _adicionar_log(logs, log_fn, f"Base consolidada atualizada: {destino}")
        sincronizar_historico_apos_extracao(logs, log_fn=log_fn)
        _registrar_status("sucesso", logs, destino=str(destino))
        return ExtracaoAutomaticaResultado(True, str(destino), len(credenciais), list(logs), list(avisos))

    try:
        if usar_lock:
            with trava_extracao():
                return _rodar()
        return _rodar()
    except Exception as exc:
        mensagem = str(exc)
        _adicionar_log(logs, log_fn, f"Erro na extração automática: {mensagem}")
        _registrar_status("erro", logs, erro=mensagem)
        raise
