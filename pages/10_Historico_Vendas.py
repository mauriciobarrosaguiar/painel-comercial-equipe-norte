from __future__ import annotations

import pandas as pd
import streamlit as st

from src.configuracoes import carregar_metas
from src.datas import formatar_datahora_brasil
from src.historico import historico_dataframe, sincronizar_historico_meses_fechados
from src.layout import dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.tratamento import formatar_moeda, formatar_percentual


def _rotulo_mes(ano_mes: str) -> str:
    try:
        return pd.Period(ano_mes, freq="M").to_timestamp().strftime("%m/%Y")
    except Exception:
        return str(ano_mes)


def _numero_inteiro(valor: object) -> str:
    try:
        return str(int(float(valor or 0)))
    except (TypeError, ValueError):
        return "0"


def _card(titulo: str, valor: object, meta: object, moeda: bool = True) -> None:
    valor_num = float(valor or 0)
    meta_num = float(meta or 0)
    atingimento = valor_num / meta_num if meta_num else 0
    valor_fmt = formatar_moeda(valor_num) if moeda else _numero_inteiro(valor_num)
    meta_fmt = formatar_moeda(meta_num) if moeda else _numero_inteiro(meta_num)
    st.markdown(
        f"""
        <div class="metric-card period-indicator">
            <div class="metric-label">{titulo}</div>
            <div class="metric-value">{valor_fmt}</div>
            <div class="metric-note">Meta salva: {meta_fmt} | Atingimento: {formatar_percentual(atingimento)}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _formatar_tabela(df: pd.DataFrame) -> pd.DataFrame:
    colunas = [
        "mes",
        "escopo",
        "nome",
        "ol_sem_combate",
        "meta_ol_sem_combate",
        "ol_prioritarios",
        "meta_ol_prioritarios",
        "ol_lancamentos",
        "meta_ol_lancamentos",
        "clientes_positivados",
        "meta_clientes_positivados",
        "faturado_periodo",
        "atualizado_em",
    ]
    base = df[[coluna for coluna in colunas if coluna in df.columns]].copy()
    for coluna in [
        "ol_sem_combate",
        "meta_ol_sem_combate",
        "ol_prioritarios",
        "meta_ol_prioritarios",
        "ol_lancamentos",
        "meta_ol_lancamentos",
        "faturado_periodo",
    ]:
        if coluna in base.columns:
            base[coluna] = base[coluna].apply(formatar_moeda)
    for coluna in ["clientes_positivados", "meta_clientes_positivados"]:
        if coluna in base.columns:
            base[coluna] = base[coluna].apply(_numero_inteiro)
    if "mes" in base.columns:
        base["mes"] = base["mes"].apply(_rotulo_mes)
    if "atualizado_em" in base.columns:
        base["atualizado_em"] = base["atualizado_em"].apply(formatar_datahora_brasil)
    return base.rename(
        columns={
            "mes": "Mês",
            "escopo": "Tipo",
            "nome": "Nome",
            "ol_sem_combate": "OL sem combate",
            "meta_ol_sem_combate": "Meta OL sem combate",
            "ol_prioritarios": "OL prioritários",
            "meta_ol_prioritarios": "Meta OL prioritários",
            "ol_lancamentos": "OL lançamentos",
            "meta_ol_lancamentos": "Meta OL lançamentos",
            "clientes_positivados": "Clientes com venda",
            "meta_clientes_positivados": "Meta clientes",
            "faturado_periodo": "Faturado do período",
            "atualizado_em": "Atualizado em",
        }
    )


titulo_pagina("Histórico de Vendas")

dados = carregar_dados_tratados()
metas = carregar_metas()

if st.button("Atualizar histórico com bases atuais", use_container_width=True):
    try:
        resultado = sincronizar_historico_meses_fechados(dados["vendas"], dados["clientes"], metas)
        meses = resultado.get("meses_atualizados") or []
        if meses:
            st.success("Histórico atualizado: " + ", ".join(_rotulo_mes(str(mes)) for mes in meses))
        else:
            st.info("Nenhum mês fechado encontrado para atualizar.")
    except Exception as exc:
        st.error(f"Falha ao atualizar histórico: {exc}")

historico = historico_dataframe()
if historico.empty:
    st.info("Nenhum mês fechado no histórico.")
else:
    meses = sorted(historico["mes"].dropna().astype(str).unique().tolist(), reverse=True)
    mes_sel = st.selectbox("Mês", meses, format_func=_rotulo_mes)
    base_mes = historico[historico["mes"].astype(str).eq(mes_sel)].copy()

    gd = base_mes[base_mes["escopo"].eq("GD")]
    if not gd.empty:
        linha_gd = gd.iloc[0]
        st.markdown(f"### GD - {linha_gd['nome']}")
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            _card("OL sem combate", linha_gd["ol_sem_combate"], linha_gd["meta_ol_sem_combate"])
        with c2:
            _card("OL prioritários", linha_gd["ol_prioritarios"], linha_gd["meta_ol_prioritarios"])
        with c3:
            _card("OL lançamentos", linha_gd["ol_lancamentos"], linha_gd["meta_ol_lancamentos"])
        with c4:
            _card("Clientes com venda", linha_gd["clientes_positivados"], linha_gd["meta_clientes_positivados"], moeda=False)

    consultores = base_mes[base_mes["escopo"].eq("Consultor")].copy()
    st.subheader("Consultores")
    dataframe_com_download(_formatar_tabela(consultores), f"historico_consultores_{mes_sel}", altura=460)

    with st.expander("Histórico completo", expanded=False):
        dataframe_com_download(_formatar_tabela(historico), "historico_vendas", altura=460)
