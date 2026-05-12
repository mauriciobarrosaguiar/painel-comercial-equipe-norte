from __future__ import annotations

import pandas as pd
import streamlit as st

from src.configuracoes import carregar_login_bussola, consultores_unicos
from src.layout import botao_download_excel, card_metrica, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados, registrar_upload
from src.mercado_farma import (
    extrair_mercado_farma,
    formatar_tabela_mercado,
    mercado_farma_atual,
    melhor_preco_por_ean,
    obter_eans_para_consulta,
    ufs_por_consultor,
)
from src.status_bases import formatar_ultima_atualizacao
from src.tratamento import formatar_moeda


def desconto_texto(valor: object) -> str:
    try:
        numero = float(valor or 0)
    except Exception:
        numero = 0.0
    return f"{numero * 100:,.2f}%".replace(",", "X").replace(".", ",").replace("X", ".")


def produto_card(item: pd.Series) -> None:
    preco = float(item.get("preco_sem_imposto", 0) or 0)
    preco_com = float(item.get("preco_com_imposto", 0) or 0)
    pf_dist = float(item.get("pf_dist", 0) or 0)
    estoque = int(float(item.get("estoque", 0) or 0))
    st.markdown(
        f"""
        <div class="produto-card">
            <div class="produto-top">
                <span class="desconto-badge">{desconto_texto(item.get('desconto', 0))}</span>
                <span class="produto-meta">{item.get('uf', '')}</span>
            </div>
            <div class="produto-nome">{item.get('produto', '') or 'Produto sem descrição'}</div>
            <div class="produto-meta">EMS Genéricos &nbsp; | &nbsp; {item.get('ean', '')}</div>
            <div class="preco-box">
                <div>
                    <div class="preco-dist">{item.get('distribuidora', '') or 'Distribuidora não identificada'}</div>
                    <div class="preco-estoque">{estoque} un. disponíveis</div>
                </div>
                <div>
                    <div class="preco-secundario">PF Dist.: {formatar_moeda(pf_dist)}</div>
                    <div class="preco-principal">{formatar_moeda(preco)}</div>
                    <div class="preco-secundario">Com imposto: {formatar_moeda(preco_com)}</div>
                </div>
            </div>
            <div class="produto-meta">Consultor: {item.get('consultor', '') or '-'}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def credenciais_por_consultor(login: dict, consultores: list[str]) -> list[dict[str, str]]:
    salvos = login.get("consultores", {}) if isinstance(login, dict) else {}
    credenciais = []
    for consultor in consultores:
        item = salvos.get(consultor, {})
        if item.get("usuario") and item.get("senha") and item.get("extrair", True):
            credenciais.append({"consultor": consultor, "usuario": item["usuario"], "senha": item["senha"]})
    return credenciais


dados = carregar_dados_tratados()
clientes = dados["clientes"]
produtos_mercado = dados["produtos_mercado_farma"]

titulo_pagina("Mercado Farma / UF", "Preços e estoque por UF da carteira")

mercado = mercado_farma_atual()
mapa_ufs = ufs_por_consultor(clientes)
consultores = consultores_unicos(clientes)

st.markdown(f"<span class='pill-note'>Última atualização: {formatar_ultima_atualizacao('mercado_farma')}</span>", unsafe_allow_html=True)

with st.expander("Extração Mercado Farma", expanded=False):
    st.caption("A extração usa somente os logins dos vendedores salvos para o Bússola. Para cada consultor, o painel escolhe um CNPJ de referência por UF válida da carteira.")
    login = carregar_login_bussola()
    alvos = []
    for consultor, ufs in mapa_ufs.items():
        for item in ufs:
            alvos.append({"Consultor": consultor, "UF": item["uf"], "CNPJ referência": item["cnpj"]})
    if alvos:
        st.dataframe(pd.DataFrame(alvos), width="stretch", height=220)
    else:
        st.info("Não encontrei CNPJs com UF para montar a extração.")

    eans = obter_eans_para_consulta(produtos_mercado)
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

    headless = st.toggle("Rodar navegador oculto", value=True, key="mercado_headless")
    limite_eans = st.number_input("Limite de EANs para teste (0 = todos)", min_value=0, step=10, value=0)
    col1, col2 = st.columns(2)
    if col1.button("Extrair Mercado Farma por UF", width="stretch", disabled=not bool(alvos)):
        credenciais = credenciais_por_consultor(login, consultores)
        if not credenciais:
            st.error("Nenhum login de vendedor salvo encontrado. Cadastre os acessos dos vendedores na tela Importação > Bússola Web.")
        elif not eans:
            st.error("A planilha produtos.xlsx não tem EANs válidos para consultar.")
        else:
            logs: list[str] = []
            area = st.empty()

            def log(msg: str) -> None:
                logs.append(msg)
                area.code("\n".join(logs[-20:]), language="text")

            try:
                destino = extrair_mercado_farma(
                    credenciais,
                    clientes,
                    produtos_mercado,
                    headless=headless,
                    limite_eans=int(limite_eans) if limite_eans else None,
                    log_fn=log,
                )
                st.cache_data.clear()
                st.success(f"Mercado Farma atualizado: {destino.name}")
                st.rerun()
            except Exception as exc:
                st.error(f"Falha na extração do Mercado Farma: {exc}")

    upload = col2.file_uploader("Importar planilha Mercado Farma", type=["xlsx"], key="upload_mercado_farma")
    if upload is not None:
        registrar_upload("mercado_farma", upload)
        st.cache_data.clear()
        st.success("Planilha Mercado Farma salva.")
        st.rerun()

mercado = mercado_farma_atual()
if mercado.empty:
    st.info("Ainda não existe base do Mercado Farma salva. Extraia pelo botão acima ou importe uma planilha.")
    st.stop()

f1, f2, f3 = st.columns([1, 1, 1.4])
uf_sel = f1.multiselect("UF", sorted(mercado["uf"].dropna().astype(str).unique().tolist()))
consultor_sel = f2.multiselect("Consultor", sorted(mercado["consultor"].dropna().astype(str).unique().tolist()))
busca = f3.text_input("Buscar produto, EAN ou distribuidora")

filtrado = mercado.copy()
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

melhores = melhor_preco_por_ean(filtrado)
m1, m2, m3, m4 = st.columns(4)
with m1:
    card_metrica("Produtos", str(int(filtrado["ean"].nunique())))
with m2:
    card_metrica("UFs", str(int(filtrado["uf"].nunique())))
with m3:
    card_metrica("Distribuidoras", str(int(filtrado["distribuidora"].nunique())))
with m4:
    estoque_total = int(pd.to_numeric(filtrado["estoque"], errors="coerce").fillna(0).sum())
    card_metrica("Estoque total", f"{estoque_total:,}".replace(",", "."))

st.subheader("Melhores preços")
if melhores.empty:
    st.info("Sem produtos com preço/estoque para os filtros selecionados.")
else:
    for fatia in [melhores.iloc[i : i + 3] for i in range(0, min(len(melhores), 60), 3)]:
        cols = st.columns(3)
        for col, (_, item) in zip(cols, fatia.iterrows()):
            with col:
                produto_card(item)

c1, c2 = st.columns(2)
with c1:
    botao_download_excel(formatar_tabela_mercado(filtrado), "mercado_farma_por_uf.xlsx", "Extrair lista completa em Excel")
with c2:
    botao_download_excel(formatar_tabela_mercado(melhores), "mercado_farma_melhores_precos.xlsx", "Extrair melhores preços em Excel")

with st.expander("Tabela completa", expanded=False):
    dataframe_com_download(formatar_tabela_mercado(filtrado), "mercado_farma_completo", altura=420)
