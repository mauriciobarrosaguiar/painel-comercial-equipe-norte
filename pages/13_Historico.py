from __future__ import annotations

import pandas as pd
import streamlit as st

from src.bussola_web import extrair_bussola_web_historico_todos
from src.calculos import calcular_indicadores, gerar_resultado_consultor
from src.configuracoes import carregar_login_bussola, consultores_unicos
from src.datas import hoje_brasilia
from src.historico import combinar_bases_bussola_historico, carregar_metas_historico, meta_padrao_mes, salvar_metas_historico
from src.layout import dataframe_com_download, titulo_pagina
from src.loader import carregar_bussola_historico, carregar_dados_tratados, registrar_upload
from src.status_bases import formatar_ultima_atualizacao
from src.tratamento import STATUS_FATURADOS, formatar_moeda, formatar_percentual, preparar_base_vendas


def _periodo_padrao() -> tuple[pd.Timestamp, pd.Timestamp]:
    inicio_mes_atual = pd.Timestamp(hoje_brasilia().replace(day=1))
    return inicio_mes_atual - pd.DateOffset(months=12), inicio_mes_atual - pd.Timedelta(days=1)


def _credenciais_historico(clientes) -> tuple[list[dict[str, str]], bool]:
    login = carregar_login_bussola()
    nomes_gd = clientes["nome_gd"].dropna().astype(str).str.strip() if not clientes.empty and "nome_gd" in clientes.columns else pd.Series(dtype=str)
    nome_gd = nomes_gd[nomes_gd.ne("")].iloc[0] if not nomes_gd[nomes_gd.ne("")].empty else "Gerente Distrital"
    gd = login.get("gd", {})
    if gd.get("usar_gd", True) and gd.get("usuario") and gd.get("senha"):
        return [{"consultor": f"GD - {nome_gd}", "usuario": gd.get("usuario", ""), "senha": gd.get("senha", "")}], bool(login.get("headless", False))
    credenciais = []
    for consultor, item in login.get("consultores", {}).items():
        if item.get("extrair", True) and item.get("usuario") and item.get("senha"):
            credenciais.append({"consultor": consultor, "usuario": item.get("usuario", ""), "senha": item.get("senha", "")})
    return credenciais, bool(login.get("headless", False))


def _linha_meta(metas_historico: dict, mes: str) -> dict:
    meses = metas_historico.setdefault("meses", {})
    if mes not in meses:
        meses[mes] = meta_padrao_mes()
    meses[mes].setdefault("gerente_territorial", meta_padrao_mes()["gerente_territorial"].copy())
    meses[mes].setdefault("consultores", {})
    return meses[mes]


dados = carregar_dados_tratados()
clientes = dados["clientes"]
produtos_mix = dados["produtos_mix"]
raw_historico = carregar_bussola_historico()
raw_historico = combinar_bases_bussola_historico(dados.get("raw_bussola", pd.DataFrame()), raw_historico)
vendas_historico = preparar_base_vendas(raw_historico, clientes, produtos_mix)
metas_historico = carregar_metas_historico()

titulo_pagina("Histórico", "Resumo de metas e realizados de meses anteriores, separado do mês atual.")
st.caption(f"Última atualização histórica: {formatar_ultima_atualizacao('bussola_historico')}")

inicio_padrao, fim_padrao = _periodo_padrao()
f1, f2 = st.columns(2)
data_inicio = f1.date_input("Data inicial do histórico", value=inicio_padrao.date(), format="DD/MM/YYYY")
data_fim = f2.date_input("Data final do histórico", value=fim_padrao.date(), format="DD/MM/YYYY")

with st.expander("Atualizar histórico Bússola", expanded=False):
    upload_hist = st.file_uploader("Subir bussola_historico.xlsx", type=["xlsx"], key="upload_bussola_historico")
    if st.button("Usar base histórica enviada", width="stretch"):
        if registrar_upload("bussola_historico", upload_hist):
            st.success("Base histórica salva.")
            st.rerun()
        else:
            st.warning("Selecione a base histórica.")

    st.caption("A extração histórica usa os acessos já cadastrados no Bússola, mas salva em base separada para não afetar o mês atual.")
    c1, c2 = st.columns(2)
    if c1.button("Extrair histórico do Bússola", width="stretch"):
        credenciais, headless = _credenciais_historico(clientes)
        if not credenciais:
            st.warning("Cadastre login da GD ou dos consultores em Importação antes de extrair o histórico.")
        else:
            logs: list[str] = []
            area_logs = st.empty()

            def add_log(msg: str) -> None:
                logs.append(msg)
                area_logs.code("\n".join(logs[-18:]), language="text")

            try:
                destino = extrair_bussola_web_historico_todos(credenciais, data_inicio, data_fim, headless=headless, log_fn=add_log)
                st.success(f"Histórico atualizado: {destino}")
                st.cache_data.clear()
                st.rerun()
            except Exception as exc:
                st.error(f"Extração histórica interrompida: {exc}")

