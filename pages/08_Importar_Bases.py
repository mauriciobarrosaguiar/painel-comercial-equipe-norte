from __future__ import annotations

import pandas as pd
import streamlit as st

from src.bussola_web import extrair_bussola_web_todos
from src.configuracoes import (
    carregar_ajustes_vendedores,
    carregar_login_bussola,
    carregar_metas,
    consultores_unicos,
    salvar_ajustes_vendedores,
    salvar_login_bussola,
    salvar_metas,
)
from src.layout import botao_download_excel, titulo_pagina
from src.loader import carregar_dados_tratados, fonte_ativa, limpar_uploads, modelo_acoes, modelo_produtos_mix, registrar_upload
from src.status_bases import formatar_ultima_atualizacao
from src.tratamento import formatar_moeda, slug_coluna


def credenciais_dataframe(consultores: list[str], login_salvo: dict) -> pd.DataFrame:
    salvos = login_salvo.get("consultores", {})
    linhas = []
    for consultor in consultores:
        item = salvos.get(consultor, {})
        linhas.append(
            {
                "consultor": consultor,
                "usuario": item.get("usuario", ""),
                "senha": item.get("senha", ""),
                "extrair": bool(item.get("extrair", True)),
            }
        )
    return pd.DataFrame(linhas)


def metas_dataframe(consultores: list[str], metas: dict) -> pd.DataFrame:
    salvas = metas.get("consultores", {})
    linhas = []
    for consultor in consultores:
        item = salvas.get(consultor, {})
        linhas.append(
            {
                "consultor": consultor,
                "ol_sem_combate": float(item.get("ol_sem_combate", 0) or 0),
                "ol_prioritarios": float(item.get("ol_prioritarios", 0) or 0),
                "ol_lancamentos": float(item.get("ol_lancamentos", 0) or 0),
                "clientes_positivados": float(item.get("clientes_positivados", 0) or 0),
            }
        )
    return pd.DataFrame(linhas)


def _cartao_meta_resumo(titulo: str, valor: str, detalhe: str) -> str:
    return f"""
    <div class="small-update">
        <div class="small-update-title">{titulo}</div>
        <div class="small-update-value">{valor}</div>
        <div class="metric-note">{detalhe}</div>
    </div>
    """


def _numero_seguro(valor: object) -> float:
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return 0.0
    return numero if pd.notna(numero) else 0.0


dados = carregar_dados_tratados()
clientes = dados["clientes"]
consultores = consultores_unicos(clientes)
nomes_gd = clientes["nome_gd"].dropna().astype(str).str.strip() if not clientes.empty and "nome_gd" in clientes.columns else pd.Series(dtype=str)
nome_gd = nomes_gd[nomes_gd.ne("")].iloc[0] if not nomes_gd[nomes_gd.ne("")].empty else "Gerente Distrital"

titulo_pagina("Importação")

mensagem_upload = st.session_state.pop("mensagem_upload_salvo", "")
if mensagem_upload:
    st.success(mensagem_upload)

tab_bussola, tab_vendedores, tab_metas, tab_arquivos = st.tabs(["Bússola Web", "Vendedores", "Metas", "Arquivos"])

