from __future__ import annotations

import streamlit as st

from src.calculos import formatar_tabela_metricas
from src.filtros import aplicar_filtros_globais, filtrar_busca
from src.layout import botao_download_excel, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.oportunidades import gerar_oportunidades
from src.tratamento import formatar_moeda


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]
produtos_mix = dados["produtos_mix"]

titulo_pagina("Oportunidades")

vendas_f, clientes_f, _ = aplicar_filtros_globais(vendas, clientes, chave="oportunidades")
oportunidades = gerar_oportunidades(vendas_f, clientes_f, produtos_mix)

c1, c2, c3 = st.columns([1, 1.2, 2])
prioridades = c1.multiselect("Prioridade", ["Alta", "Media", "Baixa"], default=[])
consultores = ["Todos"]
if not oportunidades.empty and "consultor" in oportunidades.columns:
    consultores += sorted(oportunidades["consultor"].dropna().astype(str).unique().tolist())
consultor_sel = c2.selectbox("Vendedor", consultores)
busca = c3.text_input("Buscar oportunidade")
if prioridades and not oportunidades.empty:
    oportunidades = oportunidades[oportunidades["prioridade"].isin(prioridades)].copy()
if consultor_sel != "Todos" and not oportunidades.empty:
    oportunidades = oportunidades[oportunidades["consultor"].astype(str).eq(consultor_sel)].copy()
oportunidades = filtrar_busca(oportunidades, busca, ["consultor", "cliente", "cnpj", "grupo_sip", "cidade", "motivo_alerta"])

st.markdown(
    f"<span class='pill-note'>Alta: {int((oportunidades.get('prioridade', '') == 'Alta').sum()) if not oportunidades.empty else 0}</span>"
    f"<span class='pill-note'>Media: {int((oportunidades.get('prioridade', '') == 'Media').sum()) if not oportunidades.empty else 0}</span>"
    f"<span class='pill-note'>Baixa: {int((oportunidades.get('prioridade', '') == 'Baixa').sum()) if not oportunidades.empty else 0}</span>",
    unsafe_allow_html=True,
)

if oportunidades.empty:
    st.info("Sem oportunidades para os filtros atuais.")
else:
    for fatia in [oportunidades.head(18).iloc[i : i + 3] for i in range(0, min(len(oportunidades), 18), 3)]:
        cols = st.columns(3)
        for col, (_, item) in zip(cols, fatia.iterrows()):
            with col:
                st.markdown(
                    f"""
                    <div class="contact-card">
                        <div class="contact-title">{item['cliente']}</div>
                        <div class="contact-line"><b>Prioridade:</b> {item['prioridade']} | <b>Consultor:</b> {item['consultor']}</div>
                        <div class="contact-line"><b>CNPJ:</b> {item['cnpj']}</div>
                        <div class="contact-line"><b>Rede:</b> {item['grupo_sip']}</div>
                        <div class="contact-line"><b>Motivo:</b> {item['motivo_alerta']}</div>
                        <div class="contact-line"><b>Acao:</b> {item['acao_sugerida']}</div>
                        <div class="pill-note">OL {formatar_moeda(item['ol_sem_combate'])}</div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

colunas = [
    "prioridade",
    "consultor",
    "cliente",
    "cnpj",
    "grupo_sip",
    "cidade",
    "uf",
    "motivo_alerta",
    "acao_sugerida",
    "ol_sem_combate",
    "ol_prioritarios",
    "ol_lancamentos",
]
renomear = {
    "prioridade": "Prioridade",
    "consultor": "Consultor",
    "cliente": "Cliente",
    "cnpj": "CNPJ",
    "grupo_sip": "Rede / SIP",
    "cidade": "Cidade",
    "uf": "UF",
    "motivo_alerta": "Motivo",
    "acao_sugerida": "Acao sugerida",
    "ol_sem_combate": "OL Sem Combate",
    "ol_prioritarios": "OL Prioritarios",
    "ol_lancamentos": "OL Lancamentos",
}

with st.expander("Tabela completa e exportacao", expanded=False):
    tabela = formatar_tabela_metricas(oportunidades[colunas]).rename(columns=renomear) if not oportunidades.empty else oportunidades
    dataframe_com_download(tabela, "oportunidades", altura=440)
    botao_download_excel(oportunidades[colunas].rename(columns=renomear) if not oportunidades.empty else oportunidades, "oportunidades_comerciais.xlsx", "Baixar oportunidades em Excel")
