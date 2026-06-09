from __future__ import annotations

import pandas as pd
import streamlit as st

from src.bussola_web import extrair_bussola_web_todos
from src.configuracoes import (
    carregar_login_bussola,
    carregar_metas,
    consultores_unicos,
    importar_metas_excel,
    normalizar_nome_meta,
    salvar_login_bussola,
    salvar_metas,
)
from src.datas import formatar_data_brasil
from src.historico import sincronizar_historico_meses_fechados
from src.layout import botao_download_excel, titulo_pagina
from src.loader import (
    carregar_bussola,
    carregar_dados_tratados,
    diagnostico_bussola,
    fonte_ativa,
    limpar_upload_sessao,
    limpar_uploads,
    modelo_acoes,
    modelo_produtos_mix,
    registrar_upload,
)
from src.persistencia import diagnostico_persistencia
from src.status_bases import formatar_ultima_atualizacao


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


def _consultores_para_edicao(consultores: list[str], metas_importadas: dict | None) -> list[str]:
    mapa = {normalizar_nome_meta(nome): nome for nome in consultores}
    if metas_importadas:
        for nome in metas_importadas.get("consultores", {}):
            nome_norm = normalizar_nome_meta(nome)
            if nome_norm:
                mapa.setdefault(nome_norm, nome_norm)
    return [mapa[chave] for chave in sorted(mapa)]


def _meta_importada_consultor(metas_importadas: dict | None, consultor: str) -> dict:
    if not metas_importadas:
        return {}
    consultores_importados = metas_importadas.get("consultores", {})
    if not isinstance(consultores_importados, dict):
        return {}
    return consultores_importados.get(normalizar_nome_meta(consultor), {})


def _meta_base_consultor(metas: dict, metas_importadas: dict | None, consultor: str) -> dict:
    importada = _meta_importada_consultor(metas_importadas, consultor)
    atual = metas.get("consultores", {}).get(consultor, {})
    if not importada:
        return atual
    base = dict(importada)
    base["clientes_positivados"] = atual.get("clientes_positivados", 0)
    return base


def _meta_base_gerente(metas: dict, metas_importadas: dict | None) -> dict:
    atual = metas.get("gerente_territorial", {})
    if not metas_importadas:
        return atual
    importada = dict(metas_importadas.get("gerente_territorial", {}))
    importada["clientes_positivados"] = atual.get("clientes_positivados", 0)
    return importada


def _demanda_dataframe(metas_importadas: dict | None) -> pd.DataFrame:
    if not metas_importadas:
        return pd.DataFrame()
    linhas = []
    gerente = metas_importadas.get("gerente_territorial", {})
    if isinstance(gerente, dict) and "demanda_sem_combate" in gerente:
        linhas.append({"escopo": "GD", "nome": "Gerente territorial", "demanda_sem_combate": gerente.get("demanda_sem_combate", 0)})
    consultores_importados = metas_importadas.get("consultores", {})
    if isinstance(consultores_importados, dict):
        for nome, meta in sorted(consultores_importados.items()):
            if isinstance(meta, dict) and "demanda_sem_combate" in meta:
                linhas.append({"escopo": "Consultor", "nome": nome, "demanda_sem_combate": meta.get("demanda_sem_combate", 0)})
    return pd.DataFrame(linhas)


def _aplicar_metas_importadas_widgets(metas: dict, metas_importadas: dict | None, consultores_edicao: list[str]) -> None:
    gerente = _meta_base_gerente(metas, metas_importadas)
    st.session_state["meta_gt_ol"] = float(gerente.get("ol_sem_combate", 0) or 0)
    st.session_state["meta_gt_prio"] = float(gerente.get("ol_prioritarios", 0) or 0)
    st.session_state["meta_gt_lanc"] = float(gerente.get("ol_lancamentos", 0) or 0)
    st.session_state["meta_gt_cli"] = float(gerente.get("clientes_positivados", 0) or 0)
    for idx, consultor in enumerate(consultores_edicao):
        atual = _meta_base_consultor(metas, metas_importadas, consultor)
        st.session_state[f"meta_ol_{idx}"] = float(atual.get("ol_sem_combate", 0) or 0)
        st.session_state[f"meta_prio_{idx}"] = float(atual.get("ol_prioritarios", 0) or 0)
        st.session_state[f"meta_lanc_{idx}"] = float(atual.get("ol_lancamentos", 0) or 0)
        st.session_state[f"meta_cli_{idx}"] = float(atual.get("clientes_positivados", 0) or 0)