with tab_bussola:
    st.subheader("Acesso ao Bússola Web")
    login = carregar_login_bussola()
    headless = st.toggle("Rodar navegador oculto", value=bool(login.get("headless", False)))

    st.markdown(f"<div class='consultor-name'>GD - {nome_gd}</div>", unsafe_allow_html=True)
    gd_salvo = login.get("gd", {})
    gd1, gd2, gd3 = st.columns([1.4, 1.4, 0.8])
    gd_usuario = gd1.text_input("Login / e-mail da GD", value=gd_salvo.get("usuario", ""), key="bussola_gd_usuario")
    gd_senha = gd2.text_input("Senha da GD", value=gd_salvo.get("senha", ""), type="password", key="bussola_gd_senha")
    usar_gd = gd3.checkbox("Usar GD", value=bool(gd_salvo.get("usar_gd", True)), key="bussola_gd_usar")
    st.caption("Se o acesso da GD estiver preenchido e marcado, a extração roda somente pela GD, pois ela já baixa a base de todos os vendedores.")
    st.divider()

    st.subheader("Acesso dos consultores")
    credenciais_editadas = {}
    salvos = login.get("consultores", {})
    for idx, consultor in enumerate(consultores):
        item = salvos.get(consultor, {})
        st.markdown(f"<div class='consultor-name'>{consultor}</div>", unsafe_allow_html=True)
        c1, c2, c3 = st.columns([1.4, 1.4, 0.5])
        usuario = c1.text_input("Login / e-mail", value=item.get("usuario", ""), key=f"bussola_usuario_{idx}")
        senha = c2.text_input("Senha", value=item.get("senha", ""), type="password", key=f"bussola_senha_{idx}")
        extrair = c3.checkbox("Extrair", value=bool(item.get("extrair", True)), key=f"bussola_extrair_{idx}")
        credenciais_editadas[consultor] = {"usuario": usuario.strip(), "senha": senha.strip(), "extrair": extrair}
        st.divider()

    gd_editada = {"usuario": gd_usuario.strip(), "senha": gd_senha.strip(), "usar_gd": usar_gd}
    col1, col2 = st.columns(2)
    if col1.button("Salvar acessos", width="stretch"):
        salvar_login_bussola(credenciais_editadas, headless, gd=gd_editada)
        st.success("Acessos salvos para os próximos usos.")

    if col2.button("Extrair Bússola agora", width="stretch"):
        salvar_login_bussola(credenciais_editadas, headless, gd=gd_editada)

        if usar_gd and gd_usuario.strip() and gd_senha.strip():
            solicitados = [{"consultor": f"GD - {nome_gd}", "usuario": gd_usuario.strip(), "senha": gd_senha.strip()}]
            incompletos = []
        else:
            solicitados = []
            for consultor, item in credenciais_editadas.items():
                if item["extrair"]:
                    solicitados.append({"consultor": consultor, "usuario": item["usuario"], "senha": item["senha"]})
            incompletos = [c["consultor"] for c in solicitados if not c["usuario"] or not c["senha"]]

        credenciais = [c for c in solicitados if c["usuario"] and c["senha"]]
        if not solicitados:
            st.warning("Marque pelo menos um consultor para extrair.")
        elif not credenciais:
            st.error("Nenhum consultor marcado tem login e senha preenchidos.")
        else:
            if incompletos:
                st.warning("Sem login/senha, estes consultores foram ignorados nesta execução: " + ", ".join(incompletos))
            logs: list[str] = []
            area_logs = st.empty()
            progresso = st.progress(0)

            def add_log(msg: str) -> None:
                logs.append(msg)
                area_logs.code("\n".join(logs[-18:]), language="text")
                if credenciais:
                    concluidos = sum(1 for linha in logs if ": ok -" in linha or "erro na etapa" in linha)
                    progresso.progress(min(concluidos / len(credenciais), 1.0))

            try:
                destino = extrair_bussola_web_todos(credenciais, headless=headless, log_fn=add_log)
                progresso.progress(1.0)
                st.success(f"Base consolidada atualizada: {destino}")
                st.cache_data.clear()
            except Exception as exc:
                st.error(f"Extração interrompida: {exc}")

