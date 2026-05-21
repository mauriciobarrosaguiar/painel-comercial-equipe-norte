from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from src.persistencia import carregar_json, existe_persistido, salvar_json
from src.tratamento import slug_coluna


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
METAS_FILE = DATA_DIR / "metas_comerciais.json"
BUSSOLA_LOGIN_FILE = DATA_DIR / "bussola_login.local.json"
AJUSTES_VENDEDORES_FILE = DATA_DIR / "ajustes_vendedores.json"


METAS_PADRAO = {
    "gerente_territorial": {
        "ol_sem_combate": 0.0,
        "ol_prioritarios": 0.0,
        "ol_lancamentos": 0.0,
        "clientes_positivados": 0.0,
    },
    "consultores": {},
}


def _chave_persistencia(caminho: Path) -> str:
    if caminho == METAS_FILE:
        return "metas"
    if caminho == BUSSOLA_LOGIN_FILE:
        return "login_bussola"
    if caminho == AJUSTES_VENDEDORES_FILE:
        return "ajustes_vendedores"
    return ""


def _ler_json(caminho: Path, padrao: dict) -> dict:
    chave = _chave_persistencia(caminho)
    if chave and existe_persistido(chave):
        dados_persistidos = carregar_json(chave, padrao)
        return dados_persistidos if isinstance(dados_persistidos, dict) else padrao.copy()
    if not caminho.exists():
        return padrao.copy()
    try:
        dados = json.loads(caminho.read_text(encoding="utf-8"))
    except Exception:
        return padrao.copy()
    return dados if isinstance(dados, dict) else padrao.copy()


def _salvar_json(caminho: Path, dados: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    chave = _chave_persistencia(caminho)
    if chave:
        salvar_json(chave, dados, f"Atualiza {chave} pelo painel")


def carregar_metas() -> dict:
    dados = _ler_json(METAS_FILE, METAS_PADRAO)
    dados.setdefault("gerente_territorial", {})
    dados.setdefault("consultores", {})
    for chave, valor in METAS_PADRAO["gerente_territorial"].items():
        dados["gerente_territorial"].setdefault(chave, valor)
    return dados


def salvar_metas(dados: dict) -> None:
    _salvar_json(METAS_FILE, dados)


def carregar_login_bussola() -> dict:
    dados = _ler_json(BUSSOLA_LOGIN_FILE, {"gd": {}, "consultores": {}, "headless": False})
    if "consultores" not in dados:
        usuario = dados.get("usuario", "")
        senha = dados.get("senha", "")
        dados = {"gd": {}, "consultores": {"GERAL": {"usuario": usuario, "senha": senha}} if usuario or senha else {}, "headless": dados.get("headless", False)}
    dados.setdefault("gd", {})
    dados.setdefault("consultores", {})
    dados.setdefault("headless", False)
    return dados


def salvar_login_bussola(consultores: dict, headless: bool, gd: dict | None = None) -> None:
    _salvar_json(BUSSOLA_LOGIN_FILE, {"gd": gd or {}, "consultores": consultores, "headless": bool(headless)})


def carregar_ajustes_vendedores() -> list[dict]:
    dados = _ler_json(AJUSTES_VENDEDORES_FILE, {"ajustes": []})
    ajustes = dados.get("ajustes", []) if isinstance(dados, dict) else []
    return [ajuste for ajuste in ajustes if isinstance(ajuste, dict)]


def salvar_ajustes_vendedores(ajustes: list[dict]) -> None:
    ajustes_limpos = []
    for ajuste in ajustes:
        setor = str(ajuste.get("setor_rep", "") or "").strip()
        nome_atual = str(ajuste.get("nome_atual", "") or "").strip()
        nome_novo = str(ajuste.get("nome_novo", "") or "").strip()
        if not nome_novo or (not setor and not nome_atual):
            continue
        ajuste_id = str(ajuste.get("id", "") or "").strip() or slug_coluna(f"{setor}-{nome_atual}-{nome_novo}")
        ajustes_limpos.append(
            {
                "id": ajuste_id,
                "setor_rep": setor,
                "nome_atual": nome_atual,
                "nome_novo": nome_novo,
                "ativo": bool(ajuste.get("ativo", True)),
            }
        )
    _salvar_json(AJUSTES_VENDEDORES_FILE, {"ajustes": ajustes_limpos})


def aplicar_ajustes_vendedores(clientes: pd.DataFrame) -> pd.DataFrame:
    if clientes is None or clientes.empty or "nome_rep" not in clientes.columns:
        return clientes

    ajustes = carregar_ajustes_vendedores()
    base = clientes.copy()
    base["nome_rep_original"] = base["nome_rep"].fillna("").astype(str)
    base["vendedor_ajustado"] = False

    for ajuste in ajustes:
        if not ajuste.get("ativo", True):
            continue
        nome_novo = str(ajuste.get("nome_novo", "") or "").strip()
        if not nome_novo:
            continue

        mascara = pd.Series(False, index=base.index)
        setor = str(ajuste.get("setor_rep", "") or "").strip()
        nome_atual = str(ajuste.get("nome_atual", "") or "").strip()

        if setor and "setor_rep" in base.columns:
            mascara |= base["setor_rep"].fillna("").astype(str).str.strip().str.upper().eq(setor.upper())
        if nome_atual:
            mascara |= base["nome_rep_original"].fillna("").astype(str).str.strip().str.upper().eq(nome_atual.upper())

        base.loc[mascara, "nome_rep"] = nome_novo
        base.loc[mascara, "vendedor_ajustado"] = True

    return base


def consultores_unicos(clientes) -> list[str]:
    if clientes is None or clientes.empty or "nome_rep" not in clientes.columns:
        return []
    valores = clientes["nome_rep"].dropna().astype(str).str.strip()
    valores = valores[valores.ne("")]
    valores = valores[~valores.str.contains(r"\s*/\s*", regex=True, na=False)]
    mapa: dict[str, str] = {}
    for valor in valores:
        mapa.setdefault(" ".join(valor.upper().split()), valor)
    return [mapa[chave] for chave in sorted(mapa)]