def _numero_meta_input(container, label: str, key: str, valor: object, step: float) -> float:
    kwargs = {"min_value": 0.0, "step": step, "key": key}
    if key not in st.session_state:
        kwargs["value"] = float(valor or 0)
    return float(container.number_input(label, **kwargs))


def recarregar_bussola_agora(remover_upload: bool = False) -> str:
    if remover_upload:
        limpar_upload_sessao("bussola")
    st.cache_data.clear()
    bussola = carregar_bussola()
    diagnostico = diagnostico_bussola(bussola)
    total_linhas = int(diagnostico.get("total_linhas") or 0)
    if bussola.empty or total_linhas <= 0:
        raise ValueError("Bússola recarregado, mas nenhum registro foi lido.")

    menor_data = formatar_data_brasil(diagnostico.get("menor_data_do_pedido"))
    maior_data = formatar_data_brasil(diagnostico.get("maior_data_do_pedido"))
    if menor_data == "-" or maior_data == "-":
        raise ValueError("Bússola recarregado com linhas, mas sem data_do_pedido válida.")

    mensagem = f"Bússola recarregado com {total_linhas:,} linhas. Período encontrado: {menor_data} até {maior_data}.".replace(",", ".")
    try:
        dados_atualizados = carregar_dados_tratados()
        historico = sincronizar_historico_meses_fechados(
            dados_atualizados["vendas"],
            dados_atualizados["clientes"],
            carregar_metas(),
        )
        mensagem = f"{mensagem} {_mensagem_historico(historico)}"
    except Exception as exc:
        mensagem = f"{mensagem} Histórico não atualizado: {exc}"
    return mensagem


def _rotulo_mes(ano_mes: str) -> str:
    try:
        return pd.Period(ano_mes, freq="M").to_timestamp().strftime("%m/%Y")
    except Exception:
        return str(ano_mes)


def _mensagem_historico(resultado: dict[str, object]) -> str:
    meses = resultado.get("meses_atualizados") or []
    if not meses:
        return "Histórico: nenhum mês fechado para atualizar."
    meses_fmt = ", ".join(_rotulo_mes(str(mes)) for mes in meses)
    linhas = int(resultado.get("linhas_atualizadas") or 0)
    return f"Histórico atualizado ({meses_fmt}, {linhas} linhas)."


dados = carregar_dados_tratados()
clientes = dados["clientes"]
consultores = consultores_unicos(clientes)
nomes_gd = clientes["nome_gd"].dropna().astype(str).str.strip() if not clientes.empty and "nome_gd" in clientes.columns else pd.Series(dtype=str)
nome_gd = nomes_gd[nomes_gd.ne("")].iloc[0] if not nomes_gd[nomes_gd.ne("")].empty else "Gerente Distrital"

titulo_pagina("Importação")

tab_bussola, tab_metas, tab_arquivos = st.tabs(["Bússola Web", "Metas", "Arquivos"])

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
    if col1.button("Salvar acessos", use_container_width=True):
        salvar_login_bussola(credenciais_editadas, headless, gd=gd_editada)
        st.success("Acessos salvos para os próximos usos.")

    if col2.button("Extrair Bússola agora", use_container_width=True):
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
            except Exception as exc:
                st.error(f"Extração interrompida: {exc}")
            else:
                try:
                    mensagem = recarregar_bussola_agora(remover_upload=True)
                except Exception as exc:
                    st.error(f"Extração concluída em {destino}, mas o painel não conseguiu recarregar o Bússola salvo: {exc}")
                else:
                    st.success(mensagem)
                    st.caption(f"Arquivo salvo: {destino}")

    if st.button("Recarregar base Bússola agora", use_container_width=True):
        try:
            st.success(recarregar_bussola_agora())
        except Exception as exc:
            st.error(f"Falha ao recarregar base Bússola: {exc}")

