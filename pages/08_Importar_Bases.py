from __future__ import annotations

import pandas as pd
import streamlit as st

from src.bussola_web import extrair_bussola_web_todos
from src.calculos import auditar_produtos_mix
from src.configuracoes import (
    carregar_ajustes_vendedores,
    carregar_login_bussola,
    carregar_metas,
    consultores_unicos,
    importar_metas_excel,
    normalizar_nome_meta,
    salvar_ajustes_vendedores,
    salvar_login_bussola,
    salvar_metas,
)
from src.historico import sincronizar_metas_historico_meses_fechados
from src.layout import botao_download_excel, titulo_pagina
from src.loader import (
    carregar_dados_tratados,
    fonte_ativa,
    limpar_uploads,
    modelo_acoes,
    modelo_produtos_mix,
    registrar_upload,
    registrar_upload_produtos_mercado_farma,
    registrar_upload_produtos_mix,
    restaurar_backup_produtos_mix,
)
from src.persistencia import diagnosticar_persistencia, restaurar_backup, status_persistencia
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
    st.session_state["meta_gd_ol"] = float(gerente.get("ol_sem_combate", 0) or 0)
    st.session_state["meta_gd_prio"] = float(gerente.get("ol_prioritarios", 0) or 0)
    st.session_state["meta_gd_lanc"] = float(gerente.get("ol_lancamentos", 0) or 0)
    st.session_state["meta_gd_cli"] = float(gerente.get("clientes_positivados", 0) or 0)
    for idx, consultor in enumerate(consultores_edicao):
        atual = _meta_base_consultor(metas, metas_importadas, consultor)
        chave_consultor = f"{idx}_{slug_coluna(consultor)}"
        st.session_state[f"meta_ol_{chave_consultor}"] = float(atual.get("ol_sem_combate", 0) or 0)
        st.session_state[f"meta_prio_{chave_consultor}"] = float(atual.get("ol_prioritarios", 0) or 0)
        st.session_state[f"meta_lanc_{chave_consultor}"] = float(atual.get("ol_lancamentos", 0) or 0)
        st.session_state[f"meta_cli_{chave_consultor}"] = float(atual.get("clientes_positivados", 0) or 0)


def _numero_meta_input(container, label: str, key: str, valor: object, step: float) -> float:
    kwargs = {"min_value": 0.0, "step": step, "key": key}
    if key not in st.session_state:
        kwargs["value"] = float(valor or 0)
    return float(container.number_input(label, **kwargs))


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
    return f"Histórico sincronizado ({meses_fmt})."


def _sincronizar_historico_importacao(metas_base: dict | None = None) -> str:
    dados_atualizados = carregar_dados_tratados()
    resultado = sincronizar_metas_historico_meses_fechados(
        dados_atualizados["vendas"],
        metas_base or carregar_metas(),
    )
    return _mensagem_historico(resultado)


dados = carregar_dados_tratados()
clientes = dados["clientes"]
consultores = consultores_unicos(clientes)
nomes_gd = clientes["nome_gd"].dropna().astype(str).str.strip() if not clientes.empty and "nome_gd" in clientes.columns else pd.Series(dtype=str)
nome_gd = nomes_gd[nomes_gd.ne("")].iloc[0] if not nomes_gd[nomes_gd.ne("")].empty else "Gerente Distrital"

titulo_pagina("Importação")

