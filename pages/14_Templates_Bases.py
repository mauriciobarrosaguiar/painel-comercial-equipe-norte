from __future__ import annotations

from io import BytesIO

import pandas as pd
import streamlit as st

from src.layout import titulo_pagina
from src.tratamento import (
    COLUNAS_ACOES,
    COLUNAS_BUSSOLA,
    COLUNAS_PAINEL,
    COLUNAS_PRODUTOS_MIX,
)

MIME_EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

COLUNAS_MERCADO_FARMA = [
    "ean",
    "produto",
    "distribuidora",
    "estoque",
    "preco_sem_imposto",
    "preco_final",
    "desconto",
    "data_atualizacao",
    "uf",
    "observacao",
]

COLUNAS_PRODUTOS_MERCADO_FARMA = [
    "ean",
    "produto",
]


def _excel_bytes(colunas: list[str], sheet_name: str = "dados") -> bytes:
    buffer = BytesIO()
    df = pd.DataFrame(columns=colunas)
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name=sheet_name[:31])
    return buffer.getvalue()


def _card_modelo(
    titulo: str,
    nome_arquivo: str,
    colunas: list[str],
    sheet_name: str,
    descricao: str,
) -> None:
    st.markdown(f"#### {titulo}")
    st.caption(descricao)
    st.download_button(
        f"Baixar {nome_arquivo}",
        data=_excel_bytes(colunas, sheet_name),
        file_name=nome_arquivo,
        mime=MIME_EXCEL,
        width="stretch",
        key=f"download_template_{nome_arquivo}",
    )
    with st.expander("Ver colunas do modelo", expanded=False):
        st.write(", ".join(colunas))


titulo_pagina("Templates de Bases", "Baixe os modelos corretos antes de atualizar o mês.")

st.info(
    "Use estes arquivos como padrão para atualizar as bases. "
    "Não altere os nomes das colunas nem o nome da aba informada. "
    "Depois de preencher, envie na tela Importação > Arquivos > Uploads manuais."
)

st.markdown("### Bases principais do painel")
col1, col2 = st.columns(2)
with col1:
    _card_modelo(
        "Bússola do mês",
        "bussola.xlsx",
        COLUNAS_BUSSOLA,
        "Pedidos",
        "Base de pedidos/vendas do mês. A aba precisa se chamar Pedidos.",
    )
with col2:
    _card_modelo(
        "Painel de clientes",
        "PAINEL EQUIPE NORTE.xlsx",
        COLUNAS_PAINEL,
        "Planilha1",
        "Base de clientes, consultores, cidades, UF e setor. A aba precisa se chamar Planilha1.",
    )

st.markdown("### Classificações e campanhas")
col3, col4 = st.columns(2)
with col3:
    _card_modelo(
        "Ações promocionais",
        "template_acoes_promocionais.xlsx",
        COLUNAS_ACOES,
        "dados",
        "Use para campanhas, descontos, validade, produto, EAN e distribuidora.",
    )
with col4:
    _card_modelo(
        "Produtos / Mix",
        "template_produtos_mix.xlsx",
        COLUNAS_PRODUTOS_MIX,
        "dados",
        "Classifique os produtos como PRIORITARIO, LANCAMENTO, LINHA ou COMBATE.",
    )

st.markdown("### Mercado Farma")
col5, col6 = st.columns(2)
with col5:
    _card_modelo(
        "Preços e estoque Mercado Farma",
        "mercado_farma.xlsx",
        COLUNAS_MERCADO_FARMA,
        "dados",
        "Base com EAN, produto, distribuidora, preço e estoque para montar pedidos.",
    )
with col6:
    _card_modelo(
        "EANs Mercado Farma",
        "produtos.xlsx",
        COLUNAS_PRODUTOS_MERCADO_FARMA,
        "dados",
        "Lista de EANs usados na busca/extração do Mercado Farma.",
    )

st.markdown("### Histórico")
_card_modelo(
    "Histórico Bússola",
    "bussola_historico.xlsx",
    COLUNAS_BUSSOLA,
    "Pedidos",
    "Use quando precisar manter ou importar histórico de vendas. A aba precisa se chamar Pedidos.",
)

st.warning(
    "Atenção: template vazio serve para estrutura. Para atualizar o painel de verdade, preencha as linhas com os dados do mês antes de enviar."
)
