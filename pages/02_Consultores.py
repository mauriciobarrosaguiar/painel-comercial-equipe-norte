from __future__ import annotations

import streamlit as st

from src.calculos import calcular_resumo_operacional, formatar_tabela_metricas, gerar_resultado_cliente, gerar_resultado_consultor
from src.configuracoes import carregar_metas
from src.filtros import aplicar_filtros_globais, filtrar_busca, filtrar_vendas_operacionais
from src.layout import dataframe_com_download, status_periodo_html, titulo_pagina
from src.loader import carregar_dados_tratados
from src.projecao import projecao_html
from src.tratamento import formatar_moeda, formatar_percentual


def meta_consultor(metas: dict, nome: str, chave: str) -> float:
    return float(metas.get("consultores", {}).get(nome, {}).get(chave, 0) or 0)


def falta_para_meta(valor: float, meta: float, regra: float) -> float:
    return max((float(meta or 0) * regra) - float(valor or 0), 0)


def card_consultor(item, metas: dict, vendas_operacionais, clientes_filtrados, filtros: dict) -> None:
    nome = str(item["consultor"])
    meta_ol = meta_consultor(metas, nome, "ol_sem_combate")
    meta_prio = meta_consultor(metas, nome, "ol_prioritarios")
    meta_lanc = meta_consultor(metas, nome, "ol_lancamentos")
    meta_cli = meta_consultor(metas, nome, "clientes_positivados")

    def bloco(titulo: str, valor: float, meta: float, moeda: bool = True) -> str:
        atingimento = (float(valor or 0) / float(meta or 0)) if meta else 0
        valor_fmt = formatar_moeda(valor) if moeda else str(int(valor or 0))
        meta_fmt = formatar_moeda(meta) if moeda else str(int(meta or 0))
        falta80 = falta_para_meta(valor, meta, .8)
        falta90 = falta_para_meta(valor, meta, .9)
        falta100 = falta_para_meta(valor, meta, 1)
        falta80_fmt = formatar_moeda(falta80) if moeda else str(int(falta80))
        falta90_fmt = formatar_moeda(falta90) if moeda else str(int(falta90))
        falta100_fmt = formatar_moeda(falta100) if moeda else str(int(falta100))
        return (
            f'<div class="metric-card period-indicator">'
            f'<div class="metric-label">{titulo}</div>'
            f'<div class="metric-value">{valor_fmt}</div>'
            f'<div class="metric-note">Meta: {meta_fmt} | Atingimento: {formatar_percentual(atingimento)}</div>'
            f'<div class="pill-note">Falta 80%: {falta80_fmt}</div>'
            f'<div class="pill-note">Falta 90%: {falta90_fmt}</div>'
            f'<div class="pill-note">Falta 100%: {falta100_fmt}</div>'
            f'{projecao_html(valor, meta, filtros["inicio"], filtros["fim"])}'
            f'</div>'
        )

    clientes_consultor = clientes_filtrados[clientes_filtrados["nome_rep"].fillna("").eq(nome)].copy()
    vendas_consultor = vendas_operacionais[vendas_operacionais["consultor"].fillna("").eq(nome)].copy()
    resumo = calcular_resumo_operacional(vendas_consultor, clientes_consultor)

    st.markdown(
        f"""
        <div class="consultor-card">
            <div class="consultor-name">{nome}</div>
            <div class="indicator-grid">
                {bloco("OL sem combate", item['ol_sem_combate'], meta_ol)}
                {bloco("OL prioritários", item['ol_prioritarios'], meta_prio)}
                {bloco("OL lançamentos", item['ol_lancamentos'], meta_lanc)}
                {bloco("Clientes com venda", item['clientes_com_compra'], meta_cli, moeda=False)}
            </div>
            {status_periodo_html(resumo, titulo=True)}
        </div>
        """,
        unsafe_allow_html=True,
    )


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]
metas = carregar_metas()

titulo_pagina("Consultores")

vendas_f, clientes_f, filtros = aplicar_filtros_globais(vendas, clientes, chave="consultores")
vendas_operacionais = filtrar_vendas_operacionais(vendas, clientes_f, filtros)
resultado = gerar_resultado_consultor(vendas_f, clientes_f)

busca = st.text_input("Buscar consultor", placeholder="Digite parte do nome do consultor")
resultado_busca = filtrar_busca(resultado, busca, ["consultor"])

if resultado_busca.empty:
    st.info("Nenhum consultor encontrado para os filtros atuais.")
else:
    for _, item in resultado_busca.iterrows():
        card_consultor(item, metas, vendas_operacionais, clientes_f, filtros)

with st.expander("Carteira por consultor", expanded=False):
    consultores = resultado["consultor"].dropna().astype(str).sort_values().tolist()
    consultor_sel = st.selectbox("Selecionar consultor", ["Todos"] + consultores)
    clientes_resultado = gerar_resultado_cliente(vendas_f, clientes_f)
    if consultor_sel != "Todos":
        clientes_resultado = clientes_resultado[clientes_resultado["consultor"].eq(consultor_sel)]

    carteira_cols = [
        "consultor",
        "cnpj_limpo",
        "nome_pdv",
        "cidade",
        "uf",
        "grupo_sip",
        "situacao",
        "ol_sem_combate",
        "ol_prioritarios",
        "ol_lancamentos",
        "ultima_compra",
        "status_comercial",
    ]
    carteira = formatar_tabela_metricas(clientes_resultado[carteira_cols]).rename(
        columns={
            "consultor": "Consultor",
            "cnpj_limpo": "CNPJ",
            "nome_pdv": "Nome PDV",
            "cidade": "Cidade",
            "uf": "UF",
            "grupo_sip": "Rede",
            "situacao": "Situação",
            "ol_sem_combate": "OL Sem Combate",
            "ol_prioritarios": "OL Prioritários",
            "ol_lancamentos": "OL Lançamentos",
            "ultima_compra": "Última compra",
            "status_comercial": "Status comercial",
        }
    )
    dataframe_com_download(carteira, "carteira_consultor", altura=430)
