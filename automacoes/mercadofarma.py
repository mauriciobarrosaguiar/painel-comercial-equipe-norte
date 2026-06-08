from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.configuracoes import carregar_login_bussola
from src.datas import agora_brasilia
from src.loader import carregar_dados_tratados
from src.mercado_farma import (
    _extrair_alvo,
    alvos_mercadofarma_por_uf,
    carregar_credenciais_mercadofarma,
    mascarar_usuario,
    obter_eans_para_consulta,
    preparar_mercado_farma,
)


COLUNAS_CSV = {
    "uf": "UF",
    "consultor": "CONSULTOR_USADO",
    "cnpj_referencia": "CNPJ_REFERENCIA",
    "ean": "EAN",
    "produto": "PRODUTO",
    "distribuidora": "DISTRIBUIDORA",
    "estoque": "ESTOQUE",
    "desconto": "DESCONTO",
    "pf_dist": "PF_DIST",
    "pf_fabrica": "PF_FABRICA",
    "preco_com_imposto": "PRECO_COM_IMPOSTO",
    "preco_sem_imposto": "PRECO_SEM_IMPOSTO",
    "data_atualizacao": "DATA_ATUALIZACAO",
    "status": "STATUS",
    "erro": "ERRO",
}


def _log(msg: str) -> None:
    print(msg, flush=True)


