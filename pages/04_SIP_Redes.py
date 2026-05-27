from __future__ import annotations

import pandas as pd
import streamlit as st
from html import escape

from src.calculos import formatar_tabela_metricas, gerar_resultado_cliente
from src.datas import hoje_brasilia
from src.filtros import aplicar_filtros_globais
from src.layout import botao_download_excel, card_metrica, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados, fonte_ativa
from src.sip_calculos import calcular_indicadores_sip
from src.sip_store import (
    adicionar_recado_sip,
    adicionar_sip,
    atualizar_recado_sip,
    carregar_sips,
    excluir_recado_sip,
    excluir_sip,
    gerar_resumo_sips_manuais,
    normalizar_grupo_sip,
    opcoes_clientes_para_sip,
)
from src.status_bases import formatar_ultima_atualizacao
from src.tratamento import STATUS_CANCELADO, STATUS_FATURADOS, formatar_data, formatar_moeda, formatar_percentual


STATUS_RECADOS = ["Pendente", "Em andamento", "Concluído"]


def classe_status_recado(status: str) -> str:
    return {
        "Pendente": "recado-status-pendente",
        "Em andamento": "recado-status-em-andamento",
        "Concluído": "recado-status-concluido",
    }.get(status, "")


def imagem_recado_html(recado: dict) -> str:
    mime = str(recado.get("imagem_tipo") or "image/png")
    imagem = str(recado.get("imagem_base64") or "")
    if not imagem:
        return ""
    return f'<img src="data:{mime};base64,{imagem}" style="width:100%; border-radius:12px; border:1px solid #D7E5D5;" />'


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
form_key = str(editando["id"] if editando else "novo")

st.markdown(
    f"<span class='pill-note'>{'Editando SIP existente' if editando else 'Novo cadastro de SIP'}</span>",
    unsafe_allow_html=True,
)
opcoes_clientes = opcoes_clientes_para_sip(clientes_resultado)
redes_disponiveis = sorted(opcoes_clientes["rede"].dropna().astype(str).unique().tolist()) if not opcoes_clientes.empty else []

c1, c2, c3 = st.columns([1.8, 1.0, 1.0])
nome = c1.text_input(
    "Nome do SIP (opcional)",
    value=editando["nome"] if editando else "",
    key=f"sip_nome_{form_key}",
)
meta_mes = c2.number_input(
    "Meta do mês",
    min_value=0.0,
    step=100.0,
    value=float(editando["meta_mes"]) if editando else 0.0,
    key=f"sip_meta_{form_key}",
)
pagamento = c3.number_input(
    "Pagamento a partir de (%)",
    min_value=0.0,
    max_value=100.0,
    step=1.0,
    value=float(editando["pagamento_percentual"]) if editando else 80.0,
    key=f"sip_pagamento_{form_key}",
)

redes_default = [rede for rede in (editando["redes"] if editando else []) if rede in redes_disponiveis]
redes_sel = st.multiselect(
    "Rede / grupo econômico",
    redes_disponiveis,
    default=redes_default,
    key=f"sip_redes_{form_key}",
)

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
    key=f"sip_membros_{form_key}",
)
cnpjs = [label_to_cnpj[label] for label in membros if label in label_to_cnpj]
nome_final = nome.strip() or (redes_sel[0] if redes_sel else "")

s1, s2 = st.columns([1.2, 0.8])
rotulo_salvar = "Salvar alterações da SIP" if editando else "Cadastrar SIP"
if s1.button(rotulo_salvar, width="stretch", disabled=not nome_final or not cnpjs, key=f"salvar_sip_{form_key}"):
    adicionar_sip(
        nome=nome_final,
        redes=redes_sel,
        cnpjs=cnpjs,
        meta_mes=meta_mes,
        pagamento_percentual=pagamento,
        sip_id=editando["id"] if editando else None,
    )
    st.success("SIP salva com sucesso.")
    st.rerun()

