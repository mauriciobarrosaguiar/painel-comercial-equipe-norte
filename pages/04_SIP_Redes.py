from __future__ import annotations

import pandas as pd
import streamlit as st

from src.calculos import formatar_tabela_metricas, gerar_resultado_cliente
from src.datas import hoje_brasilia
from src.filtros import aplicar_filtros_globais
from src.layout import botao_download_excel, card_metrica, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.sip_store import (
    adicionar_sip,
    carregar_sips,
    excluir_sip,
    gerar_resumo_sips_manuais,
    normalizar_grupo_sip,
    opcoes_clientes_para_sip,
)
from src.tratamento import STATUS_CANCELADO, STATUS_FATURADOS, formatar_data, formatar_moeda, formatar_percentual


def falta_regra(valor: float, meta: float, pagamento: float) -> float:
    return max(float(meta or 0) * (float(pagamento or 0) / 100) - float(valor or 0), 0)


def categoria_pedido(linha: pd.Series) -> str:
    status = str(linha.get("status_normalizado", ""))
    nota = str(linha.get("nota_fiscal", "") or "").strip()
    if status == STATUS_CANCELADO:
        return "Cancelado"
    if status in STATUS_FATURADOS and nota:
        return "Faturado / nota gerada"
    if not nota:
        return "Ainda não gerou nota"
    return "Em andamento"


def preparar_pedidos_sip(vendas_base: pd.DataFrame) -> pd.DataFrame:
    if vendas_base.empty:
        return pd.DataFrame(
            columns=[
                "categoria",
                "pedido_id",
                "nota_fiscal",
                "status_pedido",
                "status_normalizado",
                "cnpj_limpo",
                "nome_pdv",
                "cidade",
                "uf",
                "data_base",
                "valor_vendido_sem_imposto",
            ]
        )
    base = vendas_base.copy()
    agrupado = (
        base.groupby(
            [
                "pedido_id",
                "nota_fiscal",
                "status_pedido",
                "status_normalizado",
                "cnpj_limpo",
                "nome_pdv",
                "cidade",
                "uf",
                "data_base",
            ],
            dropna=False,
        )
        .agg(valor_vendido_sem_imposto=("valor_vendido_sem_imposto", "sum"))
        .reset_index()
    )
    agrupado["categoria"] = agrupado.apply(categoria_pedido, axis=1)
    return agrupado.sort_values("data_base", ascending=False)


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]

titulo_pagina("SIP")

vendas_f, clientes_f, filtros = aplicar_filtros_globais(vendas, clientes, chave="sip")
clientes_resultado = gerar_resultado_cliente(vendas_f, clientes_f)

grupos = [normalizar_grupo_sip(grupo) for grupo in carregar_sips()]
resumo_sips = gerar_resumo_sips_manuais(clientes_resultado)

st.subheader("Panorama das SIPs")
if resumo_sips.empty:
    st.info("Nenhum SIP cadastrado.")