def _salvar_status(path: Path, status: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")


def _csv_saida(df: pd.DataFrame) -> pd.DataFrame:
    base = preparar_mercado_farma(df)
    saida = base.rename(columns=COLUNAS_CSV)
    for coluna in COLUNAS_CSV.values():
        if coluna not in saida.columns:
            saida[coluna] = ""
    return saida[list(COLUNAS_CSV.values())]


def _rodando_no_actions() -> bool:
    return os.environ.get("GITHUB_ACTIONS", "").lower() == "true"


def _persistence_key_configurada() -> bool:
    return bool(os.environ.get("PERSISTENCE_KEY"))


def _validar_bases_carregadas(clientes: pd.DataFrame, produtos_mercado: pd.DataFrame) -> None:
    faltantes = []
    if clientes is None or clientes.empty:
        faltantes.append("clientes")
    if produtos_mercado is None or produtos_mercado.empty:
        faltantes.append("produtos_mercado_farma")
    if not faltantes:
        return
    if _rodando_no_actions() and not _persistence_key_configurada():
        raise RuntimeError(
            "PERSISTENCE_KEY nao esta configurado nos Secrets do GitHub Actions. "
            "Sem essa chave nao consegui ler clientes/produtos salvos no painel: " + ", ".join(faltantes)
        )
    raise RuntimeError("Nao consegui carregar as bases obrigatorias: " + ", ".join(faltantes))


def main() -> int:
    parser = argparse.ArgumentParser(description="Extrai Mercado Farma para uma UF.")
    parser.add_argument("--uf", required=True, help="UF que sera extraida, ex.: MA")
    parser.add_argument("--saida", default="data/mercadofarma/parciais", help="Pasta dos arquivos parciais")
    parser.add_argument("--limite-eans", type=int, default=0, help="Limite para teste. 0 consulta todos.")
    parser.add_argument("--visivel", action="store_true", help="Executa navegador visivel.")
    args = parser.parse_args()

    uf = args.uf.strip().upper()
    saida_dir = ROOT / args.saida
    status_dir = ROOT / "data" / "mercadofarma" / "status"
    debug_dir = ROOT / "data" / "mercadofarma" / "debug" / uf
    csv_path = saida_dir / f"mercadofarma_{uf}.csv"
    status_path = status_dir / f"mercadofarma_{uf}.json"
    status = {
        "uf": uf,
        "status": "erro",
        "consultor_usado": "GD",
        "cnpj_referencia": "",
        "usuario_mascarado": "",
        "total_eans": 0,
        "total_produtos": 0,
        "erro": "",
        "etapa": "inicio",
        "traceback": "",
        "iniciado_em": agora_brasilia().isoformat(),
        "finalizado_em": "",
    }

    try:
        _log(f"Iniciando extracao Mercado Farma para UF {uf}")
        if csv_path.exists():
            csv_path.unlink()

        status["etapa"] = "carregar_acesso_gd"
        login = carregar_login_bussola()
        credencial_gd = carregar_credenciais_mercadofarma(login, exigir=True)
        usuario_gd = str(credencial_gd.get("usuario", ""))
        senha_gd = str(credencial_gd.get("senha", ""))
        status["usuario_mascarado"] = mascarar_usuario(usuario_gd)
        _log(f"UF: {uf}")
        _log(f"Usuario Mercado Farma: {status['usuario_mascarado'] or 'nao informado'}")

        status["etapa"] = "carregar_bases"
        dados = carregar_dados_tratados()
        clientes = dados["clientes"]
        produtos_mercado = dados["produtos_mercado_farma"]
        _validar_bases_carregadas(clientes, produtos_mercado)

        status["etapa"] = "montar_alvos"
        alvos = [alvo for alvo in alvos_mercadofarma_por_uf(clientes, usuario_gd, senha_gd) if alvo.get("uf") == uf]
        if not alvos:
            raise RuntimeError(f"Não encontrei CNPJ referência ativo para UF {uf}.")
        alvo = alvos[0]
        status["consultor_usado"] = alvo.get("consultor", "")
        status["cnpj_referencia"] = alvo.get("cnpj", "")
        candidatos = alvo.get("cnpjs_candidatos", [])
        if isinstance(candidatos, list):
            status["cnpjs_candidatos"] = candidatos
        _log(f"Consultor usado: {status['consultor_usado']}")
        _log(f"CNPJ referencia: {status['cnpj_referencia']}")
        if isinstance(candidatos, list) and len(candidatos) > 1:
            _log(f"CNPJs candidatos na UF {uf}: {len(candidatos)}")

        status["etapa"] = "carregar_eans"
        eans = obter_eans_para_consulta(produtos_mercado)
        if args.limite_eans:
            eans = eans[: args.limite_eans]
        if not eans:
            raise RuntimeError("Nenhum EAN encontrado na planilha produtos.xlsx.")
        status["total_eans"] = len(eans)
        _log(f"Total de EANs carregados: {len(eans)}")

        resultados: list[dict] = []
        status["etapa"] = "login"
        _log("Etapa atual: login")
        status["etapa"] = "extracao_mercado_farma"
        _extrair_alvo(alvo, eans, headless=not args.visivel, resultados=resultados, log_fn=_log, debug_dir=debug_dir)
        status["cnpj_referencia"] = alvo.get("cnpj", status["cnpj_referencia"])
        status["etapa"] = "salvar_arquivo"
        _log("Etapa atual: salvar arquivo")
        df = _csv_saida(pd.DataFrame(resultados))
        saida_dir.mkdir(parents=True, exist_ok=True)
        df.to_csv(csv_path, index=False, encoding="utf-8-sig")
        total = int(df["EAN"].dropna().astype(str).nunique()) if "EAN" in df.columns else len(df)
        status.update({"status": "sucesso", "total_produtos": total, "arquivo": str(csv_path.relative_to(ROOT)), "etapa": "concluido"})
        _log(f"Total de produtos extraidos: {total}")
        _log("Arquivo parcial salvo com sucesso")
        status["finalizado_em"] = agora_brasilia().isoformat()
        _salvar_status(status_path, status)
        return 0
    except Exception as exc:
        status["erro"] = str(exc)
        status["traceback"] = traceback.format_exc(limit=8)
        status["finalizado_em"] = agora_brasilia().isoformat()
        _log(f"Erro na extracao Mercado Farma UF {uf}: {exc}")
        _log(status["traceback"])
        _salvar_status(status_path, status)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