mensagem_upload = st.session_state.pop("mensagem_upload_salvo", "")
if mensagem_upload:
    if mensagem_upload.startswith("Falhas:"):
        st.error(mensagem_upload)
    elif "Falhas:" in mensagem_upload:
        st.warning(mensagem_upload)
    else:
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
                st.cache_data.clear()
                st.success(f"Base consolidada atualizada: {destino}. {_sincronizar_historico_importacao()}")
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
    metas_importadas = st.session_state.get("metas_importadas_excel")
    gerente = _meta_base_gerente(metas, metas_importadas)
    st.caption("As metas salvas aqui alimentam a Visão Geral e a página Consultores. Use este ajuste para o mês atual.")

    up_metas = st.file_uploader("Importar metas do mês (.xlsx)", type=["xlsx"], key="file_metas_mes")
    if st.button("Importar metas", width="stretch"):
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
                st.dataframe(demanda_ref, width="stretch", hide_index=True)

    consultores_edicao = _consultores_para_edicao(consultores, metas_importadas)
    if st.session_state.pop("_aplicar_metas_importadas_widgets", False):
        _aplicar_metas_importadas_widgets(metas, metas_importadas, consultores_edicao)

    st.markdown(f"<div class='consultor-name'>GD - {nome_gd}</div>", unsafe_allow_html=True)
    g1, g2, g3, g4 = st.columns(4)
    meta_ol = _numero_meta_input(g1, "Meta OL sem combate", "meta_gd_ol", gerente.get("ol_sem_combate", 0), 1000.0)
    meta_prio = _numero_meta_input(g2, "Meta OL prioritários", "meta_gd_prio", gerente.get("ol_prioritarios", 0), 1000.0)
    meta_lanc = _numero_meta_input(g3, "Meta OL lançamentos", "meta_gd_lanc", gerente.get("ol_lancamentos", 0), 1000.0)
    meta_cli = _numero_meta_input(g4, "Meta clientes com venda", "meta_gd_cli", gerente.get("clientes_positivados", 0), 1.0)

    st.subheader("Metas dos consultores")
    busca_meta = st.text_input("Buscar consultor para ajustar meta", placeholder="Digite parte do nome", key="buscar_meta_consultor")
    consultores_visiveis = [
        consultor
        for consultor in consultores_edicao
        if not busca_meta.strip() or busca_meta.strip().upper() in consultor.upper()
    ]
    metas_editadas = {consultor: dict(_meta_base_consultor(metas, metas_importadas, consultor)) for consultor in consultores_edicao}
    if not consultores_visiveis:
        st.info("Nenhum consultor encontrado para a busca.")

    for idx, consultor in enumerate(consultores_edicao):
        if consultor not in consultores_visiveis:
            continue
        atual = _meta_base_consultor(metas, metas_importadas, consultor)
        demanda = atual.get("demanda_sem_combate")
        st.markdown(f"<div class='consultor-name'>{consultor}</div>", unsafe_allow_html=True)
        c1, c2, c3, c4 = st.columns(4)
        chave_consultor = f"{idx}_{slug_coluna(consultor)}"
        metas_editadas[consultor] = {
            "ol_sem_combate": _numero_meta_input(c1, "OL sem combate", f"meta_ol_{chave_consultor}", atual.get("ol_sem_combate", 0), 1000.0),
            "ol_prioritarios": _numero_meta_input(c2, "OL prioritários", f"meta_prio_{chave_consultor}", atual.get("ol_prioritarios", 0), 1000.0),
            "ol_lancamentos": _numero_meta_input(c3, "OL lançamentos", f"meta_lanc_{chave_consultor}", atual.get("ol_lancamentos", 0), 1000.0),
            "clientes_positivados": _numero_meta_input(c4, "Clientes com venda", f"meta_cli_{chave_consultor}", atual.get("clientes_positivados", 0), 1.0),
        }
        if demanda is not None:
            metas_editadas[consultor]["demanda_sem_combate"] = demanda
        st.divider()

    metas_preview = {"consultores": metas_editadas}
    df_metas = metas_dataframe(consultores_edicao, metas_preview)
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
    conferencia_formatada = conferencia.copy().astype(object)
    for idx, linha in conferencia_formatada.iterrows():
        if linha["Indicador"] == "Clientes com venda":
            for coluna in ["Meta GD", "Soma consultores", "Diferença"]:
                conferencia_formatada.loc[idx, coluna] = int(_numero_seguro(linha[coluna]))
        else:
            for coluna in ["Meta GD", "Soma consultores", "Diferença"]:
                conferencia_formatada.loc[idx, coluna] = formatar_moeda(_numero_seguro(linha[coluna]))
    st.dataframe(conferencia_formatada, width="stretch", hide_index=True)

    b1, b2 = st.columns([1.4, 0.8])
    texto_botao_metas = "Salvar metas importadas" if metas_importadas else "Salvar ajustes de metas"
    if b1.button(texto_botao_metas, width="stretch"):
        try:
            st.caption(_sincronizar_historico_importacao(metas))
        except Exception as exc:
            st.warning(f"Não consegui sincronizar o histórico antes de salvar as novas metas: {exc}")
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
        if metas_importadas:
            mes = metas_importadas.get("_importacao", {}).get("mes", "")
            st.session_state["mensagem_upload_salvo"] = f"Metas de {mes or 'mês'} importadas e salvas."
            st.session_state.pop("metas_importadas_excel", None)
        else:
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

    with st.expander("Diagnóstico da persistência", expanded=True):
        diag = diagnosticar_persistencia()
        st.markdown(
            " ".join(
                [
                    f"<span class='pill-note'>Modo: <b>{diag.get('modo', '-')}</b></span>",
                    f"<span class='pill-note'>Repo: <b>{diag.get('repo', '-')}</b></span>",
                    f"<span class='pill-note'>Branch: <b>{diag.get('branch', '-')}</b></span>",
                    f"<span class='pill-note'>Token: <b>{'configurado' if diag.get('github_token_configurado') else 'ausente'}</b></span>",
                    f"<span class='pill-note'>PERSISTENCE_KEY: <b>{'configurada' if diag.get('persistence_key_configurada') else 'ausente'}</b></span>",
                    f"<span class='pill-note'>Leitura: <b>{'ok' if diag.get('healthcheck_ok') else 'verificar'}</b></span>",
                ]
            ),
            unsafe_allow_html=True,
        )
        st.write(f"Repo: {diag.get('repo') or '-'}")
        st.write(f"Branch: {diag.get('branch') or '-'}")
        st.write(f"Diretório: {diag.get('diretorio') or '-'}")
        st.write(f"Token configurado: {'sim' if diag.get('github_token_configurado') else 'não'}")
        st.write(f"PERSISTENCE_KEY configurada: {'sim' if diag.get('persistence_key_configurada') else 'não'}")
        st.write(f"Branch existe: {'sim' if diag.get('branch_ok') else 'não'}")
        st.write(f"Diretório existe: {'sim' if diag.get('diretorio_ok') else 'não'}")
        st.write(f"Nome da chave: {diag.get('ultima_chave') or '-'}")
        tamanho = diag.get("ultimo_tamanho_mb")
        st.write(f"Tamanho do último arquivo tentado: {tamanho if tamanho is not None else '-'} MB")
        if diag.get("ultimo_erro_escrita"):
            st.warning(f"Último erro de escrita GitHub: {diag.get('ultimo_erro_escrita')}")
            st.write(f"Status code: {diag.get('ultimo_status_code') or '-'}")
            resposta = diag.get("ultima_resposta")
            if resposta:
                st.code(str(resposta)[:800], language="text")
        if not diag.get("persistence_key_configurada") or not diag.get("healthcheck_ok"):
            st.warning(
                "Não foi possível confirmar a leitura da persistência. "
                "Verifique os Secrets do Streamlit, principalmente PERSISTENCE_KEY."
            )
            if diag.get("healthcheck_erro"):
                with st.expander("Ver detalhe técnico da persistência", expanded=False):
                    st.code(str(diag.get("healthcheck_erro")))
        arquivos_diag = pd.DataFrame(diag.get("arquivos", []))
        if not arquivos_diag.empty:
            st.dataframe(arquivos_diag, width="stretch", hide_index=True)

    auditoria_mix = auditar_produtos_mix(dados["produtos_mix"], dados["vendas"])
    with st.expander("Diagnóstico Produtos / Mix", expanded=False):
        st.markdown(
            " ".join(
                [
                    f"<span class='pill-note'>Template: <b>{auditoria_mix['total_template']}</b></span>",
                    f"<span class='pill-note'>Classificados: <b>{auditoria_mix['classificados_template']}</b></span>",
                    f"<span class='pill-note'>Sem classificação: <b>{auditoria_mix['sem_classificacao_template']}</b></span>",
                    f"<span class='pill-note'>EANs vendidos: <b>{auditoria_mix['vendas_total_eans']}</b></span>",
                    f"<span class='pill-note'>Fora do template: <b>{auditoria_mix['vendas_eans_fora_template']}</b></span>",
                ]
            ),
            unsafe_allow_html=True,
        )
        st.json(auditoria_mix["tipos_mix_contagem"])

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
        tarefas_upload = [
            ("Bússola", up_bussola, lambda: registrar_upload("bussola", up_bussola)),
            ("Painel clientes", up_painel, lambda: registrar_upload("painel", up_painel)),
            ("Ações promocionais", up_acoes, lambda: registrar_upload("acoes", up_acoes)),
            ("Produtos / mix", up_mix, lambda: registrar_upload_produtos_mix(up_mix)),
            ("Mercado Farma", up_mercado, lambda: registrar_upload("mercado_farma", up_mercado)),
            ("Produtos Mercado Farma", up_produtos_mercado, lambda: registrar_upload_produtos_mercado_farma(up_produtos_mercado)),
            ("Histórico Bússola", up_historico, lambda: registrar_upload("bussola_historico", up_historico)),
        ]
        salvos: list[str] = []
        falhas: list[str] = []
        for nome, arquivo, executar in tarefas_upload:
            if arquivo is None:
                continue
            try:
                if executar():
                    salvos.append(nome)
            except Exception as exc:
                falhas.append(f"{nome} - {exc}")
        mensagem_historico = ""
        if up_bussola is not None or up_historico is not None:
            try:
                mensagem_historico = " " + _sincronizar_historico_importacao()
            except Exception as exc:
                mensagem_historico = f" Histórico não sincronizado: {exc}"
        mensagens = []
        if salvos:
            mensagens.append("Uploads aplicados: " + ", ".join(salvos) + mensagem_historico)
        elif not falhas:
            mensagens.append("Nenhum arquivo selecionado para salvar.")
        if falhas:
            mensagens.append("Falhas: " + "; ".join(falhas))
        st.session_state["mensagem_upload_salvo"] = " ".join(mensagens)
        st.rerun()
    if c2.button("Limpar uploads da sessão", width="stretch"):
        limpar_uploads()
        st.success("Uploads removidos.")
        st.rerun()

    st.subheader("Backup Produtos / Mix")
    confirmar_restore_mix = st.checkbox("Confirmo que quero restaurar o último backup do Produtos / Mix")
    if st.button(
        "Restaurar último backup do Produtos / Mix",
        width="stretch",
        disabled=not confirmar_restore_mix,
    ):
        if restaurar_backup_produtos_mix():
            st.success("Backup do Produtos / Mix restaurado. Recarregando o painel.")
            st.rerun()
        else:
            st.warning("Nenhum backup de Produtos / Mix foi encontrado para restaurar.")

    st.subheader("Recuperação de bases")
    st.caption("Use somente quando uma base salva sumir ou uma atualização inválida substituir uma base boa.")
    confirmar_recuperacao = st.checkbox("Confirmo que desejo restaurar backups ou limpar cache", key="confirmar_recuperacao_bases")
    recuperacoes = [
        ("Produtos / Mix", "produtos_mix"),
        ("SIP", "sip"),
        ("Bússola histórico", "bussola_historico"),
        ("Produtos Mercado Farma", "produtos_mercado_farma"),
        ("Mercado Farma", "mercado_farma"),
    ]
    cols_rec = st.columns(2)
    for idx, (rotulo, chave) in enumerate(recuperacoes):
        with cols_rec[idx % 2]:
            if st.button(f"Restaurar último backup {rotulo}", key=f"restore_{chave}", disabled=not confirmar_recuperacao, width="stretch"):
                if restaurar_backup(chave):
                    st.cache_data.clear()
                    st.success(f"Backup de {rotulo} restaurado.")
                    st.rerun()
                else:
                    st.warning(f"Nenhum backup de {rotulo} foi encontrado.")

    r1, r2 = st.columns(2)
    if r1.button("Recarregar persistência", disabled=not confirmar_recuperacao, width="stretch"):
        st.cache_data.clear()
        st.rerun()
    if r2.button("Limpar cache do Streamlit", disabled=not confirmar_recuperacao, width="stretch"):
        st.cache_data.clear()
        st.success("Cache limpo.")
        st.rerun()

    st.subheader("Modelos")
    m1, m2 = st.columns(2)
    with m1:
        botao_download_excel(modelo_acoes(), "template_acoes_promocionais.xlsx", "Baixar modelo de ações")
    with m2:
        botao_download_excel(modelo_produtos_mix(), "template_produtos_mix.xlsx", "Baixar modelo de produtos mix")
