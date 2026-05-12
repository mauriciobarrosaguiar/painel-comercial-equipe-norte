from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import requests
import streamlit as st
from cryptography.fernet import Fernet

from src.datas import datetime_arquivo_brasilia, formatar_datahora_brasil, agora_brasilia


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
LOCAL_STORE_DIR = DATA_DIR / "_persistencia_local"

ARQUIVOS_BINARIOS = {
    "bussola": "bussola.xlsx",
    "painel": "painel_clientes.xlsx",
    "acoes": "template_acoes_promocionais.xlsx",
    "produtos_mix": "template_produtos_mix.xlsx",
    "mercado_farma": "mercado_farma.xlsx",
    "produtos_mercado_farma": "produtos.xlsx",
}

ARQUIVOS_JSON = {
    "metas": "metas_comerciais.json",
    "login_bussola": "bussola_login.json",
    "sip": "sip_grupos.json",
    "metadata": "metadata.json",
    "desafio": "desafio_gigantes.json",
}

ARQUIVOS_PADRAO_DATA = {
    "bussola": DATA_DIR / "bussola.xlsx",
    "painel": DATA_DIR / "PAINEL EQUIPE NORTE.xlsx",
    "acoes": DATA_DIR / "template_acoes_promocionais.xlsx",
    "produtos_mix": DATA_DIR / "template_produtos_mix.xlsx",
    "mercado_farma": DATA_DIR / "mercado_farma.xlsx",
    "produtos_mercado_farma": DATA_DIR / "produtos.xlsx",
}


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
        "source_branch": _secret("GITHUB_SOURCE_BRANCH", _secret("GITHUB_BRANCH", "main")),
        "dir": _secret("GITHUB_STORE_DIR", ".app_storage"),
        "key": _secret("PERSISTENCE_KEY"),
    }


def persistencia_github_ativa() -> bool:
    cfg = _github_config()
    return bool(cfg["token"] and cfg["repo"] and cfg["branch"] and cfg["key"])


def status_persistencia() -> dict[str, str]:
    cfg = _github_config()
    if persistencia_github_ativa():
        return {
            "modo": "GitHub criptografado",
            "detalhe": f"{cfg['repo']} / {cfg['dir']} / branch {cfg['branch']}",
            "ok": "sim",
        }
    faltantes = []
    if not cfg["token"]:
        faltantes.append("GITHUB_TOKEN")
    if not cfg["key"]:
        faltantes.append("PERSISTENCE_KEY")
    return {
        "modo": "Local temporário",
        "detalhe": "Sem Secrets: " + ", ".join(faltantes),
        "ok": "não",
    }


def _fernet() -> Fernet:
    chave = _github_config()["key"]
    if not chave:
        raise RuntimeError("Configure PERSISTENCE_KEY nos Secrets do Streamlit para salvar no GitHub.")
    try:
        return Fernet(chave.encode("utf-8"))
    except Exception:
        derivada = base64.urlsafe_b64encode(hashlib.sha256(chave.encode("utf-8")).digest())
        return Fernet(derivada)


def gerar_chave_persistencia() -> str:
    return Fernet.generate_key().decode("utf-8")


def _nome_arquivo(chave: str) -> str:
    if chave in ARQUIVOS_BINARIOS:
        return ARQUIVOS_BINARIOS[chave]
    if chave in ARQUIVOS_JSON:
        return ARQUIVOS_JSON[chave]
    raise KeyError(f"Chave de persistência desconhecida: {chave}")


def _caminho_local(chave: str) -> Path:
    return LOCAL_STORE_DIR / _nome_arquivo(chave)


def _caminho_github(chave: str) -> str:
    cfg = _github_config()
    nome = _nome_arquivo(chave)
    return f"{cfg['dir'].strip('/')}/{nome}.fernet"


def _headers() -> dict[str, str]:
    token = _github_config()["token"]
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _github_get_ref(branch: str) -> dict[str, Any] | None:
    cfg = _github_config()
    url = f"https://api.github.com/repos/{cfg['repo']}/git/ref/heads/{branch}"
    resp = requests.get(url, headers=_headers(), timeout=30)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    dados = resp.json()
    return dados if isinstance(dados, dict) else None


def _garantir_branch_storage() -> None:
    cfg = _github_config()
    if _github_get_ref(cfg["branch"]):
        return

    origem = _github_get_ref(cfg["source_branch"])
    if not origem:
        raise RuntimeError(f"Branch de origem {cfg['source_branch']} não encontrada para criar {cfg['branch']}.")
    sha_origem = origem.get("object", {}).get("sha")
    if not sha_origem:
        raise RuntimeError(f"Não consegui identificar o commit da branch {cfg['source_branch']}.")

    url = f"https://api.github.com/repos/{cfg['repo']}/git/refs"
    payload = {"ref": f"refs/heads/{cfg['branch']}", "sha": sha_origem}
    resp = requests.post(url, headers=_headers(), json=payload, timeout=30)
    if resp.status_code not in {201, 422}:
        resp.raise_for_status()


def _github_get(path: str) -> dict[str, Any] | None:
    cfg = _github_config()
    url = f"https://api.github.com/repos/{cfg['repo']}/contents/{path}"
    resp = requests.get(url, headers=_headers(), params={"ref": cfg["branch"]}, timeout=30)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    dados = resp.json()
    return dados if isinstance(dados, dict) else None


