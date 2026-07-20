from __future__ import annotations

import os
import re
from datetime import datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

import requests
import streamlit as st


WORKFLOW_MIGRACAO = "migrar-bases-legadas-d1.yml"
TZ_BRASILIA = ZoneInfo("America/Sao_Paulo")


def _secret(nome: str, padrao: str = "") -> str:
    try:
        if nome in st.secrets:
            return str(st.secrets[nome])
    except Exception:
        pass
    return str(os.environ.get(nome, padrao) or padrao)


def configuracao_migracao() -> dict[str, object]:
    token = _secret("GITHUB_TOKEN")
    repo = _secret("GITHUB_REPO", "mauriciobarrosaguiar/painel-comercial-equipe-norte")
    branch = _secret("GITHUB_BRANCH", "main")
    persistence_key = _secret("PERSISTENCE_KEY")
    return {
        "token_configurado": bool(token),
        "repo": repo,
        "branch": branch,
        "chave_configurada": bool(persistence_key),
        "pronto": bool(token and repo and branch and persistence_key),
    }


def mes_atual() -> str:
    return datetime.now(TZ_BRASILIA).strftime("%Y-%m")


def disparar_migracao_bases(ano_mes: str) -> str:
    ano_mes = str(ano_mes or "").strip()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", ano_mes):
        raise RuntimeError("Informe o mês das metas no formato AAAA-MM.")

    token = _secret("GITHUB_TOKEN")
    repo = _secret("GITHUB_REPO", "mauriciobarrosaguiar/painel-comercial-equipe-norte")
    branch = _secret("GITHUB_BRANCH", "main")
    persistence_key = _secret("PERSISTENCE_KEY")

    faltantes = []
    if not token:
        faltantes.append("GITHUB_TOKEN")
    if not repo:
        faltantes.append("GITHUB_REPO")
    if not persistence_key:
        faltantes.append("PERSISTENCE_KEY")
    if faltantes:
        raise RuntimeError("Configuração ausente no painel antigo: " + ", ".join(faltantes))

    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    payload = {
        "ref": branch,
        "inputs": {
            "ano_mes": ano_mes,
            "persistence_key": persistence_key,
            "command_id": uuid4().hex,
        },
    }
    url = f"https://api.github.com/repos/{repo}/actions/workflows/{WORKFLOW_MIGRACAO}/dispatches"
    resposta = requests.post(url, headers=headers, json=payload, timeout=35)
    if resposta.status_code not in {201, 204}:
        detalhe = (resposta.text or "")[:600]
        raise RuntimeError(f"O GitHub não aceitou a migração ({resposta.status_code}): {detalhe}")

    return f"https://github.com/{repo}/actions/workflows/{WORKFLOW_MIGRACAO}"
