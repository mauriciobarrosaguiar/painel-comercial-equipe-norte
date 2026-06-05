from __future__ import annotations

import base64
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
import streamlit as st

from src.datas import datetime_arquivo_brasilia, formatar_datahora_brasil


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
LOCAL_STORE_DIR = DATA_DIR / "_persistencia_local"

ARQUIVOS = {
    "bussola": "bussola.xlsx",
    "painel": "painel_clientes.xlsx",
    "acoes": "template_acoes_promocionais.xlsx",
    "produtos_mix": "template_produtos_mix.xlsx",
    "mercado_farma": "mercado_farma.xlsx",
    "produtos_mercado_farma": "produtos.xlsx",
    "bussola_historico": "bussola_historico.xlsx",
}

ARQUIVOS_PADRAO = {
    "bussola": DATA_DIR / "bussola.xlsx",
    "painel": DATA_DIR / "PAINEL EQUIPE NORTE.xlsx",
    "acoes": DATA_DIR / "template_acoes_promocionais.xlsx",
    "produtos_mix": DATA_DIR / "template_produtos_mix.xlsx",
    "mercado_farma": DATA_DIR / "mercado_farma.xlsx",
    "produtos_mercado_farma": DATA_DIR / "produtos.xlsx",
    "bussola_historico": DATA_DIR / "bussola_historico.xlsx",
}
MERCADO_FARMA_CONSOLIDADO = DATA_DIR / "mercadofarma" / "mercadofarma_consolidado.csv"


def _secret(nome: str, padrao: str = "") -> str:
    try:
        if nome in st.secrets:
            return str(st.secrets[nome])
    except Exception:
        pass
    return str(os.environ.get(nome, padrao) or padrao)


def _github_config() -> dict[str, str]:
    return {
        "token": _secret("GITHUB_TOKEN"),
        "repo": _secret("GITHUB_REPO", "mauriciobarrosaguiar/painel-comercial-equipe-norte"),
        "branch": _secret("GITHUB_STORAGE_BRANCH", "app-storage"),
        "dir": _secret("GITHUB_STORE_DIR", ".app_storage"),
    }


def _headers() -> dict[str, str]:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {_github_config()['token']}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _caminho_storage(chave: str) -> str:
    cfg = _github_config()
    return f"{cfg['dir'].strip('/')}/{ARQUIVOS[chave]}.fernet"


def _github_commit_at(chave: str) -> str | None:
    cfg = _github_config()
    if not cfg["token"] or not cfg["repo"] or chave not in ARQUIVOS:
        return None
    url = f"https://api.github.com/repos/{cfg['repo']}/commits"
    params = {"sha": cfg["branch"], "path": _caminho_storage(chave), "per_page": 1}
    resp = requests.get(url, headers=_headers(), params=params, timeout=20)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    dados = resp.json()
    if not isinstance(dados, list) or not dados:
        return None
    commit = dados[0].get("commit", {}) if isinstance(dados[0], dict) else {}
    committer = commit.get("committer", {}) if isinstance(commit, dict) else {}
    return committer.get("date")


def _github_metadata(chave: str) -> str | None:
    cfg = _github_config()
    if not cfg["token"] or not cfg["repo"]:
        return None
    path = f"{cfg['dir'].strip('/')}/metadata.json.fernet"
    url = f"https://api.github.com/repos/{cfg['repo']}/contents/{path}"
    resp = requests.get(url, headers=_headers(), params={"ref": cfg["branch"]}, timeout=20)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    dados: Any = resp.json()
    if not isinstance(dados, dict) or not dados.get("content"):
        return None
    try:
        from cryptography.fernet import Fernet
        import hashlib
        import json

        chave_secret = _secret("PERSISTENCE_KEY")
        try:
            fernet = Fernet(chave_secret.encode("utf-8"))
        except Exception:
            derivada = base64.urlsafe_b64encode(hashlib.sha256(chave_secret.encode("utf-8")).digest())
            fernet = Fernet(derivada)
        bruto = base64.b64decode(str(dados["content"]).replace("\n", ""))
        metadados = json.loads(fernet.decrypt(bruto).decode("utf-8"))
    except Exception:
        return None
    item = metadados.get(chave, {}) if isinstance(metadados, dict) else {}
    return item.get("updated_at") if isinstance(item, dict) else None


def ultima_atualizacao_base(chave: str) -> object | None:
    if chave not in ARQUIVOS:
        return None

    if chave == "mercado_farma" and MERCADO_FARMA_CONSOLIDADO.exists():
        return datetime_arquivo_brasilia(MERCADO_FARMA_CONSOLIDADO)

    local = LOCAL_STORE_DIR / ARQUIVOS[chave]
    if local.exists():
        return datetime_arquivo_brasilia(local)

    try:
        metadata = _github_metadata(chave)
    except requests.exceptions.RequestException:
        metadata = None
    if metadata:
        return metadata

    try:
        commit_at = _github_commit_at(chave)
    except requests.exceptions.RequestException:
        commit_at = None
    if commit_at:
        return commit_at

    padrao = ARQUIVOS_PADRAO.get(chave)
    if padrao and padrao.exists():
        return datetime_arquivo_brasilia(padrao)
    return None


def formatar_ultima_atualizacao(chave: str) -> str:
    return formatar_datahora_brasil(ultima_atualizacao_base(chave))
