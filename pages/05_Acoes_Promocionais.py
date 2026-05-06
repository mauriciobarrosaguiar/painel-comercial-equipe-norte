from __future__ import annotations

import pandas as pd
import streamlit as st

from src.acoes import analisar_acoes_promocionais
from src.calculos import formatar_tabela_metricas
from src.datas import hoje_brasilia
from src.filtros import aplicar_filtros_globais, filtrar_busca
from src.layout import dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.tratamento import formatar_moeda, formatar_percentual


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]
acoes = dados["acoes"]

titulo_pagina("Ações Promocionais")

vendas_f, clientes_f, _ = aplicar_filtros_globais(vendas, clientes, chave="acoes", mostrar_tipo_mix=False)

c1, c2 = st.columns([1, 2])
mes_ref = c1.date_input("Mês de referência", value=hoje_brasilia().replace(day=1), format="DD/MM/YYYY")
busca = c2.text_input("Buscar campanha, produto, EAN ou consultor")
inicio_mes = pd.Timestamp(mes_ref).replace(day=1)
fim_mes = inicio_mes + pd.offsets.MonthEnd(0)

if acoes.empty:
    st.info("Nenhuma ação promocional cadastrada.")
    st.stop()

acoes_mes = acoes[
    (
        (pd.to_datetime(acoes["data_inicio"], errors="coerce") <= fim_mes)
        & (pd.to_datetime(acoes["data_fim"], errors="coerce") >= inicio_mes)
    )
    | acoes["status"].astype(str).str.upper().str.contains("ATIVA", na=False)
].copy()
analise = analisar_acoes_promocionais(acoes_mes, vendas_f)
analise = filtrar_busca(analise, busca, ["campanha", "produto", "ean", "consultor", "distribuidora"])

st.subheader("Ações do período")
if analise.empty:
    st.info("Sem ações para o mês selecionado.")
else:
    for fatia in [analise.iloc[i : i + 2] for i in range(0, len(analise), 2)]:
        cols = st.columns(2)
        for col, (_, acao) in zip(cols, fatia.iterrows()):
            crescimento = acao["crescimento_percentual"]
            crescimento_txt = "-" if pd.isna(crescimento) else formatar_percentual(crescimento)
            with col:
                st.markdown(
                    f"""
                    <div class="consultor-card">
                        <div class="consultor-name">{acao['campanha'] or acao['produto']}</div>
                        <div class="contact-line"><b>Produto:</b> {acao['produto']} | <b>EAN:</b> {acao['ean']}</div>
                        <div class="contact-line"><b>Período:</b> {acao['data_inicio'].strftime('%d/%m/%Y') if pd.notna(acao['data_inicio']) else '-'} a {acao['data_fim'].strftime('%d/%m/%Y') if pd.notna(acao['data_fim']) else '-'}</div>
                        <div class="mini-grid">
                            <div class="mini-metric"><div class="mini-label">Antes</div><div class="mini-value">{formatar_moeda(acao['ol_antes_acao'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Durante</div><div class="mini-value">{formatar_moeda(acao['ol_durante_acao'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Cresc.</div><div class="mini-value">{crescimento_txt}</div></div>
                            <div class="mini-metric"><div class="mini-label">Qtd</div><div class="mini-value">{int(acao['quantidade_vendida'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Clientes</div><div class="mini-value">{int(acao['clientes_compradores'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Status</div><div class="mini-value">{acao['status']}</div></div>
                        </div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

with st.expander("Detalhes das ações", expanded=False):
    colunas = [
        "campanha",
        "produto",
        "ean",
        "tipo_mix",
        "distribuidora",
        "desconto",
        "data_inicio",
        "data_fim",
        "consultor",
        "status",
        "ol_antes_acao",
        "ol_durante_acao",
        "crescimento_percentual",
        "quantidade_vendida",
        "clientes_compradores",
        "consultor_destaque",
        "distribuidora_destaque",
    ]
    tabela = formatar_tabela_metricas(analise[colunas]).rename(
        columns={
            "campanha": "Campanha",
            "produto": "Produto",
            "ean": "EAN",
            "tipo_mix": "Tipo mix",
            "distribuidora": "Distribuidora",
            "desconto": "Desconto",
            "data_inicio": "Data início",
            "data_fim": "Data fim",
            "consultor": "Consultor",
            "status": "Status",
            "ol_antes_acao": "OL antes",
            "ol_durante_acao": "OL durante",
            "crescimento_percentual": "Crescimento",
            "quantidade_vendida": "Quantidade",
            "clientes_compradores": "Clientes",
            "consultor_destaque": "Consultor destaque",
            "distribuidora_destaque": "Distribuidora destaque",
        }
    )
    dataframe_com_download(tabela, "acoes_promocionais")
