from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pandas as pd
import streamlit as st

from src.persistencia import carregar_bytes, existe_persistido, salvar_bytes
from src.tratamento import (
    COLUNAS_ACOES,
    COLUNAS_BUSSOLA,
    COLUNAS_PAINEL,
    COLUNAS_PRODUTOS_MIX,
    preparar_acoes,
    preparar_base_vendas,
    preparar_painel_equipe,
    preparar_produtos_mix,
    validar_colunas_esperadas,
)


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"

ARQUIVOS_PADRAO = {
    "bussola": DATA_DIR / "bussola.xlsx",
    "painel": DATA_DIR / "PAINEL EQUIPE NORTE.xlsx",
    "acoes": DATA_DIR / "template_acoes_promocionais.xlsx",
    "produtos_mix": DATA_DIR / "template_produtos_mix.xlsx",
}

ABAS_PADRAO = {
    "bussola": "Pedidos",
    "painel": "Planilha1",
    "acoes": 0,
    "produtos_mix": 0,
}


def _uploads_sessao() -> dict[str, dict[str, object]]:
    return st.session_state.setdefault("uploads_bases", {})


def registrar_upload(chave: str, arquivo) -> None:
    if arquivo is None:
        return
    conteudo = arquivo.getvalue()
    _uploads_sessao()[chave] = {"name": arquivo.name, "bytes": conteudo}
    salvar_bytes(chave, conteudo, f"Atualiza base {chave} pelo painel")
    st.cache_data.clear()


def limpar_uploads() -> None:
    st.session_state["uploads_bases"] = {}
    st.cache_data.clear()


def fonte_ativa(chave: str) -> str:
    upload = _uploads_sessao().get(chave)
    if upload:
        return f"Upload salvo: {upload.get('name', '')}"
    if existe_persistido(chave):
        return "Base salva na persistência"
    caminho = ARQUIVOS_PADRAO[chave]
    return f"Pasta data: {caminho.name}" if caminho.exists() else "Arquivo não encontrado"


@st.cache_data(show_spinner=False)
def _ler_excel_bytes(conteudo: bytes, sheet_name: str | int) -> pd.DataFrame:
    return pd.read_excel(BytesIO(conteudo), sheet_name=sheet_name, dtype=str, engine="openpyxl")


@st.cache_data(show_spinner=False)
def _ler_excel_caminho(caminho: str, sheet_name: str | int, mtime: float) -> pd.DataFrame:
    return pd.read_excel(caminho, sheet_name=sheet_name, dtype=str, engine="openpyxl")


def _carregar_excel(chave: str) -> pd.DataFrame:
    upload = _uploads_sessao().get(chave)
    if upload and upload.get("bytes"):
        return _ler_excel_bytes(upload["bytes"], ABAS_PADRAO[chave])
    persistido = carregar_bytes(chave)
    if persistido:
        return _ler_excel_bytes(persistido, ABAS_PADRAO[chave])
    caminho = ARQUIVOS_PADRAO[chave]
    if not caminho.exists():
        return pd.DataFrame()
    return _ler_excel_caminho(str(caminho), ABAS_PADRAO[chave], caminho.stat().st_mtime)


def carregar_bussola() -> pd.DataFrame:
    return _carregar_excel("bussola")


def carregar_painel_equipe() -> pd.DataFrame:
    return _carregar_excel("painel")


def carregar_acoes() -> pd.DataFrame:
    return _carregar_excel("acoes")


def carregar_produtos_mix() -> pd.DataFrame:
    return _carregar_excel("produtos_mix")


def carregar_dados_tratados() -> dict[str, pd.DataFrame | list[str]]:
    bussola_raw = carregar_bussola()
    painel_raw = carregar_painel_equipe()
    acoes_raw = carregar_acoes()
    produtos_raw = carregar_produtos_mix()

    avisos: list[str] = []
    avisos.extend(validar_colunas_esperadas(bussola_raw, COLUNAS_BUSSOLA, "bussola.xlsx"))
    avisos.extend(validar_colunas_esperadas(painel_raw, COLUNAS_PAINEL, "PAINEL EQUIPE NORTE.xlsx"))
    if acoes_raw.empty:
        avisos.append("template_acoes_promocionais.xlsx: sem ações cadastradas. Use a tela Importar Bases para baixar o modelo.")
    if produtos_raw.empty:
        avisos.append("template_produtos_mix.xlsx: sem produtos classificados. Produtos vendidos ficarão como SEM CLASSIFICACAO.")
    else:
        avisos.extend(validar_colunas_esperadas(produtos_raw, COLUNAS_PRODUTOS_MIX, "template_produtos_mix.xlsx"))
    if not acoes_raw.empty:
        avisos.extend(validar_colunas_esperadas(acoes_raw, COLUNAS_ACOES, "template_acoes_promocionais.xlsx"))

    clientes = preparar_painel_equipe(painel_raw)
    produtos_mix = preparar_produtos_mix(produtos_raw)
    acoes = preparar_acoes(acoes_raw)
    vendas = preparar_base_vendas(bussola_raw, clientes, produtos_mix)

    return {
        "vendas": vendas,
        "clientes": clientes,
        "produtos_mix": produtos_mix,
        "acoes": acoes,
        "avisos": avisos,
        "raw_bussola": bussola_raw,
        "raw_painel": painel_raw,
        "raw_acoes": acoes_raw,
        "raw_produtos_mix": produtos_raw,
    }


def modelo_acoes() -> pd.DataFrame:
    return pd.DataFrame(columns=COLUNAS_ACOES)


def modelo_produtos_mix() -> pd.DataFrame:
    return pd.DataFrame(columns=COLUNAS_PRODUTOS_MIX)
