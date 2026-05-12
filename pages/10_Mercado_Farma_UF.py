from __future__ import annotations

from html import escape

import pandas as pd
import streamlit as st

from src.configuracoes import carregar_login_bussola, consultores_unicos
from src.layout import botao_download_excel, card_metrica, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados, registrar_upload
from src import mercado_farma as mf
from src.status_bases import formatar_ultima_atualizacao
from src.tratamento import formatar_moeda


def desconto_texto(valor: object) -> str:
    try:
        numero = float(valor or 0)
    except Exception:
        numero = 0.0
    return f"{numero * 100:,.2f}%".replace(",", "X").replace(".", ",").replace("X", ".")


def _texto_card(valor: object, padrao: str = "-") -> str:
    texto = "" if valor is None or pd.isna(valor) else str(valor).strip()
    return escape(texto or padrao)


def produto_card(item: pd.Series) -> None:
    preco = float(item.get("preco_sem_imposto", 0) or 0)
    preco_com = float(item.get("preco_com_imposto", 0) or 0)
    pf_dist = float(item.get("pf_dist", 0) or 0)
    estoque = int(float(item.get("estoque", 0) or 0))
    produto = _texto_card(item.get("produto"), "Produto sem descrição")
    distribuidora = _texto_card(item.get("distribuidora"), "Distribuidora não identificada")
    st.markdown(
        f"""
        <div class="produto-card">
            <div class="produto-top">
                <span class="desconto-badge">{desconto_texto(item.get('desconto', 0))}</span>
                <span class="produto-meta">{_texto_card(item.get('uf'))}</span>
            </div>
            <div class="produto-nome">{produto}</div>
            <div class="produto-meta">EMS Genéricos &nbsp; | &nbsp; {_texto_card(item.get('ean'))}</div>
            <div class="preco-box">
                <div>
                    <div class="preco-dist">{distribuidora}</div>
                    <div class="preco-estoque">{estoque} un. disponíveis</div>
                </div>
                <div>
                    <div class="preco-secundario">PF Dist.: {formatar_moeda(pf_dist)}</div>
                    <div class="preco-principal">{formatar_moeda(preco)}</div>
                    <div class="preco-secundario">Com imposto: {formatar_moeda(preco_com)}</div>
                </div>
            </div>
            <div class="produto-meta">Consultor: {_texto_card(item.get('consultor'))}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def produto_card_distribuidora(grupo: pd.DataFrame, key: str) -> None:
    opcoes = grupo.sort_values(["preco_sem_imposto", "estoque"], ascending=[True, False]).reset_index(drop=True)
    if opcoes.empty:
        return

    if len(opcoes) > 1:
        def rotulo(indice: int) -> str:
            item = opcoes.iloc[indice]
            dist = str(item.get("distribuidora") or "Distribuidora não identificada")
            preco = formatar_moeda(item.get("preco_sem_imposto", 0))
            estoque = int(float(item.get("estoque", 0) or 0))
            return f"{dist} | {preco} | {estoque} un."

        escolha = st.selectbox("Distribuidora", list(range(len(opcoes))), format_func=rotulo, key=key)
    else:
        escolha = 0
    produto_card(opcoes.iloc[int(escolha)])


def credenciais_por_consultor(login: dict, consultores: list[str]) -> list[dict[str, str]]:
    salvos = login.get("consultores", {}) if isinstance(login, dict) else {}
    credenciais = []
    for consultor in consultores:
        item = salvos.get(consultor, {})
        if item.get("usuario") and item.get("senha") and item.get("extrair", True):
            credenciais.append({"consultor": consultor, "usuario": item["usuario"], "senha": item["senha"]})
    return credenciais


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
        st.code("\n".join(str(item) for item in logs[-18:]), language="text")


dados = carregar_dados_tratados()
clientes = dados["clientes"]
produtos_mercado = dados["produtos_mercado_farma"]

titulo_pagina("Mercado Farma / UF", "Preços e estoque por UF da carteira")

mercado = mf.mercado_farma_atual()
consultores = consultores_unicos(clientes)
login = carregar_login_bussola()
credenciais = credenciais_por_consultor(login, consultores)
alvos = mf.alvos_unicos_por_uf(clientes, credenciais, exigir_login=True)
ufs_carteira = set(mf.ufs_validas_clientes(clientes))
ufs_com_login = {alvo["uf"] for alvo in alvos}
ufs_sem_login = sorted(ufs_carteira - ufs_com_login)

st.markdown(f"<span class='pill-note'>Última atualização: {formatar_ultima_atualizacao('mercado_farma')}</span>", unsafe_allow_html=True)

with st.expander("Extração Mercado Farma", expanded=False):
    st.caption("A extração usa somente logins de vendedores. Cada UF é extraída uma única vez com um CNPJ de referência válido.")
    if alvos:
        tabela_alvos = pd.DataFrame(
            [{"UF": item["uf"], "Consultor usado": item["consultor"], "CNPJ referência": item["cnpj"]} for item in alvos]
        )
        st.dataframe(tabela_alvos, width="stretch", height=190)
    else:
        st.info("Cadastre pelo menos um login de vendedor para montar a extração por UF.")
    if ufs_sem_login:
        st.warning("UFs na carteira ainda sem vendedor com login salvo: " + ", ".join(ufs_sem_login))

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

    estado = mf.carregar_estado_extracao()
    painel_status_extracao(estado)

    headless = st.toggle("Rodar navegador oculto", value=True, key="mercado_headless")
    limite_eans = st.number_input("Limite de EANs para teste (0 = todos)", min_value=0, step=10, value=0)
    rodando = estado.get("status") == "rodando" and estado.get("thread_alive")
    pode_retomar = estado.get("status") in {"erro", "cancelado", "interrompido"}

    col1, col2, col3 = st.columns(3)
    if col1.button("Iniciar extração do zero", width="stretch", disabled=rodando or not bool(alvos)):
        try:
            mf.iniciar_extracao_background(
                credenciais,
                clientes,
                produtos_mercado,
                headless=headless,
                limite_eans=int(limite_eans) if limite_eans else None,
                retomar=False,
            )
            st.success("Extração iniciada. Você pode sair desta página e voltar para acompanhar.")
            st.rerun()
        except Exception as exc:
            st.error(f"Falha ao iniciar extração: {exc}")

    if col2.button("Retomar de onde parou", width="stretch", disabled=rodando or not pode_retomar or not bool(alvos)):
        try:
            mf.iniciar_extracao_background(
                credenciais,
                clientes,
                produtos_mercado,
                headless=headless,
                limite_eans=int(limite_eans) if limite_eans else None,
                retomar=True,
            )
            st.success("Extração retomada em segundo plano.")
            st.rerun()
        except Exception as exc:
            st.error(f"Falha ao retomar extração: {exc}")

    if col3.button("Cancelar extração", width="stretch", disabled=not rodando):
        mf.cancelar_extracao_background()
        st.warning("Cancelamento solicitado.")
        st.rerun()

    upload = st.file_uploader("Importar planilha Mercado Farma", type=["xlsx"], key="upload_mercado_farma")
    if upload is not None:
        registrar_upload("mercado_farma", upload)
        st.cache_data.clear()
        st.success("Planilha Mercado Farma salva.")
        st.rerun()

mercado = mf.mercado_farma_atual()
if mercado.empty:
    st.info("Ainda não existe base do Mercado Farma salva. Extraia pelo botão acima ou importe uma planilha.")
    st.stop()

preco_valido = pd.to_numeric(mercado["preco_sem_imposto"], errors="coerce").fillna(0) > 0
estoque_valido = pd.to_numeric(mercado["estoque"], errors="coerce").fillna(0) > 0
mercado_valido = mercado[preco_valido & estoque_valido].copy()

f1, f2, f3 = st.columns([1, 1, 1.4])
uf_sel = f1.multiselect("UF", sorted(mercado_valido["uf"].dropna().astype(str).unique().tolist()))
consultor_sel = f2.multiselect("Consultor", sorted(mercado_valido["consultor"].dropna().astype(str).unique().tolist()))
busca = f3.text_input("Buscar produto, EAN ou distribuidora")

filtrado = mercado_valido.copy()
if uf_sel:
    filtrado = filtrado[filtrado["uf"].isin(uf_sel)].copy()
if consultor_sel:
    filtrado = filtrado[filtrado["consultor"].isin(consultor_sel)].copy()
if busca:
    termo = busca.strip().lower()
    mask = (
        filtrado["produto"].astype(str).str.lower().str.contains(termo, na=False, regex=False)
        | filtrado["ean"].astype(str).str.lower().str.contains(termo, na=False, regex=False)
        | filtrado["distribuidora"].astype(str).str.lower().str.contains(termo, na=False, regex=False)
    )
    filtrado = filtrado[mask].copy()

melhores = mf.melhor_preco_por_ean(filtrado)
m1, m2, m3, m4 = st.columns(4)
with m1:
    card_metrica("Produtos com preço", str(int(filtrado["ean"].nunique())))
with m2:
    card_metrica("UFs", str(int(filtrado["uf"].nunique())))
with m3:
    card_metrica("Distribuidoras", str(int(filtrado["distribuidora"].nunique())))
with m4:
    estoque_total = int(pd.to_numeric(filtrado["estoque"], errors="coerce").fillna(0).sum())
    card_metrica("Estoque total", f"{estoque_total:,}".replace(",", "."))

st.subheader("Melhores preços")
if melhores.empty:
    st.info("Sem produtos com preço e estoque para os filtros selecionados.")
else:
    limite_cards = min(len(melhores), 60)
    for fatia in [melhores.iloc[i : i + 3] for i in range(0, limite_cards, 3)]:
        cols = st.columns(3)
        for col, (_, item) in zip(cols, fatia.iterrows()):
            with col:
                grupo = filtrado[(filtrado["uf"] == item["uf"]) & (filtrado["ean"] == item["ean"])].copy()
                produto_card_distribuidora(grupo, f"dist_{item['uf']}_{item['ean']}_{int(item.name)}")

c1, c2 = st.columns(2)
with c1:
    botao_download_excel(mf.formatar_tabela_mercado(filtrado), "mercado_farma_por_uf.xlsx", "Extrair lista completa em Excel")
with c2:
    botao_download_excel(mf.formatar_tabela_mercado(melhores), "mercado_farma_melhores_precos.xlsx", "Extrair melhores preços em Excel")

with st.expander("Tabela completa", expanded=False):
    dataframe_com_download(mf.formatar_tabela_mercado(filtrado), "mercado_farma_completo", altura=420)