def _github_commit_at(path: str) -> str | None:
    cfg = _github_config()
    url = f"https://api.github.com/repos/{cfg['repo']}/commits"
    params = {"sha": cfg["branch"], "path": path, "per_page": 1}
    resp = requests.get(url, headers=_headers(), params=params, timeout=30)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    dados = resp.json()
    if not isinstance(dados, list) or not dados:
        return None
    commit = dados[0].get("commit", {}) if isinstance(dados[0], dict) else {}
    committer = commit.get("committer", {}) if isinstance(commit, dict) else {}
    return committer.get("date")


def _github_read(chave: str) -> bytes | None:
    dados = _github_get(_caminho_github(chave))
    if not dados or not dados.get("content"):
        return None
    criptografado = base64.b64decode(str(dados["content"]).replace("\n", ""))
    return _fernet().decrypt(criptografado)


def _github_write(chave: str, conteudo: bytes, mensagem: str) -> None:
    cfg = _github_config()
    _garantir_branch_storage()
    path = _caminho_github(chave)
    criptografado = _fernet().encrypt(conteudo)
    url = f"https://api.github.com/repos/{cfg['repo']}/contents/{path}"

    ultimo_erro: requests.Response | None = None
    for _ in range(2):
        existente = _github_get(path)
        payload: dict[str, Any] = {
            "message": mensagem,
            "content": base64.b64encode(criptografado).decode("ascii"),
            "branch": cfg["branch"],
        }
        if existente and existente.get("sha"):
            payload["sha"] = existente["sha"]
        resp = requests.put(url, headers=_headers(), json=payload, timeout=60)
        if resp.status_code in {200, 201}:
            return
        ultimo_erro = resp
        if resp.status_code not in {409, 422}:
            break
    if ultimo_erro is not None:
        ultimo_erro.raise_for_status()


def carregar_bytes(chave: str) -> bytes | None:
    if persistencia_github_ativa():
        try:
            dados = _github_read(chave)
            if dados:
                return dados
        except Exception as exc:
            st.warning(f"Não consegui ler a persistência no GitHub ({chave}): {exc}")
    caminho = _caminho_local(chave)
    if caminho.exists():
        return caminho.read_bytes()
    return None


def carregar_metadados() -> dict[str, Any]:
    dados = carregar_bytes("metadata")
    if not dados:
        return {}
    try:
        carregado = json.loads(dados.decode("utf-8"))
    except Exception:
        return {}
    return carregado if isinstance(carregado, dict) else {}


def _salvar_metadados(dados: dict[str, Any]) -> None:
    conteudo = json.dumps(dados, ensure_ascii=False, indent=2).encode("utf-8")
    LOCAL_STORE_DIR.mkdir(parents=True, exist_ok=True)
    _caminho_local("metadata").write_bytes(conteudo)
    if persistencia_github_ativa():
        _github_write("metadata", conteudo, "Atualiza controle de atualizacoes pelo painel")


def _registrar_atualizacao(chave: str, mensagem: str | None = None) -> None:
    if chave == "metadata":
        return
    try:
        metadados = carregar_metadados()
        metadados[chave] = {
            "updated_at": agora_brasilia().isoformat(),
            "arquivo": _nome_arquivo(chave),
            "mensagem": mensagem or f"Atualiza {chave} pelo painel",
        }
        _salvar_metadados(metadados)
    except Exception as exc:
        st.warning(f"Base salva, mas não consegui atualizar o horário fixo ({chave}): {exc}")


def salvar_bytes(chave: str, conteudo: bytes, mensagem: str | None = None) -> None:
    LOCAL_STORE_DIR.mkdir(parents=True, exist_ok=True)
    _caminho_local(chave).write_bytes(conteudo)
    mensagem_final = mensagem or f"Atualiza {chave} pelo painel"
    if persistencia_github_ativa():
        _github_write(chave, conteudo, mensagem_final)
    _registrar_atualizacao(chave, mensagem_final)


def carregar_json(chave: str, padrao: Any) -> Any:
    dados = carregar_bytes(chave)
    if not dados:
        return padrao.copy() if isinstance(padrao, dict) else list(padrao) if isinstance(padrao, list) else padrao
    try:
        return json.loads(dados.decode("utf-8"))
    except Exception:
        return padrao.copy() if isinstance(padrao, dict) else list(padrao) if isinstance(padrao, list) else padrao


def salvar_json(chave: str, dados: Any, mensagem: str | None = None) -> None:
    conteudo = json.dumps(dados, ensure_ascii=False, indent=2).encode("utf-8")
    salvar_bytes(chave, conteudo, mensagem or f"Atualiza {chave} pelo painel")


def existe_persistido(chave: str) -> bool:
    if persistencia_github_ativa():
        try:
            return _github_get(_caminho_github(chave)) is not None
        except Exception:
            return False
    return _caminho_local(chave).exists()


def ultima_atualizacao(chave: str) -> object | None:
    metadados = carregar_metadados()
    item = metadados.get(chave, {}) if isinstance(metadados, dict) else {}
    if isinstance(item, dict) and item.get("updated_at"):
        return item["updated_at"]

    caminho_local = _caminho_local(chave)
    if caminho_local.exists():
        return datetime_arquivo_brasilia(caminho_local)

    caminho_padrao = ARQUIVOS_PADRAO_DATA.get(chave)
    if caminho_padrao and caminho_padrao.exists():
        return datetime_arquivo_brasilia(caminho_padrao)

    if persistencia_github_ativa():
        try:
            return _github_commit_at(_caminho_github(chave))
        except Exception:
            return None
    return None


def formatar_ultima_atualizacao(chave: str) -> str:
    return formatar_datahora_brasil(ultima_atualizacao(chave))
