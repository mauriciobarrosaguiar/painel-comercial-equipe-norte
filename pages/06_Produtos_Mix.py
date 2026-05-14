from __future__ import annotations

import streamlit as st

from src.calculos import formatar_tabela_metricas, gerar_resultado_produto
from src.filtros import aplicar_filtros_globais, filtrar_busca
from src.layout import dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados, fonte_ativa
from src.status_bases import formatar_ultima_atualizacao
from src.tratamento import TIPO_SEM_CLASSIFICACAO


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]
produtos_mix = dados["produtos_mix"]

titulo_pagina(
    "Produtos / Mix",
    "Classificação dos produtos e desempenho por tipo de mix.",
)

c1, c2, c3 = st.columns(3)
c1.caption(f"Fonte: {fonte_ativa('produtos_mix')}")
c2.caption(f"Atualizado em: {formatar_ultima_atualizacao('produtos_mix')}")
c3.caption(f"Produtos classificados: {len(produtos_mix)}")

vendas_f, clientes_f, _ = aplicar_filtros_globais(vendas, clientes, chave="produtos")

sem_classificacao = produtos_mix[produtos_mix["tipo_mix"].eq(TIPO_SEM_CLASSIFICACAO)]["ean_limpo"].nunique()
if produtos_mix.empty:
    st.warning("Produtos ainda sem classificação. Cadastre o mix para liberar leituras confiáveis de prioritários e lançamentos.")
elif sem_classificacao:
    st.warning(f"Existem {sem_classificacao} produtos no template sem classificação. Corrija o template de produtos mix.")

resultado = gerar_resultado_produto(vendas_f, produtos_mix)
if not produtos_mix.empty:
    eans_template = set(produtos_mix["ean_limpo"].dropna().astype(str))
    resultado = resultado[resultado["ean"].astype(str).isin(eans_template)].copy()
tipos = ["PRIORITARIO", "LANCAMENTO", "LINHA", "COMBATE", TIPO_SEM_CLASSIFICACAO]
tipo_sel = st.multiselect("Filtrar tipo de mix", tipos, default=[])
if tipo_sel:
    resultado = resultado[resultado["tipo_mix"].isin(tipo_sel)].copy()

busca = st.text_input("Buscar EAN ou produto")
resultado = filtrar_busca(resultado, busca, ["ean", "produto", "tipo_mix"])

colunas = [
    "ean",
    "produto",
    "tipo_mix",
    "ol_total",
    "quantidade_vendida",
    "clientes_compradores",
    "consultores_que_venderam",
]
renomear = {
    "ean": "EAN",
    "produto": "Produto",
    "tipo_mix": "Tipo mix",
    "ol_total": "OL Sem Combate",
    "quantidade_vendida": "Quantidade vendida",
    "clientes_compradores": "Clientes compradores",
    "consultores_que_venderam": "Consultores que venderam",
}
tabela = formatar_tabela_metricas(resultado[colunas]).rename(columns=renomear)
dataframe_com_download(tabela, "produtos_mix", altura=520)