if vendas_historico.empty:
    st.info("Ainda não existe base histórica carregada.")
    st.stop()

vendas_historico["data_de_faturamento"] = pd.to_datetime(vendas_historico["data_de_faturamento"], errors="coerce")
base_periodo = vendas_historico[
    (vendas_historico["data_de_faturamento"] >= pd.Timestamp(data_inicio))
    & (vendas_historico["data_de_faturamento"] <= pd.Timestamp(data_fim) + pd.Timedelta(days=1) - pd.Timedelta(seconds=1))
    & (vendas_historico["status_normalizado"].isin(STATUS_FATURADOS))
].copy()
base_periodo["ano_mes"] = base_periodo["data_de_faturamento"].dt.to_period("M").astype(str)
meses = sorted(base_periodo["ano_mes"].dropna().astype(str).unique().tolist())

if not meses:
    st.info("A base histórica foi carregada, mas não há vendas no período selecionado.")
    st.stop()

with st.expander("Cadastrar metas de meses anteriores", expanded=False):
    mes_meta = st.selectbox("Mês para cadastrar meta", meses or [pd.Timestamp(data_inicio).strftime("%Y-%m")])
    meta_mes = _linha_meta(metas_historico, mes_meta)
    gerente = meta_mes["gerente_territorial"]
    g1, g2, g3, g4 = st.columns(4)
    gerente["ol_sem_combate"] = g1.number_input("Meta GD OL", min_value=0.0, step=1000.0, value=float(gerente.get("ol_sem_combate", 0) or 0), key=f"hist_gd_ol_{mes_meta}")
    gerente["ol_prioritarios"] = g2.number_input("Meta GD prioritários", min_value=0.0, step=1000.0, value=float(gerente.get("ol_prioritarios", 0) or 0), key=f"hist_gd_prio_{mes_meta}")
    gerente["ol_lancamentos"] = g3.number_input("Meta GD lançamentos", min_value=0.0, step=1000.0, value=float(gerente.get("ol_lancamentos", 0) or 0), key=f"hist_gd_lanc_{mes_meta}")
    gerente["clientes_positivados"] = g4.number_input("Meta GD clientes", min_value=0.0, step=1.0, value=float(gerente.get("clientes_positivados", 0) or 0), key=f"hist_gd_cli_{mes_meta}")

    st.markdown("#### Metas dos consultores")
    for idx, consultor in enumerate(consultores_unicos(clientes)):
        atual = meta_mes["consultores"].setdefault(consultor, {})
        st.markdown(f"<div class='consultor-name'>{consultor}</div>", unsafe_allow_html=True)
        c1, c2, c3, c4 = st.columns(4)
        atual["ol_sem_combate"] = c1.number_input("OL", min_value=0.0, step=1000.0, value=float(atual.get("ol_sem_combate", 0) or 0), key=f"hist_ol_{mes_meta}_{idx}")
        atual["ol_prioritarios"] = c2.number_input("Prioritários", min_value=0.0, step=1000.0, value=float(atual.get("ol_prioritarios", 0) or 0), key=f"hist_prio_{mes_meta}_{idx}")
        atual["ol_lancamentos"] = c3.number_input("Lançamentos", min_value=0.0, step=1000.0, value=float(atual.get("ol_lancamentos", 0) or 0), key=f"hist_lanc_{mes_meta}_{idx}")
        atual["clientes_positivados"] = c4.number_input("Clientes", min_value=0.0, step=1.0, value=float(atual.get("clientes_positivados", 0) or 0), key=f"hist_cli_{mes_meta}_{idx}")
    if st.button("Salvar metas históricas", width="stretch"):
        salvar_metas_historico(metas_historico)
        st.success("Metas históricas salvas.")
        st.rerun()

