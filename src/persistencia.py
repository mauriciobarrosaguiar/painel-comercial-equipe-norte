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
}

ARQUIVOS_JSON = {
    "metas": "metas_comerciais.json",
    "login_bussola": "bussola_login.json",
    "sip": "sip_grupos.json",
    "metadata": "metadata.json",
    "desafio": "desafio_gigantes.json",
    "historico_vendas": "historico_vendas.json",
}

ARQUIVOS_PADRAO_DATA = {
    "bussola": DATA_DIR / "bussola.xlsx",
    "painel": DATA_DIR / "PAINEL EQUIPE NORTE.xlsx",
    "acoes": DATA_DIR / "template_acoes_promocionais.xlsx",
    "produtos_mix": DATA_DIR / "template_produtos_mix.xlsx",
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


def _texto_resposta(resp: requests.Response | None) -> str:
    if resp is None:
        return ""
    texto = resp.text or ""
    token = _github_config()["token"]
    if token:
        texto = texto.replace(token, "[token oculto]")
    return texto[:800]


def _registrar_erro_escrita_github(
    chave: str,
    conteudo: bytes,
    erro: str,
    status_code: int | None = None,
    resposta: str = "",
) -> None:
    try:
        st.session_state["ultimo_erro_escrita_github"] = {
            "chave": chave,
            "erro": erro[:800],
            "status_code": status_code,
            "resposta": resposta[:800],
            "tamanho_bytes": len(conteudo),
            "tamanho_mb": round(len(conteudo) / (1024 * 1024), 2),
            "quando": agora_brasilia().isoformat(),
        }
    except Exception:
        pass


def _mostrar_erro_github(
    chave: str,
    conteudo: bytes,
    erro: str,
    status_code: int | None = None,
    resposta: str = "",
) -> None:
    _registrar_erro_escrita_github(chave, conteudo, erro, status_code, resposta)
    st.error("Não consegui salvar no GitHub. Verifique GITHUB_TOKEN, branch app-storage ou tamanho do arquivo.")
    st.warning("A cópia local/sessão foi mantida, mas a atualização pode não persistir após reiniciar.")
    with st.expander("Detalhe técnico do GitHub"):
        st.write(f"Chave: {chave}")
        st.write(f"Status code: {status_code if status_code is not None else '-'}")
        st.write(f"Tamanho tentado: {len(conteudo) / (1024 * 1024):.2f} MB")
        st.code((resposta or erro)[:800], language="text")


def _ultimo_erro_escrita_github() -> dict[str, Any]:
    try:
        erro = st.session_state.get("ultimo_erro_escrita_github", {})
    except Exception:
        erro = {}
    return erro if isinstance(erro, dict) else {}


def _github_path_existe(path: str) -> bool:
    cfg = _github_config()
    url = f"https://api.github.com/repos/{cfg['repo']}/contents/{path}"
    resp = requests.get(url, headers=_headers(), params={"ref": cfg["branch"]}, timeout=20)
    if resp.status_code == 404:
        return False
    resp.raise_for_status()
    return True


def diagnostico_persistencia() -> dict[str, Any]:
    cfg = _github_config()
    branch_existe: str = "não"
    diretorio_existe: str = "não"
    if cfg["token"] and cfg["repo"] and cfg["branch"]:
        try:
            branch_existe = "sim" if _github_get_ref(cfg["branch"]) else "não"
        except Exception as exc:
            branch_existe = f"erro: {str(exc)[:160]}"
        if branch_existe == "sim":
            try:
                diretorio = cfg["dir"].strip("/")
                diretorio_existe = "sim" if not diretorio or _github_path_existe(diretorio) else "não"
            except Exception as exc:
                diretorio_existe = f"erro: {str(exc)[:160]}"

    ultimo = _ultimo_erro_escrita_github()
    return {
        "repo": cfg["repo"],
        "branch": cfg["branch"],
        "diretorio": cfg["dir"],
        "token_configurado": "sim" if bool(cfg["token"]) else "não",
        "persistence_key_configurada": "sim" if bool(cfg["key"]) else "não",
        "branch_existe": branch_existe,
        "diretorio_existe": diretorio_existe,
        "ultimo_erro_escrita": ultimo.get("erro", ""),
        "ultimo_status_code": ultimo.get("status_code"),
        "ultima_resposta": ultimo.get("resposta", ""),
        "ultimo_tamanho_bytes": ultimo.get("tamanho_bytes"),
        "ultimo_tamanho_mb": ultimo.get("tamanho_mb"),
        "ultima_chave": ultimo.get("chave", ""),
        "ultimo_erro_quando": ultimo.get("quando", ""),
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


def _github_write_safe(chave: str, conteudo: bytes, mensagem: str) -> tuple[bool, str]:
    if not persistencia_github_ativa():
        return False, "Persistência GitHub não configurada."
    try:
        _github_write(chave, conteudo, mensagem)
        return True, ""
    except requests.exceptions.HTTPError as exc:
        resp = exc.response
        status_code = resp.status_code if resp is not None else None
        resposta = _texto_resposta(resp)
        detalhe = resposta or str(exc)
        _mostrar_erro_github(chave, conteudo, str(exc), status_code, resposta)
        return False, detalhe
    except requests.exceptions.RequestException as exc:
        _mostrar_erro_github(chave, conteudo, str(exc))
        return False, str(exc)
    except Exception as exc:
        _mostrar_erro_github(chave, conteudo, str(exc))
        return False, str(exc)


def _github_commit_at_seguro(chave: str) -> object | None:
    try:
        return _github_commit_at(_caminho_github(chave))
    except Exception:
        return None


def carregar_bytes_detalhado(chave: str) -> dict[str, Any]:
    erro_github: str | None = None
    github_ativo = persistencia_github_ativa()
    if github_ativo:
        try:
            dados = _github_read(chave)
            if dados:
                return {
                    "conteudo": dados,
                    "origem": "github",
                    "github_ativo": True,
                    "erro": None,
                    "atualizado_em": _github_commit_at_seguro(chave),
                }
        except Exception as exc:
            erro_github = str(exc)
            st.warning(f"Não consegui ler a persistência no GitHub ({chave}): {exc}")

    caminho = _caminho_local(chave)
    if caminho.exists():
        return {
            "conteudo": caminho.read_bytes(),
            "origem": "local_persistencia",
            "github_ativo": github_ativo,
            "erro": erro_github,
            "atualizado_em": datetime_arquivo_brasilia(caminho),
        }

    return {
        "conteudo": None,
        "origem": "nao_encontrado",
        "github_ativo": github_ativo,
        "erro": erro_github,
        "atualizado_em": None,
    }


def carregar_bytes(chave: str) -> bytes | None:
    detalhado = carregar_bytes_detalhado(chave)
    conteudo = detalhado.get("conteudo")
    return conteudo if isinstance(conteudo, bytes) else None


def carregar_metadados() -> dict[str, Any]:
    dados = carregar_bytes("metadata")
    if not dados:
        return {}
    try:
        carregado = json.loads(dados.decode("utf-8"))
    except Exception:
        return {}
    return carregado if isinstance(carregado, dict) else {}


def _salvar_metadados(dados: dict[str, Any], persistir_github: bool = True) -> bool:
    conteudo = json.dumps(dados, ensure_ascii=False, indent=2).encode("utf-8")
    LOCAL_STORE_DIR.mkdir(parents=True, exist_ok=True)
    _caminho_local("metadata").write_bytes(conteudo)
    if persistir_github and persistencia_github_ativa():
        persistiu, _detalhe = _github_write_safe("metadata", conteudo, "Atualiza controle de atualizacoes pelo painel")
        return persistiu
    return False


def _registrar_atualizacao(chave: str, mensagem: str | None = None, persistir_github: bool = True) -> None:
    if chave == "metadata":
        return
    try:
        metadados = carregar_metadados()
        metadados[chave] = {
            "updated_at": agora_brasilia().isoformat(),
            "arquivo": _nome_arquivo(chave),
            "mensagem": mensagem or f"Atualiza {chave} pelo painel",
        }
        _salvar_metadados(metadados, persistir_github=persistir_github)
    except Exception as exc:
        st.warning(f"Base salva, mas não consegui atualizar o horário fixo ({chave}): {exc}")


def salvar_bytes(chave: str, conteudo: bytes, mensagem: str | None = None) -> bool:
    LOCAL_STORE_DIR.mkdir(parents=True, exist_ok=True)
    _caminho_local(chave).write_bytes(conteudo)
    mensagem_final = mensagem or f"Atualiza {chave} pelo painel"
    github_persistiu = False
    if persistencia_github_ativa():
        github_persistiu, _detalhe = _github_write_safe(chave, conteudo, mensagem_final)
    _registrar_atualizacao(chave, mensagem_final, persistir_github=github_persistiu)
    return github_persistiu


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