with tab_metas:
    metas = carregar_metas()
    metas_importadas = st.session_state.get("metas_importadas_excel")

    up_metas = st.file_uploader("Importar metas do mês (.xlsx)", type=["xlsx"], key="file_metas_mes")
    if st.button("Importar metas", use_container_width=True):
        if up_metas is None:
            st.warning("Selecione uma planilha de metas para importar.")
        else:
            try:
                metas_importadas = importar_metas_excel(up_metas)
            except Exception as exc:
                st.error(f"Falha ao importar metas: {exc}")
            else:
                st.session_state["metas_importadas_excel"] = metas_importadas
                st.session_state["_aplicar_metas_importadas_widgets"] = True
                st.success("Metas importadas para conferência.")

    if metas_importadas:
        st.warning("A coluna DEMANDA SEM COMBATE foi importada como referência e não substitui Clientes com venda.")
        demanda_ref = _demanda_dataframe(metas_importadas)
        if not demanda_ref.empty:
            with st.expander("Referência DEMANDA SEM COMBATE"):
                st.dataframe(demanda_ref, use_container_width=True, hide_index=True)

    consultores_edicao = _consultores_para_edicao(consultores, metas_importadas)
    if st.session_state.pop("_aplicar_metas_importadas_widgets", False):
        _aplicar_metas_importadas_widgets(metas, metas_importadas, consultores_edicao)

    st.subheader("Metas do gerente territorial")
    gerente = _meta_base_gerente(metas, metas_importadas)
    g1, g2, g3, g4 = st.columns(4)
    meta_ol = _numero_meta_input(g1, "OL sem combate", "meta_gt_ol", gerente.get("ol_sem_combate", 0), 1000.0)
    meta_prio = _numero_meta_input(g2, "OL prioritários", "meta_gt_prio", gerente.get("ol_prioritarios", 0), 1000.0)
    meta_lanc = _numero_meta_input(g3, "OL lançamentos", "meta_gt_lanc", gerente.get("ol_lancamentos", 0), 1000.0)
    meta_cli = _numero_meta_input(g4, "Clientes com venda", "meta_gt_cli", gerente.get("clientes_positivados", 0), 1.0)

    st.subheader("Metas dos consultores")
    metas_editadas = {}
    for idx, consultor in enumerate(consultores_edicao):
        atual = _meta_base_consultor(metas, metas_importadas, consultor)
        demanda = atual.get("demanda_sem_combate")
        st.markdown(f"<div class='consultor-name'>{consultor}</div>", unsafe_allow_html=True)
        c1, c2, c3, c4 = st.columns(4)
        metas_editadas[consultor] = {
            "ol_sem_combate": _numero_meta_input(c1, "OL sem combate", f"meta_ol_{idx}", atual.get("ol_sem_combate", 0), 1000.0),
            "ol_prioritarios": _numero_meta_input(c2, "OL prioritários", f"meta_prio_{idx}", atual.get("ol_prioritarios", 0), 1000.0),
            "ol_lancamentos": _numero_meta_input(c3, "OL lançamentos", f"meta_lanc_{idx}", atual.get("ol_lancamentos", 0), 1000.0),
            "clientes_positivados": _numero_meta_input(c4, "Clientes com venda", f"meta_cli_{idx}", atual.get("clientes_positivados", 0), 1.0),
        }
        if demanda is not None:
            metas_editadas[consultor]["demanda_sem_combate"] = demanda
        st.divider()

    texto_botao_metas = "Salvar metas importadas" if metas_importadas else "Salvar metas"
    if st.button(texto_botao_metas, use_container_width=True):
        try:
            historico = sincronizar_historico_meses_fechados(dados["vendas"], dados["clientes"], metas)
            st.caption(_mensagem_historico(historico))
        except Exception as exc:
            st.warning(f"Não consegui atualizar o histórico antes de salvar as novas metas: {exc}")
        metas["gerente_territorial"] = {
            "ol_sem_combate": meta_ol,
            "ol_prioritarios": meta_prio,
            "ol_lancamentos": meta_lanc,
            "clientes_positivados": meta_cli,
        }
        demanda_gt = gerente.get("demanda_sem_combate")
        if demanda_gt is not None:
            metas["gerente_territorial"]["demanda_sem_combate"] = demanda_gt
        metas["consultores"] = metas_editadas
        salvar_metas(metas)
        st.cache_data.clear()
        if metas_importadas:
            mes = metas_importadas.get("_importacao", {}).get("mes", "")
            st.success(f"Metas de {mes or 'mês'} importadas e salvas.")
            st.session_state.pop("metas_importadas_excel", None)
        else:
            st.success("Metas salvas.")

