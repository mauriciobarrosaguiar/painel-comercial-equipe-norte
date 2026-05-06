from __future__ import annotations

import json
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
METAS_FILE = DATA_DIR / "metas_comerciais.json"
BUSSOLA_LOGIN_FILE = DATA_DIR / "bussola_login.local.json"


METAS_PADRAO = {
    "gerente_territorial": {
        "ol_sem_combate": 0.0,
        "ol_prioritarios": 0.0,
        "ol_lancamentos": 0.0,
        "clientes_positivados": 0.0,
    },
    "consultores": {},
}


def _ler_json(caminho: Path, padrao: dict) -> dict:
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
    dados = _ler_json(BUSSOLA_LOGIN_FILE, {"consultores": {}, "headless": False})
    if "consultores" not in dados:
        usuario = dados.get("usuario", "")
        senha = dados.get("senha", "")
        dados = {"consultores": {"GERAL": {"usuario": usuario, "senha": senha}} if usuario or senha else {}, "headless": dados.get("headless", False)}
    dados.setdefault("consultores", {})
    dados.setdefault("headless", False)
    return dados


def salvar_login_bussola(consultores: dict, headless: bool) -> None:
    _salvar_json(BUSSOLA_LOGIN_FILE, {"consultores": consultores, "headless": bool(headless)})


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