else:
    for fatia in [resumo_sips.iloc[i : i + 2] for i in range(0, len(resumo_sips), 2)]:
        cols = st.columns(2)
        for col, (_, sip) in zip(cols, fatia.iterrows()):
            with col:
                st.markdown(
                    f"""
                    <div class="consultor-card">
                        <div class="consultor-name">{sip['sip']}</div>
                        <div class="mini-grid">
                            <div class="mini-metric"><div class="mini-label">CNPJs</div><div class="mini-value">{int(sip['cnpjs'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Meta</div><div class="mini-value">{formatar_moeda(sip['meta_mes'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Faturado</div><div class="mini-value">{formatar_moeda(sip['ol_sem_combate'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Ating.</div><div class="mini-value">{formatar_percentual(sip['atingimento_meta'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Prio</div><div class="mini-value">{formatar_moeda(sip['ol_prioritarios'])}</div></div>
                            <div class="mini-metric"><div class="mini-label">Sem compra</div><div class="mini-value">{int(sip['cnpjs_sem_compra'])}</div></div>
                        </div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

st.subheader("Cadastro")
if st.button("Cadastrar nova SIP", width="stretch"):
    st.session_state["sip_cadastro_nome"] = "Novo cadastro"
    st.rerun()

nomes = ["Novo cadastro"] + [grupo["nome"] for grupo in grupos]
valor_atual = st.session_state.get("sip_cadastro_nome", "Novo cadastro")
indice_atual = nomes.index(valor_atual) if valor_atual in nomes else 0
escolha = st.selectbox("SIP cadastrada para editar", nomes, index=indice_atual, key="sip_cadastro_nome")
editando = next((grupo for grupo in grupos if grupo["nome"] == escolha), None) if escolha != "Novo cadastro" else None

opcoes_clientes = opcoes_clientes_para_sip(clientes_resultado)
redes_disponiveis = sorted(opcoes_clientes["rede"].dropna().astype(str).unique().tolist()) if not opcoes_clientes.empty else []

c1, c2, c3 = st.columns([1.8, 1.0, 1.0])
nome = c1.text_input("Nome do SIP (opcional)", value=editando["nome"] if editando else "")
meta_mes = c2.number_input("Meta do mês", min_value=0.0, step=100.0, value=float(editando["meta_mes"]) if editando else 0.0)
pagamento = c3.number_input("Pagamento a partir de (%)", min_value=0.0, max_value=100.0, step=1.0, value=float(editando["pagamento_percentual"]) if editando else 80.0)

redes_default = [rede for rede in (editando["redes"] if editando else []) if rede in redes_disponiveis]
redes_sel = st.multiselect("Rede / grupo econômico", redes_disponiveis, default=redes_default)

clientes_opcoes = opcoes_clientes.copy()
if redes_sel:
    clientes_opcoes = clientes_opcoes[clientes_opcoes["rede"].isin(redes_sel)].copy()
label_to_cnpj = dict(zip(clientes_opcoes["label"], clientes_opcoes["cnpj_limpo"])) if not clientes_opcoes.empty else {}
labels_edicao = []
if editando and not clientes_opcoes.empty:
    labels_edicao = clientes_opcoes[clientes_opcoes["cnpj_limpo"].isin(editando["cnpjs"])]["label"].tolist()

membros = st.multiselect(
    "CNPJs da SIP",
    clientes_opcoes["label"].tolist() if not clientes_opcoes.empty else [],
    default=labels_edicao,
)
cnpjs = [label_to_cnpj[label] for label in membros if label in label_to_cnpj]
nome_final = nome.strip() or (redes_sel[0] if redes_sel else "")

s1, s2 = st.columns(2)
if s1.button("Salvar SIP", width="stretch", disabled=not nome_final or not cnpjs):
    adicionar_sip(
        nome=nome_final,
        redes=redes_sel,
        cnpjs=cnpjs,
        meta_mes=meta_mes,
        pagamento_percentual=pagamento,
        sip_id=editando["id"] if editando else None,
    )
    st.success("SIP salva.")
    st.rerun()

if editando:
    confirmar = st.checkbox("Confirmo que desejo excluir este SIP")
    if s2.button("Excluir SIP", width="stretch", disabled=not confirmar):
        excluir_sip(editando["id"])
        st.success("SIP removido.")
        st.rerun()

st.subheader("Painel SIP")
if not grupos:
    st.info("Cadastre uma SIP para analisar pedidos, notas e CNPJs.")
else:
    nomes_analise = [grupo["nome"] for grupo in grupos]
    grupo_nome = st.selectbox("Grupo para análise", nomes_analise, key="sip_grupo_analise")
    grupo = next(grupo for grupo in grupos if grupo["nome"] == grupo_nome)
    link_sip = f"?sip={grupo['id']}"
    st.markdown(
        f"""
        <div class="small-update">
            <div class="small-update-title">Link do cliente SIP</div>
            <div class="metric-note">Compartilhe este acesso para a SIP acompanhar os resultados sem o menu interno.</div>
            <div class="small-update-value">{link_sip}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.link_button("Abrir visão do cliente SIP", link_sip, width="stretch")
    membros_sip = clientes_resultado[clientes_resultado["cnpj_limpo"].astype(str).isin(grupo["cnpjs"])].copy()
    ol = float(membros_sip["ol_sem_combate"].sum()) if not membros_sip.empty else 0
    prio = float(membros_sip["ol_prioritarios"].sum()) if not membros_sip.empty else 0
    lanc = float(membros_sip["ol_lancamentos"].sum()) if not membros_sip.empty else 0
    meta = float(grupo["meta_mes"] or 0)
    pagamento_minimo = float(grupo["pagamento_percentual"] or 80)

    c1, c2, c3 = st.columns(3)
    with c1:
        card_metrica("CNPJs", str(len(grupo["cnpjs"])))
    with c2:
        card_metrica("Meta", formatar_moeda(meta))
    with c3:
        card_metrica("Faturado", formatar_moeda(ol))
    c4, c5, c6 = st.columns(3)
    with c4:
        card_metrica("OL prioritários", formatar_moeda(prio))
    with c5:
        card_metrica("OL lançamentos", formatar_moeda(lanc))
    with c6:
        card_metrica("Falta regra", formatar_moeda(falta_regra(ol, meta, pagamento_minimo)))
    st.markdown(
        f"<span class='pill-note'>Atingimento: {formatar_percentual(ol / meta if meta else 0)}</span>"
        f"<span class='pill-note'>Pagamento a partir de {pagamento_minimo:.0f}%</span>",
        unsafe_allow_html=True,
    )

    st.subheader("Pedidos e notas da SIP")
    vendas_sip_total = vendas[vendas["cnpj_limpo"].astype(str).isin(grupo["cnpjs"])].copy()
    datas = pd.to_datetime(vendas_sip_total.get("data_base"), errors="coerce")
    data_min = datas.min()
    data_max = datas.max()
    if pd.isna(data_min) or pd.isna(data_max):
        hoje = hoje_brasilia()
        data_min = pd.Timestamp(hoje.replace(day=1))
        data_max = pd.Timestamp(hoje)

    p1, p2, p3 = st.columns(3)
    data_inicial = p1.date_input("Data inicial", value=filtros["inicio"].date(), format="DD/MM/YYYY", key="sip_data_inicial")
    data_final = p2.date_input("Data final", value=filtros["fim"].date(), format="DD/MM/YYYY", key="sip_data_final")
    status_sel = p3.selectbox("Status do pedido", ["Todos", "Faturados", "Sem nota", "Cancelados"], key="sip_status_pedido")

    vendas_sip = vendas_sip_total[
        (pd.to_datetime(vendas_sip_total["data_base"], errors="coerce") >= pd.Timestamp(data_inicial))
        & (pd.to_datetime(vendas_sip_total["data_base"], errors="coerce") <= pd.Timestamp(data_final) + pd.Timedelta(days=1) - pd.Timedelta(seconds=1))
    ].copy()
    pedidos = preparar_pedidos_sip(vendas_sip)
    if status_sel == "Faturados":
        pedidos = pedidos[pedidos["categoria"].eq("Faturado / nota gerada")].copy()
    elif status_sel == "Sem nota":
        pedidos = pedidos[pedidos["categoria"].eq("Ainda não gerou nota")].copy()
    elif status_sel == "Cancelados":
        pedidos = pedidos[pedidos["categoria"].eq("Cancelado")].copy()

    faturados = pedidos[pedidos["categoria"].eq("Faturado / nota gerada")]
    sem_nota = pedidos[pedidos["categoria"].eq("Ainda não gerou nota")]
    cancelados = pedidos[pedidos["categoria"].eq("Cancelado")]
    m1, m2, m3 = st.columns(3)
    with m1:
        card_metrica("Pedidos faturados", str(len(faturados)), f"{formatar_moeda(faturados['valor_vendido_sem_imposto'].sum())} faturado")
    with m2:
        card_metrica("Sem nota", str(len(sem_nota)), f"{formatar_moeda(sem_nota['valor_vendido_sem_imposto'].sum())} a faturar")
    with m3:
        card_metrica("Cancelados", str(len(cancelados)), f"{formatar_moeda(cancelados['valor_vendido_sem_imposto'].sum())} cancelado")

    pedidos_exportar = pedidos.rename(
        columns={
            "categoria": "Categoria",
            "pedido_id": "Pedido",
            "nota_fiscal": "Nota fiscal",
            "status_pedido": "Status",
            "cnpj_limpo": "CNPJ",
            "nome_pdv": "Cliente",
            "cidade": "Cidade",
            "uf": "UF",
            "data_base": "Data pedido",
            "valor_vendido_sem_imposto": "Valor",
        }
    )[
        ["Categoria", "Pedido", "Nota fiscal", "Status", "CNPJ", "Cliente", "Cidade", "UF", "Data pedido", "Valor"]
    ]
    pedidos_visual = pedidos_exportar.copy()
    pedidos_visual["Data pedido"] = pedidos_visual["Data pedido"].apply(formatar_data)
    pedidos_visual["Valor"] = pedidos_visual["Valor"].apply(formatar_moeda)
    botao_download_excel(pedidos_visual, "pedidos_detalhados_sip.xlsx", "Extrair pedidos detalhados da SIP")
    st.dataframe(pedidos_visual, width="stretch", height=360)

    detalhe = formatar_tabela_metricas(
        membros_sip[
            [
                "cnpj_limpo",
                "nome_pdv",
                "consultor",
                "cidade",
                "uf",
                "ol_sem_combate",
                "ol_prioritarios",
                "ol_lancamentos",
                "ultima_compra",
                "status_comercial",
            ]
        ]
    ).rename(
        columns={
            "cnpj_limpo": "CNPJ",
            "nome_pdv": "Cliente",
            "consultor": "Consultor",
            "cidade": "Cidade",
            "uf": "UF",
            "ol_sem_combate": "Faturado",
            "ol_prioritarios": "Prioritários",
            "ol_lancamentos": "Lançamentos",
            "ultima_compra": "Última compra",
            "status_comercial": "Status",
        }
    )
    st.subheader("Vendas por CNPJ")
    dataframe_com_download(detalhe, "sip_vendas_por_cnpj", altura=420)