with tab_arquivos:
    st.subheader("Bases salvas")
    bases = [
        ("Bússola", "bussola"),
        ("Painel clientes", "painel"),
        ("Foco semanal", "acoes"),
        ("Produtos / mix", "produtos_mix"),
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

    with st.expander("Diagnóstico da persistência"):
        diag = diagnostico_persistencia()
        st.write(f"Repo: {diag.get('repo') or '-'}")
        st.write(f"Branch: {diag.get('branch') or '-'}")
        st.write(f"Diretório: {diag.get('diretorio') or '-'}")
        st.write(f"Token configurado: {diag.get('token_configurado')}")
        st.write(f"PERSISTENCE_KEY configurada: {diag.get('persistence_key_configurada')}")
        st.write(f"Branch existe: {diag.get('branch_existe')}")
        st.write(f"Diretório existe: {diag.get('diretorio_existe')}")
        st.write(f"Nome da chave: {diag.get('ultima_chave') or '-'}")
        tamanho = diag.get("ultimo_tamanho_mb")
        st.write(f"Tamanho do último arquivo tentado: {tamanho if tamanho is not None else '-'} MB")
        if diag.get("ultimo_erro_escrita"):
            st.warning(f"Último erro de escrita GitHub: {diag.get('ultimo_erro_escrita')}")
            st.write(f"Status code: {diag.get('ultimo_status_code') or '-'}")
            resposta = diag.get("ultima_resposta")
            if resposta:
                st.code(str(resposta)[:800], language="text")

    st.subheader("Uploads manuais")
    up_bussola = st.file_uploader("bussola.xlsx", type=["xlsx"], key="file_bussola")
    up_painel = st.file_uploader("Base de clientes / painel distrital", type=["xlsx"], key="file_painel")
    up_acoes = st.file_uploader("Foco semanal (.xlsx)", type=["xlsx"], key="file_acoes")
    up_mix = st.file_uploader("template_produtos_mix.xlsx", type=["xlsx"], key="file_mix")

    c1, c2 = st.columns(2)
    if c1.button("Usar e salvar uploads", use_container_width=True):
        arquivos_upload = [
            ("Bússola", "bussola", up_bussola),
            ("Painel clientes", "painel", up_painel),
            ("Foco semanal", "acoes", up_acoes),
            ("Produtos / mix", "produtos_mix", up_mix),
        ]
        salvos: list[str] = []
        falhas: list[str] = []
        for nome, chave, arquivo in arquivos_upload:
            if arquivo is None:
                continue
            try:
                registrar_upload(chave, arquivo)
            except Exception as exc:
                falhas.append(f"{nome} - {exc}")
            else:
                salvos.append(nome)

        if salvos:
            try:
                dados_atualizados = carregar_dados_tratados()
                historico = sincronizar_historico_meses_fechados(
                    dados_atualizados["vendas"],
                    dados_atualizados["clientes"],
                    carregar_metas(),
                )
                st.success(f"Uploads aplicados: {', '.join(salvos)}. {_mensagem_historico(historico)}")
            except Exception as exc:
                st.warning(f"Uploads aplicados: {', '.join(salvos)}. Histórico não atualizado: {exc}")
        elif not falhas:
            st.warning("Nenhum arquivo selecionado para salvar.")

        if falhas:
            st.error("Falhas: " + "; ".join(falhas))
    if c2.button("Voltar para pasta data", use_container_width=True):
        limpar_uploads()
        st.success("Uploads removidos.")
        st.rerun()

    st.subheader("Modelos")
    m1, m2 = st.columns(2)
    with m1:
        botao_download_excel(modelo_acoes(), "template_foco_semanal.xlsx", "Baixar modelo de foco semanal")
    with m2:
        botao_download_excel(modelo_produtos_mix(), "template_produtos_mix.xlsx", "Baixar modelo de produtos mix")