with tab_vendedores:
    st.subheader("Ajustar vendedores do painel")
    st.caption("Use esta tela para trocar nomes como VAGO por vendedor contratado, sem alterar a planilha original enviada.")

    ajustes = carregar_ajustes_vendedores()
    base_vendedores = clientes.copy()
    if "nome_rep_original" not in base_vendedores.columns:
        base_vendedores["nome_rep_original"] = base_vendedores.get("nome_rep", "").fillna("").astype(str)
    if "setor_rep" not in base_vendedores.columns:
        base_vendedores["setor_rep"] = ""

    opcoes_setor = (
        base_vendedores[["setor_rep", "nome_rep_original", "nome_rep"]]
        .fillna("")
        .astype(str)
        .drop_duplicates()
        .sort_values(["setor_rep", "nome_rep_original"])
        .reset_index(drop=True)
    )
    opcoes_setor["label"] = opcoes_setor.apply(
        lambda linha: f"{linha['setor_rep'] or 'Sem setor'} | {linha['nome_rep_original'] or linha['nome_rep']}",
        axis=1,
    )
    mapa_setor = {linha["label"]: linha for _, linha in opcoes_setor.iterrows()}

    st.markdown("#### Novo ajuste")
    a1, a2 = st.columns([1.2, 1.0])
    escolha_setor = a1.selectbox(
        "Setor / nome atual no painel",
        ["Selecione"] + list(mapa_setor.keys()),
        key="novo_ajuste_vendedor_setor",
    )
    info_setor = mapa_setor.get(escolha_setor)
    nome_sugerido = str(info_setor.get("nome_rep") if info_setor is not None else "") if info_setor is not None else ""
    novo_nome = a2.text_input("Novo nome do vendedor", value="" if nome_sugerido.startswith("VAGO") else "", key="novo_ajuste_vendedor_nome")

    if st.button("Salvar novo ajuste de vendedor", width="stretch", disabled=info_setor is None or not novo_nome.strip()):
        setor = str(info_setor.get("setor_rep", "") or "").strip()
        nome_atual = str(info_setor.get("nome_rep_original", "") or info_setor.get("nome_rep", "") or "").strip()
        ajuste_id = slug_coluna(f"{setor}-{nome_atual}")
        ajustes = [ajuste for ajuste in ajustes if str(ajuste.get("id")) != ajuste_id]
        ajustes.append(
            {
                "id": ajuste_id,
                "setor_rep": setor,
                "nome_atual": nome_atual,
                "nome_novo": novo_nome.strip().upper(),
                "ativo": True,
            }
        )
        salvar_ajustes_vendedores(ajustes)
        st.cache_data.clear()
        st.success("Ajuste salvo. O vendedor já passa a aparecer com o novo nome no painel.")
        st.rerun()

    st.markdown("#### Ajustes cadastrados")
    if not ajustes:
        st.info("Nenhum ajuste de vendedor cadastrado.")
    else:
        for idx, ajuste in enumerate(ajustes):
            ajuste_id = str(ajuste.get("id", idx))
            st.markdown(f"<div class='consultor-name'>{ajuste.get('setor_rep') or 'Sem setor'} - {ajuste.get('nome_atual', '')}</div>", unsafe_allow_html=True)
            e1, e2, e3, e4 = st.columns([0.9, 1.2, 1.2, 0.5])
            setor_edit = e1.text_input("Setor", value=str(ajuste.get("setor_rep", "") or ""), key=f"ajuste_setor_{ajuste_id}")
            atual_edit = e2.text_input("Nome atual", value=str(ajuste.get("nome_atual", "") or ""), key=f"ajuste_atual_{ajuste_id}")
            novo_edit = e3.text_input("Nome ajustado", value=str(ajuste.get("nome_novo", "") or ""), key=f"ajuste_novo_{ajuste_id}")
            ativo_edit = e4.checkbox("Ativo", value=bool(ajuste.get("ativo", True)), key=f"ajuste_ativo_{ajuste_id}")

            b1, b2 = st.columns([1.2, 0.8])
            if b1.button("Salvar alteração", width="stretch", key=f"salvar_ajuste_vendedor_{ajuste_id}", disabled=not novo_edit.strip()):
                ajustes[idx] = {
                    "id": ajuste_id,
                    "setor_rep": setor_edit.strip(),
                    "nome_atual": atual_edit.strip(),
                    "nome_novo": novo_edit.strip().upper(),
                    "ativo": ativo_edit,
                }
                salvar_ajustes_vendedores(ajustes)
                st.cache_data.clear()
                st.success("Ajuste atualizado.")
                st.rerun()

            confirmar_exclusao = b2.checkbox("Excluir", key=f"confirmar_excluir_ajuste_{ajuste_id}")
            if b2.button("Excluir ajuste", width="stretch", key=f"excluir_ajuste_vendedor_{ajuste_id}", disabled=not confirmar_exclusao):
                salvar_ajustes_vendedores([item for item in ajustes if str(item.get("id")) != ajuste_id])
                st.cache_data.clear()
                st.success("Ajuste removido.")
                st.rerun()
            st.divider()

    if ajustes:
        st.caption("Prévia dos CNPJs afetados pelos ajustes ativos.")
        previa = base_vendedores[base_vendedores.get("vendedor_ajustado", False).astype(bool)].copy() if "vendedor_ajustado" in base_vendedores.columns else pd.DataFrame()
        if previa.empty:
            st.info("Nenhum cliente está sendo alterado pelos ajustes ativos neste momento.")
        else:
            st.dataframe(
                previa[["setor_rep", "nome_rep_original", "nome_rep", "cnpj_limpo", "nome_pdv"]].rename(
                    columns={
                        "setor_rep": "Setor",
                        "nome_rep_original": "Nome original",
                        "nome_rep": "Nome ajustado",
                        "cnpj_limpo": "CNPJ",
                        "nome_pdv": "Cliente",
                    }
                ),
                width="stretch",
                hide_index=True,
            )

