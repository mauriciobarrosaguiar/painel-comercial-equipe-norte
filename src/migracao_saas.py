from __future__ import annotations

import base64
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
import streamlit as st
from nacl import encoding, public


WORKFLOW_MIGRACAO = "migrar-bases-legadas-d1.yml"
TZ_BRASILIA = ZoneInfo("America/Sao_Paulo")


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
        "persistence_key": _secret("PERSISTENCE_KEY"),
    }


def _headers(token: str) -> dict[str, str]:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def configuracao_migracao() -> dict[str, object]:
    cfg = _config()
    return {
        "token_configurado": bool(cfg["token"]),
        "repo": cfg["repo"],
        "branch": cfg["branch"],
        "chave_configurada": bool(cfg["persistence_key"]),
        "pronto": bool(cfg["token"] and cfg["repo"] and cfg["branch"] and cfg["persistence_key"]),
    }


def mes_atual() -> str:
    return datetime.now(TZ_BRASILIA).strftime("%Y-%m")


def _salvar_persistence_key_como_secret(token: str, repo: str, persistence_key: str) -> None:
    headers = _headers(token)
    chave_url = f"https://api.github.com/repos/{repo}/actions/secrets/public-key"
    resposta_chave = requests.get(chave_url, headers=headers, timeout=35)
    if resposta_chave.status_code != 200:
        detalhe = (resposta_chave.text or "")[:500]
        raise RuntimeError(
            f"Não consegui preparar o secret no GitHub ({resposta_chave.status_code}). "
            f"O token do painel antigo precisa ter permissão de administrador no repositório. {detalhe}"
        )

    dados_chave = resposta_chave.json()
    public_key = public.PublicKey(str(dados_chave["key"]).encode("utf-8"), encoding.Base64Encoder())
    sealed_box = public.SealedBox(public_key)
    criptografado = sealed_box.encrypt(persistence_key.encode("utf-8"))
    encrypted_value = base64.b64encode(criptografado).decode("utf-8")

    secret_url = f"https://api.github.com/repos/{repo}/actions/secrets/PERSISTENCE_KEY"
    resposta_secret = requests.put(
        secret_url,
        headers=headers,
        json={"encrypted_value": encrypted_value, "key_id": dados_chave["key_id"]},
        timeout=35,
    )
    if resposta_secret.status_code not in {201, 204}:
        detalhe = (resposta_secret.text or "")[:500]
        raise RuntimeError(
            f"Não consegui salvar PERSISTENCE_KEY nos Secrets do GitHub "
            f"({resposta_secret.status_code}): {detalhe}"
        )


def disparar_migracao_bases(ano_mes: str) -> str:
    ano_mes = str(ano_mes or "").strip()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", ano_mes):
        raise RuntimeError("Informe o mês das metas no formato AAAA-MM.")

    cfg = _config()
    faltantes = []
    if not cfg["token"]:
        faltantes.append("GITHUB_TOKEN")
    if not cfg["repo"]:
        faltantes.append("GITHUB_REPO")
    if not cfg["persistence_key"]:
        faltantes.append("PERSISTENCE_KEY")
    if faltantes:
        raise RuntimeError("Configuração ausente no painel antigo: " + ", ".join(faltantes))

    _salvar_persistence_key_como_secret(cfg["token"], cfg["repo"], cfg["persistence_key"])

    payload = {
        "ref": cfg["branch"],
        "inputs": {"ano_mes": ano_mes},
    }
    url = f"https://api.github.com/repos/{cfg['repo']}/actions/workflows/{WORKFLOW_MIGRACAO}/dispatches"
    resposta = requests.post(url, headers=_headers(cfg["token"]), json=payload, timeout=35)
    if resposta.status_code not in {201, 204}:
        detalhe = (resposta.text or "")[:600]
        raise RuntimeError(f"O GitHub não aceitou a migração ({resposta.status_code}): {detalhe}")

    return f"https://github.com/{cfg['repo']}/actions/workflows/{WORKFLOW_MIGRACAO}"
