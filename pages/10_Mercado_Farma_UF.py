from __future__ import annotations

from html import escape

import pandas as pd
import streamlit as st

from src import github_actions as gha
from src import mercado_farma as mf
from src.configuracoes import carregar_login_bussola
from src.layout import botao_download_excel, card_metrica, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados, registrar_upload
from src.status_bases import formatar_ultima_atualizacao
from src.tratamento import formatar_moeda, normalizar_ean


def desconto_texto(valor: object) -> str:
    try:
        numero = float(valor or 0)
    except Exception:
        numero = 0.0
    return f"{numero * 100:,.2f}%".replace(",", "X").replace(".", ",").replace("X", ".")


def _texto(valor: object, padrao: str = "-") -> str:
    texto = "" if valor is None or pd.isna(valor) else str(valor).strip()
    return texto or padrao


def _html(valor: object, padrao: str = "-") -> str:
    return escape(_texto(valor, padrao))


def tabela_mercado_sem_consultor(df: pd.DataFrame) -> pd.DataFrame:
    tabela = mf.formatar_tabela_mercado(df)
    return tabela.drop(columns=["Consultor"], errors="ignore")


def produto_card_distribuidora(grupo: pd.DataFrame, key: str) -> None:
    opcoes = grupo.sort_values(["preco_sem_imposto", "estoque"], ascending=[True, False]).reset_index(drop=True)
    if opcoes.empty:
        return

    with st.container(border=True):
        primeiro = opcoes.iloc[0]
        st.markdown(
            f"""
            <div class="produto-top">
                <span class="desconto-badge">{desconto_texto(primeiro.get('desconto', 0))}</span>
                <span class="produto-meta">{_html(primeiro.get('uf'))}</span>
            </div>
            <div class="produto-nome">{_html(primeiro.get('produto'), 'Produto sem descrição')}</div>
            <div class="produto-meta">EMS Genéricos &nbsp; | &nbsp; {_html(primeiro.get('ean'))}</div>
            """,
            unsafe_allow_html=True,
        )
        st.caption("Distribuidora")
        if len(opcoes) > 1:
            def rotulo(indice: int) -> str:
                item = opcoes.iloc[indice]
                dist = _texto(item.get("distribuidora"), "Distribuidora não identificada")
                preco = formatar_moeda(item.get("preco_sem_imposto", 0))
                estoque = int(float(item.get("estoque", 0) or 0))
                return f"{dist} | {preco} | {estoque} un."

            escolha = st.selectbox(
                "Distribuidora do produto",
                list(range(len(opcoes))),
                format_func=rotulo,
                key=key,
                label_visibility="collapsed",
            )
        else:
            escolha = 0
            st.markdown(
                f"<span class='pill-note'>{_html(opcoes.iloc[0].get('distribuidora'), 'Distribuidora não identificada')}</span>",
                unsafe_allow_html=True,
            )

        item = opcoes.iloc[int(escolha)]
        preco = float(item.get("preco_sem_imposto", 0) or 0)
        preco_com = float(item.get("preco_com_imposto", 0) or 0)
        pf_dist = float(item.get("pf_dist", 0) or 0)
        estoque = int(float(item.get("estoque", 0) or 0))
        st.markdown(
            f"""
            <div class="preco-box">
                <div>
                    <div class="preco-dist">{_html(item.get('distribuidora'), 'Distribuidora não identificada')}</div>
                    <div class="preco-estoque">{estoque} un. disponíveis</div>
                </div>
                <div>
                    <div class="preco-secundario">PF Dist.: {formatar_moeda(pf_dist)}</div>
                    <div class="preco-principal">{formatar_moeda(preco)}</div>
                    <div class="preco-secundario">Com imposto: {formatar_moeda(preco_com)}</div>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )


def painel_status_extracao(estado: dict) -> None:
    status = str(estado.get("status") or "parado").upper()
    total = int(estado.get("total_passos", 0) or 0)
    processados = int(estado.get("processados", 0) or 0)
    percentual = 0 if total <= 0 else min(max(processados / total, 0), 1)
    st.progress(percentual)
    st.markdown(
        " ".join(
            [
                f"<span class='pill-note'>Status: {escape(status)}</span>",
                f"<span class='pill-note'>Processados: {processados}/{total}</span>",
                f"<span class='pill-note'>UF atual: {escape(str(estado.get('current_uf') or '-'))}</span>",
                f"<span class='pill-note'>EAN atual: {escape(str(estado.get('current_ean') or '-'))}</span>",
            ]
        ),
        unsafe_allow_html=True,
    )
    if estado.get("mensagem"):
        st.caption(str(estado["mensagem"]))
    if estado.get("erro"):
        st.error(str(estado["erro"]))
    logs = estado.get("logs", [])
    if logs:
        linhas = []
        for item in logs[-18:]:
            texto = str(item)
            if " / " in texto and ": " in texto:
                inicio, resto = texto.split(" - ", 1) if " - " in texto else ("", texto)
                partes = resto.split(" / ", 1)
                if len(partes) == 2:
                    texto = f"{inicio} - UF {partes[1]}" if inicio else f"UF {partes[1]}"
            linhas.append(texto)
        st.code("\n".join(linhas), language="text")


def tabela_status_consolidado(status: dict) -> pd.DataFrame:
    itens = status.get("status", []) if isinstance(status, dict) else []
    if not isinstance(itens, list):
        return pd.DataFrame()
    linhas = []
    for item in itens:
        if not isinstance(item, dict):
            continue
        linhas.append(
            {
                "UF": item.get("uf", ""),
                "Status": item.get("status", ""),
                "CNPJ referência": item.get("cnpj_referencia", ""),
                "Produtos": item.get("total_produtos", 0),
                "Erro": item.get("erro", ""),
            }
        )
    return pd.DataFrame(linhas)


def renderizar_execucoes_actions(runs: list[dict]) -> None:
    if not runs:
        return
    st.markdown("<span class='pill-note'>Últimas execuções</span>", unsafe_allow_html=True)
    for run in runs:
        falhou = run.get("conclusao") == "failure" or bool(run.get("ufs_com_erro"))
        with st.container(border=True):
            c1, c2, c3, c4 = st.columns(4)
            c1.caption("Criada em")
            c1.markdown(f"**{run.get('criada_em', '-')}**")
            c2.caption("Status")
            c2.markdown(f"**{run.get('status_pt', '-')}**")
            c3.caption("Resultado")
            c3.markdown(f"**{run.get('conclusao_pt', '-')}**")
            c4.caption("UF")
            c4.markdown(f"**{run.get('uf', '-')}**")

            d1, d2 = st.columns(2)
            d1.caption(f"Branch: {run.get('branch', '-')}")
            d2.caption(f"Ação executada: {run.get('acao', '-')}")

            links = []
            if run.get("url"):
                links.append(f"[Abrir execução]({run['url']})")
            if run.get("jobs_url"):
                links.append(f"[API dos jobs]({run['jobs_url']})")
            if links:
                st.markdown(" | ".join(links))

            if falhou:
                chave = f"mf_ver_erro_{run.get('id')}"
                if st.button("Ver detalhes do erro" if not st.session_state.get(chave) else "Ocultar detalhes do erro", key=f"btn_{chave}", width="stretch"):
                    st.session_state[chave] = not bool(st.session_state.get(chave))
                if st.session_state.get(chave):
                    jobs_falhos = [job for job in run.get("jobs", []) if job.get("conclusao") == "failure"]
                    if jobs_falhos:
                        for job in jobs_falhos:
                            st.markdown(
                                f"**{job.get('nome', 'Job')}** | Status: **{job.get('status_pt', '-')}** | Resultado: **{job.get('conclusao_pt', '-')}**"
                            )
                            if job.get("html_url"):
                                st.markdown(f"[Abrir logs da UF {job.get('uf', '-')}]({job['html_url']})")
                            if job.get("logs_url"):
                                st.caption(f"logs_url: {job['logs_url']}")
                            if job.get("erro_resumo"):
                                st.code(job["erro_resumo"], language="text")
                    elif run.get("erro_resumo"):
                        st.code(run["erro_resumo"], language="text")
                    else:
                        st.info("A execução falhou, mas o GitHub ainda não liberou detalhes de log pela API.")


def configurar_desconto_adicional(mercado_base: pd.DataFrame) -> dict:
    config = mf.carregar_descontos_adicionais()
    with st.expander("Desconto adicional por distribuidora", expanded=False):
        if mercado_base.empty:
            st.info("Extraia ou importe o Mercado Farma para cadastrar desconto adicional.")
            return config
        distribuidoras = sorted(mercado_base["distribuidora"].dropna().astype(str).str.strip().replace("", pd.NA).dropna().unique().tolist())
        if not distribuidoras:
            st.info("Nenhuma distribuidora encontrada na base atual.")
            return config
        dist = st.selectbox("Distribuidora", distribuidoras, key="mf_desconto_dist")
        regras = config.setdefault("distribuidoras", {})
        regra = regras.get(dist, {})
        percentual_atual = float(regra.get("percentual", 0) or 0)
        percentual_visual = percentual_atual * 100 if percentual_atual <= 1 else percentual_atual
        percentual = st.number_input("Desconto adicional (%)", min_value=0.0, max_value=100.0, step=0.5, value=float(percentual_visual), key="mf_desconto_pct")

        produtos_dist = mercado_base[mercado_base["distribuidora"].astype(str).eq(dist)].copy()
        produtos_dist = produtos_dist[["ean", "produto"]].drop_duplicates("ean").sort_values("produto")
        mapa_label_ean = {
            f"{_texto(row.produto, 'Produto sem descrição')} | {row.ean}": str(row.ean)
            for row in produtos_dist.itertuples(index=False)
        }
        eans_sem = set(str(ean) for ean in regra.get("eans_sem_desconto", []))
        default_labels = [label for label, ean in mapa_label_ean.items() if ean in eans_sem]
        selecionados = st.multiselect(
            "Produtos sem desconto adicional nesta distribuidora",
            list(mapa_label_ean.keys()),
            default=default_labels,
            key="mf_desconto_excecoes",
        )
        c1, c2 = st.columns(2)
        if c1.button("Salvar desconto adicional", width="stretch"):
            regras[dist] = {
                "percentual": float(percentual) / 100,
                "eans_sem_desconto": [normalizar_ean(mapa_label_ean[label]) for label in selecionados],
            }
            mf.salvar_descontos_adicionais(config)
            st.success("Desconto adicional salvo.")
            st.rerun()
        if c2.button("Remover desconto da distribuidora", width="stretch", disabled=dist not in regras):
            regras.pop(dist, None)
            mf.salvar_descontos_adicionais(config)
            st.success("Desconto adicional removido.")
            st.rerun()

        if regras:
            resumo = [
                {
                    "Distribuidora": nome,
                    "Desconto adicional": f"{float(regra.get('percentual', 0) or 0) * 100:.2f}%",
                    "Produtos sem adicional": len(regra.get("eans_sem_desconto", [])),
                }
                for nome, regra in regras.items()
                if isinstance(regra, dict)
            ]
            st.dataframe(pd.DataFrame(resumo), width="stretch", hide_index=True)
    return config


dados = carregar_dados_tratados()
clientes = dados["clientes"]
produtos_mercado = dados["produtos_mercado_farma"]

titulo_pagina("Mercado Farma / UF", "Preços e estoque por UF da carteira")

mercado_original = mf.mercado_farma_atual()
descontos_config = mf.carregar_descontos_adicionais()
mercado = mf.aplicar_descontos_adicionais(mercado_original, descontos_config)
login = carregar_login_bussola()
credencial_gd = mf.carregar_credenciais_mercadofarma(login)
usuario_gd = str(credencial_gd.get("usuario", ""))
senha_gd = str(credencial_gd.get("senha", ""))
credenciais = [{"consultor": "GD", "usuario": usuario_gd, "senha": senha_gd}] if credencial_gd.get("configurado") else []
alvos = mf.alvos_mercadofarma_por_uf(clientes, usuario_gd, senha_gd)
ufs_carteira = set(mf.ufs_validas_clientes(clientes))
ufs_alvos = sorted({alvo["uf"] for alvo in alvos} or ufs_carteira)
ufs_sem_cnpj = sorted(ufs_carteira - {alvo["uf"] for alvo in alvos})

st.markdown(f"<span class='pill-note'>Última atualização consolidada: {formatar_ultima_atualizacao('mercado_farma')}</span>", unsafe_allow_html=True)

with st.expander("Extração Mercado Farma", expanded=False):
    st.caption("Cada UF usa um CNPJ de referência da própria carteira. A extração usa somente o acesso GD do Mercado Farma.")
    if credencial_gd.get("configurado"):
        st.markdown(
            f"<span class='pill-note'>Acesso GD configurado: {escape(str(credencial_gd.get('usuario_mascarado') or 'usuario oculto'))}</span>",
            unsafe_allow_html=True,
        )
    else:
        faltantes = ", ".join(str(item) for item in credencial_gd.get("faltantes", []))
        st.warning(f"Configure o acesso GD do Mercado Farma nos Secrets do Streamlit/GitHub: {faltantes}.")
    if alvos:
        tabela_alvos = pd.DataFrame([{"UF": item["uf"], "CNPJ referência": item["cnpj"]} for item in alvos])
        st.dataframe(tabela_alvos, width="stretch", height=170, hide_index=True)
    else:
        st.info("Não encontrei CNPJ referência ativo na carteira para montar a extração por UF.")
    if ufs_sem_cnpj:
        st.warning("UFs na carteira sem CNPJ referência ativo: " + ", ".join(ufs_sem_cnpj))

    eans = mf.obter_eans_para_consulta(produtos_mercado)
    st.markdown(
        f"<span class='pill-note'>Lista produtos.xlsx: {len(eans)} EANs</span>"
        f"<span class='pill-note'>Atualização da lista: {formatar_ultima_atualizacao('produtos_mercado_farma')}</span>",
        unsafe_allow_html=True,
    )
    upload_eans = st.file_uploader("Atualizar planilha produtos.xlsx com EANs", type=["xlsx"], key="upload_produtos_mercado_farma")
    if upload_eans is not None:
        registrar_upload("produtos_mercado_farma", upload_eans)
        st.cache_data.clear()
        st.success("Lista produtos.xlsx salva para as próximas extrações.")
        st.rerun()

    ufs_para_rodar = st.multiselect("UFs para atualizar", ufs_alvos, default=ufs_alvos, key="mf_ufs_rodar")
    limite_eans = st.number_input("Limite de EANs para teste (0 = todos)", min_value=0, step=10, value=0)

    col_git1, col_git2 = st.columns(2)
    if col_git1.button("Atualizar UFs Selecionadas", width="stretch", disabled=not bool(ufs_para_rodar)):
        try:
            gha.disparar_mercado_farma(ufs_para_rodar, int(limite_eans or 0))
            st.success("Atualização iniciada. Acompanhe o status abaixo.")
        except Exception as exc:
            st.error(f"Não consegui iniciar a atualização: {exc}")
    if col_git2.button("Atualizar Todas as UFs", width="stretch", disabled=not bool(ufs_alvos)):
        try:
            gha.disparar_mercado_farma(ufs_alvos, int(limite_eans or 0))
            st.success("Atualização iniciada para todas as UFs.")
        except Exception as exc:
            st.error(f"Não consegui iniciar a atualização: {exc}")

    status_consolidado = mf.carregar_status_consolidado()
    status_tabela = tabela_status_consolidado(status_consolidado)
    if not status_tabela.empty:
        st.markdown("<span class='pill-note'>Status do consolidado</span>", unsafe_allow_html=True)
        st.dataframe(status_tabela, width="stretch", hide_index=True)

    runs = gha.listar_execucoes_mercado_farma(5)
    if runs:
        renderizar_execucoes_actions(runs)

    with st.expander("Extração local de apoio", expanded=False):
        estado = mf.carregar_estado_extracao()
        painel_status_extracao(estado)
        headless = st.toggle("Rodar navegador oculto", value=True, key="mercado_headless")
        rodando = estado.get("status") == "rodando" and estado.get("thread_alive")
        pode_retomar = estado.get("status") in {"erro", "cancelado", "interrompido"}
        col1, col2, col3 = st.columns(3)
        local_desabilitado = rodando or not bool(ufs_para_rodar) or not bool(credenciais)
        if col1.button("Iniciar extração local", width="stretch", disabled=local_desabilitado):
            try:
                mf.iniciar_extracao_background(
                    credenciais,
                    clientes,
                    produtos_mercado,
                    headless=headless,
                    limite_eans=int(limite_eans) if limite_eans else None,
                    retomar=False,
                    ufs=ufs_para_rodar,
                )
                st.success("Extração local iniciada.")
                st.rerun()
            except Exception as exc:
                st.error(f"Falha ao iniciar extração local: {exc}")

        if col2.button("Retomar local", width="stretch", disabled=rodando or not pode_retomar or not bool(credenciais)):
            try:
                mf.iniciar_extracao_background(
                    credenciais,
                    clientes,
                    produtos_mercado,
                    headless=headless,
                    limite_eans=int(limite_eans) if limite_eans else None,
                    retomar=True,
                    ufs=ufs_para_rodar,
                )
                st.success("Extração local retomada.")
                st.rerun()
            except Exception as exc:
                st.error(f"Falha ao retomar extração local: {exc}")

        if col3.button("Cancelar local", width="stretch", disabled=not rodando):
            mf.cancelar_extracao_background()
            st.warning("Cancelamento solicitado.")
            st.rerun()

    upload = st.file_uploader("Importar planilha Mercado Farma", type=["xlsx"], key="upload_mercado_farma")
    if upload is not None:
        registrar_upload("mercado_farma", upload)
        st.cache_data.clear()
        st.success("Planilha Mercado Farma salva.")
        st.rerun()

if mercado.empty:
    st.info("Ainda não existe base do Mercado Farma salva. Extraia pelo botão acima ou importe uma planilha.")
    st.stop()

preco_valido = pd.to_numeric(mercado["preco_sem_imposto"], errors="coerce").fillna(0) > 0
estoque_valido = pd.to_numeric(mercado["estoque"], errors="coerce").fillna(0) > 0
mercado_valido = mercado[preco_valido & estoque_valido].copy()

configurar_desconto_adicional(mf.preparar_mercado_farma(mercado_original))

mf_metricas = mercado_valido.copy()
m1, m2, m3, m4 = st.columns(4)
with m1:
    card_metrica("Produtos com preço", str(int(mf_metricas["ean"].nunique())))
with m2:
    card_metrica("UFs", str(int(mf_metricas["uf"].nunique())))
with m3:
    card_metrica("Distribuidoras", str(int(mf_metricas["distribuidora"].nunique())))
with m4:
    estoque_total = int(pd.to_numeric(mf_metricas["estoque"], errors="coerce").fillna(0).sum())
    card_metrica("Estoque total", f"{estoque_total:,}".replace(",", "."))

total_melhores = len(mf.melhor_preco_por_ean(mercado_valido))
with st.expander(f"Melhores preços — {total_melhores} produtos encontrados", expanded=False):
    f1, f2, f3, f4 = st.columns([1.6, 0.8, 1.2, 0.7])
    busca = f1.text_input("Buscar produto, EAN ou distribuidora", key="mf_busca_melhores")
    uf_sel = f2.multiselect("UF", sorted(mercado_valido["uf"].dropna().astype(str).unique().tolist()), key="mf_uf_melhores")
    distribuidora_sel = f3.multiselect(
        "Distribuidora",
        sorted(mercado_valido["distribuidora"].dropna().astype(str).unique().tolist()),
        key="mf_dist_melhores",
    )
    buscar = f4.button("Buscar", width="stretch", key="mf_botao_buscar")
    if buscar:
        st.session_state["mf_mostrar_melhores"] = True

    filtrado = mercado_valido.copy()
    if uf_sel:
        filtrado = filtrado[filtrado["uf"].isin(uf_sel)].copy()
    if distribuidora_sel:
        filtrado = filtrado[filtrado["distribuidora"].isin(distribuidora_sel)].copy()
    if busca:
        termo = busca.strip().lower()
        mask = (
            filtrado["produto"].astype(str).str.lower().str.contains(termo, na=False, regex=False)
            | filtrado["ean"].astype(str).str.lower().str.contains(termo, na=False, regex=False)
            | filtrado["distribuidora"].astype(str).str.lower().str.contains(termo, na=False, regex=False)
        )
        filtrado = filtrado[mask].copy()

    melhores = mf.melhor_preco_por_ean(filtrado)
    deve_mostrar = bool(st.session_state.get("mf_mostrar_melhores")) or bool(busca or uf_sel or distribuidora_sel)
    if not deve_mostrar:
        st.info("Use a busca ou os filtros e clique em Buscar para carregar os cards de melhores preços.")
    elif melhores.empty:
        st.info("Sem produtos com preço e estoque para os filtros selecionados.")
    else:
        limite_cards = min(len(melhores), 60)
        for fatia in [melhores.iloc[i : i + 3] for i in range(0, limite_cards, 3)]:
            cols = st.columns(3)
            for col, (_, item) in zip(cols, fatia.iterrows()):
                with col:
                    grupo = filtrado[(filtrado["uf"] == item["uf"]) & (filtrado["ean"] == item["ean"])].copy()
                    produto_card_distribuidora(grupo, f"dist_{item['uf']}_{item['ean']}_{int(item.name)}")

    if deve_mostrar:
        c1, c2 = st.columns(2)
        with c1:
            botao_download_excel(tabela_mercado_sem_consultor(filtrado), "mercado_farma_por_uf.xlsx", "Extrair lista completa em Excel")
        with c2:
            botao_download_excel(tabela_mercado_sem_consultor(melhores), "mercado_farma_melhores_precos.xlsx", "Extrair melhores preços em Excel")

        with st.expander("Tabela completa", expanded=False):
            dataframe_com_download(tabela_mercado_sem_consultor(filtrado), "mercado_farma_completo", altura=420)