with tab_metas:
    st.subheader("Ajustes de metas")
    metas = carregar_metas()
    gerente = metas.get("gerente_territorial", {})
    st.caption("As metas salvas aqui alimentam a Visão Geral e a página Consultores. Use este ajuste para o mês atual.")

    st.markdown(f"<div class='consultor-name'>GD - {nome_gd}</div>", unsafe_allow_html=True)
    g1, g2, g3, g4 = st.columns(4)
    meta_ol = g1.number_input("Meta OL sem combate", min_value=0.0, step=1000.0, value=float(gerente.get("ol_sem_combate", 0) or 0), key="meta_gd_ol")
    meta_prio = g2.number_input("Meta OL prioritários", min_value=0.0, step=1000.0, value=float(gerente.get("ol_prioritarios", 0) or 0), key="meta_gd_prio")
    meta_lanc = g3.number_input("Meta OL lançamentos", min_value=0.0, step=1000.0, value=float(gerente.get("ol_lancamentos", 0) or 0), key="meta_gd_lanc")
    meta_cli = g4.number_input("Meta clientes com venda", min_value=0.0, step=1.0, value=float(gerente.get("clientes_positivados", 0) or 0), key="meta_gd_cli")

    st.subheader("Metas dos consultores")
    metas_consultores = metas.get("consultores", {})
    busca_meta = st.text_input("Buscar consultor para ajustar meta", placeholder="Digite parte do nome", key="buscar_meta_consultor")
    consultores_visiveis = [
        consultor
        for consultor in consultores
        if not busca_meta.strip() or busca_meta.strip().upper() in consultor.upper()
    ]
    metas_editadas = {consultor: dict(metas_consultores.get(consultor, {})) for consultor in consultores}
    if not consultores_visiveis:
        st.info("Nenhum consultor encontrado para a busca.")

    for idx, consultor in enumerate(consultores):
        if consultor not in consultores_visiveis:
            continue
        atual = metas_consultores.get(consultor, {})
        st.markdown(f"<div class='consultor-name'>{consultor}</div>", unsafe_allow_html=True)
        c1, c2, c3, c4 = st.columns(4)
        chave_consultor = f"{idx}_{slug_coluna(consultor)}"
        metas_editadas[consultor] = {
            "ol_sem_combate": c1.number_input(
                "OL sem combate",
                min_value=0.0,
                step=1000.0,
                value=float(atual.get("ol_sem_combate", 0) or 0),
                key=f"meta_ol_{chave_consultor}",
            ),
            "ol_prioritarios": c2.number_input(
                "OL prioritários",
                min_value=0.0,
                step=1000.0,
                value=float(atual.get("ol_prioritarios", 0) or 0),
                key=f"meta_prio_{chave_consultor}",
            ),
            "ol_lancamentos": c3.number_input(
                "OL lançamentos",
                min_value=0.0,
                step=1000.0,
                value=float(atual.get("ol_lancamentos", 0) or 0),
                key=f"meta_lanc_{chave_consultor}",
            ),
            "clientes_positivados": c4.number_input(
                "Clientes com venda",
                min_value=0.0,
                step=1.0,
                value=float(atual.get("clientes_positivados", 0) or 0),
                key=f"meta_cli_{chave_consultor}",
            ),
        }
        st.divider()

    metas_preview = {"consultores": metas_editadas}
    df_metas = metas_dataframe(consultores, metas_preview)
    soma_ol = float(df_metas["ol_sem_combate"].sum()) if not df_metas.empty else 0.0
    soma_prio = float(df_metas["ol_prioritarios"].sum()) if not df_metas.empty else 0.0
    soma_lanc = float(df_metas["ol_lancamentos"].sum()) if not df_metas.empty else 0.0
    soma_cli = float(df_metas["clientes_positivados"].sum()) if not df_metas.empty else 0.0

    st.subheader("Conferência das metas")
    r1, r2 = st.columns(2)
    with r1:
        st.markdown(
            _cartao_meta_resumo("Meta GD OL", formatar_moeda(meta_ol), f"Soma consultores: {formatar_moeda(soma_ol)}"),
            unsafe_allow_html=True,
        )
        st.markdown(
            _cartao_meta_resumo("Meta GD prioritários", formatar_moeda(meta_prio), f"Soma consultores: {formatar_moeda(soma_prio)}"),
            unsafe_allow_html=True,
        )
    with r2:
        st.markdown(
            _cartao_meta_resumo("Meta GD lançamentos", formatar_moeda(meta_lanc), f"Soma consultores: {formatar_moeda(soma_lanc)}"),
            unsafe_allow_html=True,
        )
        st.markdown(
            _cartao_meta_resumo("Meta GD clientes", str(int(meta_cli or 0)), f"Soma consultores: {int(soma_cli or 0)}"),
            unsafe_allow_html=True,
        )

    conferencia = pd.DataFrame(
        [
            {"Indicador": "OL sem combate", "Meta GD": meta_ol, "Soma consultores": soma_ol, "Diferença": meta_ol - soma_ol},
            {"Indicador": "OL prioritários", "Meta GD": meta_prio, "Soma consultores": soma_prio, "Diferença": meta_prio - soma_prio},
            {"Indicador": "OL lançamentos", "Meta GD": meta_lanc, "Soma consultores": soma_lanc, "Diferença": meta_lanc - soma_lanc},
            {"Indicador": "Clientes com venda", "Meta GD": meta_cli, "Soma consultores": soma_cli, "Diferença": meta_cli - soma_cli},
        ]
    )
    conferencia_formatada = conferencia.copy()
    for idx, linha in conferencia_formatada.iterrows():
        if linha["Indicador"] == "Clientes com venda":
            for coluna in ["Meta GD", "Soma consultores", "Diferença"]:
                conferencia_formatada.loc[idx, coluna] = int(_numero_seguro(linha[coluna]))
        else:
            for coluna in ["Meta GD", "Soma consultores", "Diferença"]:
                conferencia_formatada.loc[idx, coluna] = formatar_moeda(_numero_seguro(linha[coluna]))
    st.dataframe(conferencia_formatada, width="stretch", hide_index=True)

    b1, b2 = st.columns([1.4, 0.8])
    if b1.button("Salvar ajustes de metas", width="stretch"):
        metas["gerente_territorial"] = {
            "ol_sem_combate": meta_ol,
            "ol_prioritarios": meta_prio,
            "ol_lancamentos": meta_lanc,
            "clientes_positivados": meta_cli,
        }
        metas["consultores"] = metas_editadas
        salvar_metas(metas)
        st.success("Metas salvas e fixadas.")
        st.rerun()

    with b2:
        confirmar_zerar = st.checkbox("Zerar metas atuais", key="confirmar_zerar_metas")
        if st.button("Zerar metas", width="stretch", disabled=not confirmar_zerar):
            salvar_metas(
                {
                    "gerente_territorial": {
                        "ol_sem_combate": 0.0,
                        "ol_prioritarios": 0.0,
                        "ol_lancamentos": 0.0,
                        "clientes_positivados": 0.0,
                    },
                    "consultores": {
                        consultor: {
                            "ol_sem_combate": 0.0,
                            "ol_prioritarios": 0.0,
                            "ol_lancamentos": 0.0,
                            "clientes_positivados": 0.0,
                        }
                        for consultor in consultores
                    },
                }
            )
            st.success("Metas zeradas.")
            st.rerun()

    botao_download_excel(df_metas, "metas_comerciais.xlsx", "Baixar metas dos consultores")

