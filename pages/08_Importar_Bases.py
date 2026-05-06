from __future__ import annotations

import pandas as pd
import streamlit as st

from src.bussola_web import extrair_bussola_web_todos
from src.configuracoes import (
    carregar_login_bussola,
    carregar_metas,
    consultores_unicos,
    salvar_login_bussola,
    salvar_metas,
)
from src.layout import botao_download_excel, titulo_pagina
from src.loader import carregar_dados_tratados, limpar_uploads, modelo_acoes, modelo_produtos_mix, registrar_upload


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


dados = carregar_dados_tratados()
clientes = dados["clientes"]
consultores = consultores_unicos(clientes)

titulo_pagina("Importacao")

tab_bussola, tab_metas, tab_arquivos = st.tabs(["Bussola Web", "Metas", "Arquivos"])

with tab_bussola:
    st.subheader("Acesso ao Bussola Web por consultor")
    login = carregar_login_bussola()
    headless = st.toggle("Rodar navegador oculto", value=bool(login.get("headless", False)))
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

    col1, col2 = st.columns(2)
    if col1.button("Salvar acessos", width="stretch"):
        salvar_login_bussola(credenciais_editadas, headless)
        st.success("Acessos salvos para os proximos usos neste computador.")

    if col2.button("Extrair Bussola de todos", width="stretch"):
        solicitados = []
        for consultor, item in credenciais_editadas.items():
            if item["extrair"]:
                solicitados.append({"consultor": consultor, "usuario": item["usuario"], "senha": item["senha"]})
        salvar_login_bussola(credenciais_editadas, headless)

        incompletos = [c["consultor"] for c in solicitados if not c["usuario"] or not c["senha"]]
        credenciais = [c for c in solicitados if c["usuario"] and c["senha"]]
        if not solicitados:
            st.warning("Marque pelo menos um consultor para extrair.")
        elif not credenciais:
            st.error("Nenhum consultor marcado tem login e senha preenchidos.")
        else:
            if incompletos:
                st.warning("Sem login/senha, estes consultores foram ignorados nesta execucao: " + ", ".join(incompletos))
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
                st.error(f"Extracao interrompida: {exc}")

with tab_metas:
    st.subheader("Metas do gerente territorial")
    metas = carregar_metas()
    gerente = metas.get("gerente_territorial", {})
    g1, g2, g3, g4 = st.columns(4)
    meta_ol = g1.number_input("OL sem combate", min_value=0.0, step=1000.0, value=float(gerente.get("ol_sem_combate", 0) or 0))
    meta_prio = g2.number_input("OL prioritarios", min_value=0.0, step=1000.0, value=float(gerente.get("ol_prioritarios", 0) or 0))
    meta_lanc = g3.number_input("OL lancamentos", min_value=0.0, step=1000.0, value=float(gerente.get("ol_lancamentos", 0) or 0))
    meta_cli = g4.number_input("Clientes com venda", min_value=0.0, step=1.0, value=float(gerente.get("clientes_positivados", 0) or 0))

    st.subheader("Metas dos consultores")
    metas_editadas = {}
    metas_consultores = metas.get("consultores", {})
    for idx, consultor in enumerate(consultores):
        atual = metas_consultores.get(consultor, {})
        st.markdown(f"<div class='consultor-name'>{consultor}</div>", unsafe_allow_html=True)
        c1, c2, c3, c4 = st.columns(4)
        metas_editadas[consultor] = {
            "ol_sem_combate": c1.number_input(
                "OL sem combate",
                min_value=0.0,
                step=1000.0,
                value=float(atual.get("ol_sem_combate", 0) or 0),
                key=f"meta_ol_{idx}",
            ),
            "ol_prioritarios": c2.number_input(
                "OL prioritarios",
                min_value=0.0,
                step=1000.0,
                value=float(atual.get("ol_prioritarios", 0) or 0),
                key=f"meta_prio_{idx}",
            ),
            "ol_lancamentos": c3.number_input(
                "OL lancamentos",
                min_value=0.0,
                step=1000.0,
                value=float(atual.get("ol_lancamentos", 0) or 0),
                key=f"meta_lanc_{idx}",
            ),
            "clientes_positivados": c4.number_input(
                "Clientes com venda",
                min_value=0.0,
                step=1.0,
                value=float(atual.get("clientes_positivados", 0) or 0),
                key=f"meta_cli_{idx}",
            ),
        }
        st.divider()

    if st.button("Salvar metas", width="stretch"):
        metas["gerente_territorial"] = {
            "ol_sem_combate": meta_ol,
            "ol_prioritarios": meta_prio,
            "ol_lancamentos": meta_lanc,
            "clientes_positivados": meta_cli,
        }
        metas["consultores"] = metas_editadas
        salvar_metas(metas)
        st.success("Metas salvas.")
        st.rerun()

with tab_arquivos:
    st.subheader("Uploads manuais")
    up_bussola = st.file_uploader("bussola.xlsx", type=["xlsx"], key="file_bussola")
    up_painel = st.file_uploader("PAINEL EQUIPE NORTE.xlsx", type=["xlsx"], key="file_painel")
    up_acoes = st.file_uploader("template_acoes_promocionais.xlsx", type=["xlsx"], key="file_acoes")
    up_mix = st.file_uploader("template_produtos_mix.xlsx", type=["xlsx"], key="file_mix")

    c1, c2 = st.columns(2)
    if c1.button("Usar uploads nesta sessao", width="stretch"):
        registrar_upload("bussola", up_bussola)
        registrar_upload("painel", up_painel)
        registrar_upload("acoes", up_acoes)
        registrar_upload("produtos_mix", up_mix)
        st.success("Uploads aplicados para esta sessao.")
        st.rerun()
    if c2.button("Voltar para pasta data", width="stretch"):
        limpar_uploads()
        st.success("Uploads removidos.")
        st.rerun()

    st.subheader("Modelos")
    m1, m2 = st.columns(2)
    with m1:
        botao_download_excel(modelo_acoes(), "template_acoes_promocionais.xlsx", "Baixar modelo de acoes")
    with m2:
        botao_download_excel(modelo_produtos_mix(), "template_produtos_mix.xlsx", "Baixar modelo de produtos mix")
