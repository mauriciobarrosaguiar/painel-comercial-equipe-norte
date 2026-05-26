from __future__ import annotations

import streamlit as st

from src.calculos import auditar_produtos_mix, formatar_tabela_metricas, gerar_resultado_produto
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
auditoria = auditar_produtos_mix(produtos_mix, vendas_f)
tipos_contagem = auditoria.get("tipos_mix_contagem", {})

sem_classificacao = produtos_mix[produtos_mix["tipo_mix"].eq(TIPO_SEM_CLASSIFICACAO)]["ean_limpo"].nunique()
if produtos_mix.empty:
    st.warning("Produtos ainda sem classificação. Cadastre o mix para liberar leituras confiáveis de prioritários e lançamentos.")
elif sem_classificacao:
    st.warning(f"Existem {sem_classificacao} produtos no template sem classificação. Corrija o template de produtos mix.")

if auditoria["alerta_critico"]:
    st.error("Atenção: a base Produtos / Mix pode ter sido perdida, substituída ou está incompleta.")

st.markdown("#### Diagnóstico do mix")
diag_cols = st.columns(4)
diagnostico = [
    ("Template", auditoria["total_template"]),
    ("Classificados", auditoria["classificados_template"]),
    ("Vendidos", auditoria["vendas_total_eans"]),
    ("Fora do template", auditoria["vendas_eans_fora_template"]),
    ("Sem classificação", auditoria["vendas_eans_sem_classificacao"]),
    ("Classificação", f"{auditoria['percentual_classificado']:.2%}".replace(".", ",")),
    ("PRIORITARIO", tipos_contagem.get("PRIORITARIO", 0)),
    ("LANCAMENTO", tipos_contagem.get("LANCAMENTO", 0)),
    ("LINHA", tipos_contagem.get("LINHA", 0)),
    ("COMBATE", tipos_contagem.get("COMBATE", 0)),
    ("Fonte", fonte_ativa("produtos_mix")),
    ("Atualização", formatar_ultima_atualizacao("produtos_mix")),
]
for idx, (rotulo, valor) in enumerate(diagnostico):
    with diag_cols[idx % 4]:
        st.markdown(f"<span class='pill-note'>{rotulo}: <b>{valor}</b></span>", unsafe_allow_html=True)

resultado = gerar_resultado_produto(vendas_f, produtos_mix)
if not produtos_mix.empty:
    eans_template = set(produtos_mix["ean_limpo"].dropna().astype(str))
else:
    eans_template = set()

vendidos_fora = resultado[
    resultado["quantidade_vendida"].fillna(0).astype(float).gt(0)
    & ~resultado["ean"].astype(str).isin(eans_template)
].copy()

if not vendidos_fora.empty:
    with st.expander(f"Produtos vendidos fora do template de mix — {len(vendidos_fora)}", expanded=False):
        tabela_fora = formatar_tabela_metricas(
            vendidos_fora[["ean", "produto", "tipo_mix", "ol_total", "quantidade_vendida", "clientes_compradores"]]
        ).rename(
            columns={
                "ean": "EAN",
                "produto": "Produto",
                "tipo_mix": "Tipo mix",
                "ol_total": "OL Sem Combate",
                "quantidade_vendida": "Quantidade vendida",
                "clientes_compradores": "Clientes compradores",
            }
        )
        dataframe_com_download(tabela_fora, "produtos_vendidos_fora_template", altura=260)
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