with tab_arquivos:
    st.subheader("Bases salvas")
    bases = [
        ("Bússola", "bussola"),
        ("Painel clientes", "painel"),
        ("Ações promocionais", "acoes"),
        ("Produtos / mix", "produtos_mix"),
        ("Mercado Farma", "mercado_farma"),
        ("Produtos Mercado Farma", "produtos_mercado_farma"),
        ("Histórico Bússola", "bussola_historico"),
    ]
    cols = st.columns(2)
    for idx, (nome, chave) in enumerate(bases):
        with cols[idx % 2]:
            st.markdown(
                f"""
                <div class="small-update">
                    <div class="small-update-title">{nome}</div>
                    <div class="small-update-value">{formatar_ultima_atualizacao(chave)}</div>
                    <div class="metric-note">{fonte_ativa(chave)}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )

    st.subheader("Uploads manuais")
    up_bussola = st.file_uploader("bussola.xlsx", type=["xlsx"], key="file_bussola")
    up_painel = st.file_uploader("Base de clientes / painel distrital", type=["xlsx"], key="file_painel")
    up_acoes = st.file_uploader("template_acoes_promocionais.xlsx", type=["xlsx"], key="file_acoes")
    up_mix = st.file_uploader("template_produtos_mix.xlsx", type=["xlsx"], key="file_mix")
    up_mercado = st.file_uploader("mercado_farma.xlsx", type=["xlsx"], key="file_mercado_farma")
    up_produtos_mercado = st.file_uploader("produtos.xlsx - EANs Mercado Farma", type=["xlsx"], key="file_produtos_mercado")
    up_historico = st.file_uploader("bussola_historico.xlsx", type=["xlsx"], key="file_bussola_historico")

    c1, c2 = st.columns(2)
    if c1.button("Usar e salvar uploads", width="stretch"):
        salvos = []
        if registrar_upload("bussola", up_bussola):
            salvos.append("Bússola")
        if registrar_upload("painel", up_painel):
            salvos.append("Painel clientes")
        if registrar_upload("acoes", up_acoes):
            salvos.append("Ações promocionais")
        if registrar_upload("produtos_mix", up_mix):
            salvos.append("Produtos / mix")
        if registrar_upload("mercado_farma", up_mercado):
            salvos.append("Mercado Farma")
        if registrar_upload("produtos_mercado_farma", up_produtos_mercado):
            salvos.append("Produtos Mercado Farma")
        if registrar_upload("bussola_historico", up_historico):
            salvos.append("Histórico Bússola")
        st.session_state["mensagem_upload_salvo"] = (
            "Uploads aplicados e salvos: " + ", ".join(salvos)
            if salvos
            else "Nenhum arquivo selecionado para salvar."
        )
        st.rerun()
    if c2.button("Voltar para pasta data", width="stretch"):
        limpar_uploads()
        st.success("Uploads removidos.")
        st.rerun()

    st.subheader("Modelos")
    m1, m2 = st.columns(2)
    with m1:
        botao_download_excel(modelo_acoes(), "template_acoes_promocionais.xlsx", "Baixar modelo de ações")
    with m2:
        botao_download_excel(modelo_produtos_mix(), "template_produtos_mix.xlsx", "Baixar modelo de produtos mix")
