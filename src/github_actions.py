from __future__ import annotations

import os
from typing import Any

import requests
import streamlit as st


WORKFLOW_MERCADO_FARMA = "mercadofarma.yml"


def _secret(nome: str, padrao: str = "") -> str:
    try:
        if nome in st.secrets:
            return str(st.secrets[nome])
    except Exception:
        pass
    return str(os.environ.get(nome, padrao) or padrao)


def _config() -> dict[str, str]:
    return {
        "token": _secret("GITHUB_TOKEN"),
        "repo": _secret("GITHUB_REPO", "mauriciobarrosaguiar/painel-comercial-equipe-norte"),
        "branch": _secret("GITHUB_BRANCH", "main"),
    }


def _headers() -> dict[str, str]:
    token = _config()["token"]
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def github_actions_disponivel() -> bool:
    cfg = _config()
    return bool(cfg["token"] and cfg["repo"])


def disparar_mercado_farma(ufs: list[str], limite_eans: int = 0) -> None:
    cfg = _config()
    if not github_actions_disponivel():
        raise RuntimeError("Configure GITHUB_TOKEN e GITHUB_REPO nos Secrets para disparar o GitHub Actions.")
    ufs_txt = ",".join(str(uf).strip().upper() for uf in ufs if str(uf).strip())
    payload = {
        "ref": cfg["branch"],
        "inputs": {
            "acao": "atualizar_mercadofarma_paralelo",
            "ufs": ufs_txt,
            "limite_eans": str(int(limite_eans or 0)),
        },
    }
    url = f"https://api.github.com/repos/{cfg['repo']}/actions/workflows/{WORKFLOW_MERCADO_FARMA}/dispatches"
    resp = requests.post(url, headers=_headers(), json=payload, timeout=30)
    if resp.status_code not in {204, 201}:
        detalhe = resp.text[:500]
        raise RuntimeError(f"GitHub Actions não aceitou o disparo ({resp.status_code}): {detalhe}")


def listar_execucoes_mercado_farma(limite: int = 5) -> list[dict[str, Any]]:
    cfg = _config()
    if not github_actions_disponivel():
        return []
    url = f"https://api.github.com/repos/{cfg['repo']}/actions/workflows/{WORKFLOW_MERCADO_FARMA}/runs"
    resp = requests.get(url, headers=_headers(), params={"per_page": max(1, min(limite, 20))}, timeout=30)
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    dados = resp.json()
    runs = dados.get("workflow_runs", []) if isinstance(dados, dict) else []
    return runs if isinstance(runs, list) else []