linhas_gd = []
linhas_consultores = []
for mes in meses:
    vendas_mes = base_periodo[base_periodo["ano_mes"].eq(mes)].copy()
    indicadores = calcular_indicadores(vendas_mes, clientes)
    meta_mes = _linha_meta(metas_historico, mes)
    meta_gd = meta_mes.get("gerente_territorial", {})
    linhas_gd.append(
        {
            "Mês": mes,
            "OL Sem Combate": indicadores["ol_sem_combate"],
            "Meta OL": float(meta_gd.get("ol_sem_combate", 0) or 0),
            "Ating. OL": indicadores["ol_sem_combate"] / float(meta_gd.get("ol_sem_combate", 0) or 0) if float(meta_gd.get("ol_sem_combate", 0) or 0) else 0,
            "OL Prioritários": indicadores["ol_prioritarios"],
            "OL Lançamentos": indicadores["ol_lancamentos"],
            "Clientes com venda": indicadores["clientes_positivados"],
        }
    )

    resultado_consultor = gerar_resultado_consultor(vendas_mes, clientes)
    for _, linha in resultado_consultor.iterrows():
        nome = str(linha["consultor"])
        meta_cons = meta_mes.get("consultores", {}).get(nome, {})
        meta_ol = float(meta_cons.get("ol_sem_combate", 0) or 0)
        linhas_consultores.append(
            {
                "Mês": mes,
                "Consultor": nome,
                "OL Sem Combate": float(linha.get("ol_sem_combate", 0) or 0),
                "Meta OL": meta_ol,
                "Ating. OL": float(linha.get("ol_sem_combate", 0) or 0) / meta_ol if meta_ol else 0,
                "OL Prioritários": float(linha.get("ol_prioritarios", 0) or 0),
                "OL Lançamentos": float(linha.get("ol_lancamentos", 0) or 0),
                "Clientes com venda": int(linha.get("clientes_com_compra", 0) or 0),
            }
        )

st.subheader("Resumo por GD")
resumo_gd = pd.DataFrame(linhas_gd)
resumo_gd_fmt = resumo_gd.copy()
for coluna in ["OL Sem Combate", "Meta OL", "OL Prioritários", "OL Lançamentos"]:
    if coluna in resumo_gd_fmt.columns:
        resumo_gd_fmt[coluna] = resumo_gd_fmt[coluna].apply(formatar_moeda)
if "Ating. OL" in resumo_gd_fmt.columns:
    resumo_gd_fmt["Ating. OL"] = resumo_gd_fmt["Ating. OL"].apply(formatar_percentual)
dataframe_com_download(resumo_gd_fmt, "historico_gd", altura=280)

st.subheader("Resumo por vendedor")
resumo_cons = pd.DataFrame(linhas_consultores)
resumo_cons_fmt = resumo_cons.copy()
for coluna in ["OL Sem Combate", "Meta OL", "OL Prioritários", "OL Lançamentos"]:
    if coluna in resumo_cons_fmt.columns:
        resumo_cons_fmt[coluna] = resumo_cons_fmt[coluna].apply(formatar_moeda)
if "Ating. OL" in resumo_cons_fmt.columns:
    resumo_cons_fmt["Ating. OL"] = resumo_cons_fmt["Ating. OL"].apply(formatar_percentual)
dataframe_com_download(resumo_cons_fmt, "historico_vendedores", altura=360)

st.subheader("Produtos vendidos no histórico")
produtos = (
    base_periodo.groupby(["ano_mes", "ean_limpo", "produto", "tipo_mix"], dropna=False)
    .agg(quantidade_vendida=("quantidade_base", "sum"), valor_vendido=("valor_vendido_sem_imposto", "sum"), clientes=("cnpj_limpo", "nunique"))
    .reset_index()
    .rename(columns={"ano_mes": "Mês", "ean_limpo": "EAN", "produto": "Produto", "tipo_mix": "Tipo mix", "quantidade_vendida": "Quantidade", "valor_vendido": "Valor", "clientes": "Clientes"})
)
produtos_fmt = produtos.copy()
produtos_fmt["Valor"] = produtos_fmt["Valor"].apply(formatar_moeda)
dataframe_com_download(produtos_fmt, "historico_produtos", altura=360)