if editando:
    s2.caption("Para criar outra SIP, escolha Novo cadastro na lista acima.")
    with st.expander("Excluir SIP selecionada", expanded=False):
        st.warning("A exclusão remove a SIP, os CNPJs vinculados e os recados cadastrados para ela.")
        confirmar = st.text_input("Digite EXCLUIR para confirmar", key=f"confirmar_excluir_sip_{form_key}")
        if st.button(
            "Excluir definitivamente esta SIP",
            width="stretch",
            disabled=confirmar.strip().upper() != "EXCLUIR",
            key=f"excluir_sip_{form_key}",
        ):
            excluir_sip(editando["id"])
            st.success("SIP removida.")
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

    st.subheader("Recados e alinhamentos da SIP")
    with st.expander("Adicionar recado com imagem", expanded=False):
        r1, r2 = st.columns([1.4, 0.6])
        titulo_recado = r1.text_input("Título do recado", placeholder="Ex.: Campanha Copa do Mundo", key=f"recado_titulo_{grupo['id']}")
        status_recado = r2.selectbox("Status", STATUS_RECADOS, key=f"recado_status_{grupo['id']}")
        comentario_recado = st.text_area("Comentário", placeholder="Escreva o alinhamento que o cliente SIP deve visualizar.", key=f"recado_comentario_{grupo['id']}")
        imagem_recado = st.file_uploader("Imagem do recado", type=["png", "jpg", "jpeg", "webp"], key=f"recado_imagem_{grupo['id']}")
        if st.button("Salvar recado da SIP", width="stretch", key=f"salvar_recado_{grupo['id']}"):
            try:
                adicionar_recado_sip(grupo["id"], titulo_recado, comentario_recado, status_recado, imagem_recado)
                st.success("Recado salvo para esta SIP.")
                st.rerun()
            except Exception as exc:
                st.warning(f"Não consegui salvar o recado: {exc}")

    recados = grupo.get("recados", [])
    if not recados:
        st.info("Nenhum recado cadastrado para esta SIP.")
    else:
        for recado in recados:
            recado_id = str(recado.get("id", ""))
            status_atual = str(recado.get("status", "Pendente"))
            titulo_atual = str(recado.get("titulo", "Recado"))
            comentario_atual = str(recado.get("comentario", ""))
            st.markdown(
                f"""
                <div class="recado-card">
                    <div class="recado-title">{escape(titulo_atual)}</div>
                    <span class="recado-status {classe_status_recado(status_atual)}">{escape(status_atual)}</span>
                    {imagem_recado_html(recado)}
                    <div class="recado-comment">{escape(comentario_atual)}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
            with st.expander(f"Editar recado — {titulo_atual}", expanded=False):
                e1, e2 = st.columns([1.4, 0.6])
                titulo_editado = e1.text_input(
                    "Título",
                    value=titulo_atual,
                    key=f"editar_titulo_recado_{grupo['id']}_{recado_id}",
                )
                status_editado = e2.selectbox(
                    "Status",
                    STATUS_RECADOS,
                    index=STATUS_RECADOS.index(status_atual) if status_atual in STATUS_RECADOS else 0,
                    key=f"editar_status_recado_{grupo['id']}_{recado_id}",
                )
                comentario_editado = st.text_area(
                    "Comentário",
                    value=comentario_atual,
                    key=f"editar_comentario_recado_{grupo['id']}_{recado_id}",
                )
                nova_imagem = st.file_uploader(
                    "Trocar imagem (opcional)",
                    type=["png", "jpg", "jpeg", "webp"],
                    key=f"editar_imagem_recado_{grupo['id']}_{recado_id}",
                )
                b1, b2 = st.columns([1.2, 0.8])
                if b1.button("Salvar ajustes do recado", width="stretch", key=f"salvar_ajuste_recado_{grupo['id']}_{recado_id}"):
                    atualizar_recado_sip(grupo["id"], recado_id, titulo_editado, comentario_editado, status_editado, nova_imagem)
                    st.success("Recado atualizado.")
                    st.rerun()
                confirmar_recado = b2.checkbox("Confirmar exclusão", key=f"confirmar_excluir_recado_{grupo['id']}_{recado_id}")
                if b2.button(
                    "Excluir recado",
                    width="stretch",
                    disabled=not confirmar_recado,
                    key=f"excluir_recado_{grupo['id']}_{recado_id}",
                ):
                    excluir_recado_sip(grupo["id"], recado_id)
                    st.success("Recado excluído.")
                    st.rerun()

    st.subheader("Pedidos e notas da SIP")
    p1, p2, p3 = st.columns(3)
    data_inicial = p1.date_input("Data inicial", value=filtros["inicio"].date(), format="DD/MM/YYYY", key="sip_data_inicial")
    data_final = p2.date_input("Data final", value=filtros["fim"].date(), format="DD/MM/YYYY", key="sip_data_final")
    status_sel = p3.selectbox("Status do pedido", ["Todos", "Faturados", "Sem nota", "Cancelados"], key="sip_status_pedido")

    resultado_sip = calcular_indicadores_sip(vendas, clientes, grupo, data_inicial, data_final, status_sel)
    grupo = resultado_sip["grupo"]
    membros_sip = resultado_sip["membros_sip"]
    pedidos = resultado_sip["pedidos"]
    faturados = resultado_sip["faturados"]
    sem_nota = resultado_sip["sem_nota"]
    cancelados = resultado_sip["cancelados"]
    pagamento_minimo = resultado_sip["pagamento_percentual"]

    c1, c2, c3 = st.columns(3)
    with c1:
        card_metrica("CNPJs", str(resultado_sip["cnpjs"]))
    with c2:
        card_metrica("Meta", formatar_moeda(resultado_sip["meta"]))
    with c3:
        card_metrica("Faturado", formatar_moeda(resultado_sip["faturado"]))
    c4, c5, c6 = st.columns(3)
    with c4:
        card_metrica("OL prioritários", formatar_moeda(resultado_sip["ol_prioritarios"]))
    with c5:
        card_metrica("OL lançamentos", formatar_moeda(resultado_sip["ol_lancamentos"]))
    with c6:
        card_metrica("Falta regra", formatar_moeda(resultado_sip["falta_regra"]))
    st.markdown(
        f"<span class='pill-note'>Atingimento: {formatar_percentual(resultado_sip['atingimento'])}</span>"
        f"<span class='pill-note'>Pagamento a partir de {pagamento_minimo:.0f}%</span>",
        unsafe_allow_html=True,
    )

    m1, m2, m3 = st.columns(3)
    with m1:
        card_metrica("Pedidos faturados", str(len(faturados)), f"{formatar_moeda(faturados['valor_vendido_sem_imposto'].sum())} faturado")
    with m2:
        card_metrica("Sem nota", str(len(sem_nota)), f"{formatar_moeda(sem_nota['valor_vendido_sem_imposto'].sum())} a faturar")
    with m3:
        card_metrica("Cancelados", str(len(cancelados)), f"{formatar_moeda(cancelados['valor_vendido_sem_imposto'].sum())} cancelado")

    with st.expander("Conferência de cálculo", expanded=False):
        st.write(
            {
                "sip_param_recebido": grupo_nome,
                "sip_normalizada": grupo["id"],
                "nome_da_sip": grupo["nome"],
                "data_inicial_aplicada": formatar_data(data_inicial),
                "data_final_aplicada": formatar_data(data_final),
                "status_aplicado": status_sel,
                "linhas_de_venda_usadas": resultado_sip["linhas_venda_usadas"],
                "linhas_de_pedidos_usadas": resultado_sip["linhas_pedidos_usados"],
                "soma_bruta_faturamento": formatar_moeda(resultado_sip["soma_bruta_faturamento"]),
                "fonte_bussola": fonte_ativa("bussola"),
                "ultima_atualizacao_bussola": formatar_ultima_atualizacao("bussola"),
            }
        )

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
    with st.expander(f"Pedidos detalhados — {len(faturados)} pedidos faturados | {len(cancelados)} cancelados", expanded=False):
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
    cnpjs_com_venda = int((membros_sip["ol_sem_combate"] > 0).sum()) if not membros_sip.empty else 0
    with st.expander(f"Vendas por CNPJ — {cnpjs_com_venda} CNPJs com venda", expanded=False):
        dataframe_com_download(detalhe, "sip_vendas_por_cnpj", altura=420)
