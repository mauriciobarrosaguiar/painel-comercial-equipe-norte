from __future__ import annotations

from html import escape

import pandas as pd
import streamlit as st

from src.calculos import formatar_tabela_metricas, gerar_resultado_cliente
from src.filtros import aplicar_filtros_globais, filtrar_busca
from src.layout import botao_download_excel, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.oportunidades import gerar_oportunidades
from src.tratamento import STATUS_CANCELADO, formatar_moeda, normalizar_ean


TIPOS_MIX_FOCO = {"PRIORITARIO", "LANCAMENTO"}


def _texto(valor: object, padrao: str = "-") -> str:
    if valor is None or pd.isna(valor):
        return padrao
    texto = str(valor).strip()
    return texto or padrao


def _tipo_mix(valor: object) -> str:
    texto = _texto(valor, "").upper()
    texto = texto.replace("PRIORITÁRIO", "PRIORITARIO").replace("LANÇAMENTO", "LANCAMENTO")
    return texto


def _tipo_display(valor: object) -> str:
    tipo = _tipo_mix(valor)
    if tipo == "PRIORITARIO":
        return "Prioritário"
    if tipo == "LANCAMENTO":
        return "Lançamento"
    return _texto(valor)


def _numero(valor: object) -> float:
    try:
        return float(valor or 0)
    except Exception:
        return 0.0


def _unidades(valor: object) -> str:
    numero = _numero(valor)
    if abs(numero - int(numero)) < 0.0001:
        return f"{int(numero):,}".replace(",", ".")
    return f"{numero:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def preparar_mix_foco(produtos_mix: pd.DataFrame, vendas: pd.DataFrame) -> pd.DataFrame:
    if produtos_mix is not None and not produtos_mix.empty:
        base = produtos_mix.copy()
        for coluna in ["ean_limpo", "ean", "produto", "tipo_mix"]:
            if coluna not in base.columns:
                base[coluna] = ""
        base["ean_limpo"] = base["ean_limpo"].where(base["ean_limpo"].astype(str).str.strip().ne(""), base["ean"])
    else:
        base = vendas[["ean_limpo", "produto", "tipo_mix"]].copy() if vendas is not None and not vendas.empty else pd.DataFrame()
        if base.empty:
            return pd.DataFrame(columns=["ean_limpo", "produto", "tipo_mix"])

    base["ean_limpo"] = base["ean_limpo"].apply(normalizar_ean)
    base["tipo_mix"] = base["tipo_mix"].apply(_tipo_mix)
    base["produto"] = base["produto"].apply(lambda valor: _texto(valor, "Produto sem descrição"))
    base = base[base["ean_limpo"].ne("") & base["tipo_mix"].isin(TIPOS_MIX_FOCO)].copy()
    return base[["ean_limpo", "produto", "tipo_mix"]].drop_duplicates("ean_limpo").sort_values(["tipo_mix", "produto"]).reset_index(drop=True)


def compras_mix_por_cliente(vendas: pd.DataFrame, mix_foco: pd.DataFrame) -> pd.DataFrame:
    if vendas is None or vendas.empty or mix_foco.empty:
        return pd.DataFrame(columns=["cnpj_limpo", "ean_limpo", "produto", "tipo_mix", "valor_vendido", "unidades_vendidas"])
    base = vendas.copy()
    if "status_normalizado" in base.columns:
        base = base[base["status_normalizado"].ne(STATUS_CANCELADO)].copy()
    for coluna in ["cnpj_limpo", "ean_limpo", "produto", "tipo_mix", "valor_vendido_sem_imposto", "quantidade_base"]:
        if coluna not in base.columns:
            base[coluna] = 0 if coluna in {"valor_vendido_sem_imposto", "quantidade_base"} else ""
    base["ean_limpo"] = base["ean_limpo"].apply(normalizar_ean)
    base = base.merge(
        mix_foco.rename(columns={"produto": "produto_cadastro_mix", "tipo_mix": "tipo_cadastro_mix"}),
        on="ean_limpo",
        how="inner",
    )
    if base.empty:
        return pd.DataFrame(columns=["cnpj_limpo", "ean_limpo", "produto", "tipo_mix", "valor_vendido", "unidades_vendidas"])
    base["valor_vendido_sem_imposto"] = pd.to_numeric(base["valor_vendido_sem_imposto"], errors="coerce").fillna(0)
    base["quantidade_base"] = pd.to_numeric(base["quantidade_base"], errors="coerce").fillna(0)
    produto_mix = base.get("produto_cadastro_mix", pd.Series("", index=base.index)).astype(str)
    produto_venda = base.get("produto", pd.Series("", index=base.index)).astype(str)
    base["produto_final"] = produto_mix.where(produto_mix.str.strip().ne(""), produto_venda)
    agrupado = (
        base.groupby(["cnpj_limpo", "ean_limpo"], dropna=False)
        .agg(
            produto=("produto_final", "first"),
            tipo_mix=("tipo_cadastro_mix", "first"),
            valor_vendido=("valor_vendido_sem_imposto", "sum"),
            unidades_vendidas=("quantidade_base", "sum"),
        )
        .reset_index()
    )
    return agrupado


def carregar_melhores_precos() -> pd.DataFrame:
    try:
        from src import mercado_farma as mf

        mercado = mf.aplicar_descontos_adicionais(mf.mercado_farma_atual())
        return mf.melhor_preco_por_ean(mercado)
    except Exception:
        return pd.DataFrame()


def _preco_lookup(precos: pd.DataFrame) -> tuple[dict[tuple[str, str], dict], dict[str, dict]]:
    if precos is None or precos.empty:
        return {}, {}
    base = precos.copy()
    for coluna in ["uf", "ean", "preco_sem_imposto", "distribuidora", "estoque"]:
        if coluna not in base.columns:
            base[coluna] = 0 if coluna in {"preco_sem_imposto", "estoque"} else ""
    base["ean"] = base["ean"].apply(normalizar_ean)
    base["uf"] = base["uf"].astype(str).str.strip().str.upper()
    base["preco_sem_imposto"] = pd.to_numeric(base["preco_sem_imposto"], errors="coerce").fillna(0)
    base["estoque"] = pd.to_numeric(base["estoque"], errors="coerce").fillna(0)
    base = base[base["ean"].ne("") & base["preco_sem_imposto"].gt(0)].copy()
    por_uf: dict[tuple[str, str], dict] = {}
    por_ean: dict[str, dict] = {}
    for _, item in base.sort_values(["preco_sem_imposto", "estoque"], ascending=[True, False]).iterrows():
        registro = item.to_dict()
        por_uf.setdefault((str(item["uf"]), str(item["ean"])), registro)
        por_ean.setdefault(str(item["ean"]), registro)
    return por_uf, por_ean


def melhor_preco_produto(ean: str, uf: str, por_uf: dict[tuple[str, str], dict], por_ean: dict[str, dict]) -> dict:
    ean_limpo = normalizar_ean(ean)
    uf_txt = _texto(uf, "").upper()
    return por_uf.get((uf_txt, ean_limpo)) or por_ean.get(ean_limpo) or {}


def produto_html(item: dict, *, mostrar_vendido: bool) -> str:
    preco = item.get("preco") or {}
    melhor = _numero(preco.get("preco_sem_imposto", 0))
    dist = _texto(preco.get("distribuidora", ""), "-")
    estoque = _numero(preco.get("estoque", 0))
    vendido = ""
    if mostrar_vendido:
        vendido = (
            f"<div class='mix-product-meta'>Vendido: {formatar_moeda(item.get('valor_vendido', 0))}"
            f" | {_unidades(item.get('unidades_vendidas', 0))} un.</div>"
        )
    preco_txt = formatar_moeda(melhor) if melhor > 0 else "-"
    return f"""
        <div class="mix-product-row">
            <div class="mix-product-title">{escape(_texto(item.get('produto'), 'Produto sem descrição'))}</div>
            <div class="mix-product-meta">{escape(_tipo_display(item.get('tipo_mix')))} | EAN {escape(_texto(item.get('ean_limpo')))}</div>
            {vendido}
            <div class="mix-product-price">Melhor preço MF: {preco_txt}</div>
            <div class="mix-product-meta">Distribuidora: {escape(dist)} | Estoque: {_unidades(estoque)} un.</div>
        </div>
    """


def tabela_produtos_cliente(produtos: list[dict], *, mostrar_vendido: bool) -> pd.DataFrame:
    linhas: list[dict] = []
    for item in produtos:
        preco = item.get("preco") or {}
        linha = {
            "Produto": _texto(item.get("produto"), "Produto sem descrição"),
            "Tipo": _tipo_display(item.get("tipo_mix")),
            "EAN": _texto(item.get("ean_limpo")),
            "Preço com desconto": formatar_moeda(_numero(preco.get("preco_sem_imposto", 0))),
            "Estoque": _unidades(preco.get("estoque", 0)),
        }
        if mostrar_vendido:
            linha = {
                **linha,
                "Vendido": formatar_moeda(item.get("valor_vendido", 0)),
                "Unidades": _unidades(item.get("unidades_vendidas", 0)),
            }
            ordem = ["Produto", "Tipo", "EAN", "Vendido", "Unidades", "Preço com desconto", "Estoque"]
            linha = {coluna: linha[coluna] for coluna in ordem}
        linhas.append(linha)
    return pd.DataFrame(linhas)


def mostrar_tabela_produtos(titulo: str, produtos: list[dict], *, mostrar_vendido: bool) -> None:
    st.markdown(f"**{titulo}**")
    tabela = tabela_produtos_cliente(produtos, mostrar_vendido=mostrar_vendido)
    if tabela.empty:
        st.caption("Nenhum produto nesta situação.")
        return
    altura = min(380, 38 + (min(len(tabela), 8) * 36))
    st.dataframe(tabela, width="stretch", hide_index=True, height=altura)


def aplicar_filtros_base(df: pd.DataFrame, consultor: str, ufs: list[str], cidades: list[str]) -> pd.DataFrame:
    base = df.copy()
    if consultor != "Todos":
        coluna = "consultor" if "consultor" in base.columns else "nome_rep"
        if coluna not in base.columns:
            return base.iloc[0:0].copy()
        base = base[base[coluna].astype(str).eq(consultor)].copy()
    if ufs and "uf" in base.columns:
        base = base[base["uf"].astype(str).isin(ufs)].copy()
    if cidades and "cidade" in base.columns:
        base = base[base["cidade"].astype(str).isin(cidades)].copy()
    return base


def montar_mix_cliente(cliente: pd.Series, mix_foco: pd.DataFrame, compras: pd.DataFrame, por_uf: dict, por_ean: dict) -> tuple[list[dict], list[dict]]:
    cnpj = str(cliente.get("cnpj_limpo", ""))
    uf = str(cliente.get("uf", ""))
    colunas_compras = ["cnpj_limpo", "ean_limpo", "produto", "tipo_mix", "valor_vendido", "unidades_vendidas"]
    if compras is None or compras.empty:
        compras_cliente = pd.DataFrame(columns=colunas_compras)
    else:
        base_compras = compras.copy()
        for coluna in colunas_compras:
            if coluna not in base_compras.columns:
                base_compras[coluna] = 0 if coluna in {"valor_vendido", "unidades_vendidas"} else ""
        compras_cliente = base_compras[base_compras["cnpj_limpo"].astype(str).eq(cnpj)].copy()
    comprados: list[dict] = []
    eans_comprados: set[str] = set()
    if not compras_cliente.empty:
        compras_cliente = compras_cliente.sort_values(["tipo_mix", "valor_vendido"], ascending=[True, False])
    for _, item in compras_cliente.iterrows():
        if _numero(item.get("valor_vendido", 0)) <= 0 and _numero(item.get("unidades_vendidas", 0)) <= 0:
            continue
        ean = normalizar_ean(item.get("ean_limpo"))
        eans_comprados.add(ean)
        registro = item.to_dict()
        registro["preco"] = melhor_preco_produto(ean, uf, por_uf, por_ean)
        comprados.append(registro)

    faltantes: list[dict] = []
    for _, item in mix_foco[~mix_foco["ean_limpo"].isin(eans_comprados)].iterrows():
        registro = item.to_dict()
        registro["valor_vendido"] = 0
        registro["unidades_vendidas"] = 0
        registro["preco"] = melhor_preco_produto(registro["ean_limpo"], uf, por_uf, por_ean)
        faltantes.append(registro)
    return comprados, faltantes


def tabela_mix_clientes(clientes_resultado: pd.DataFrame, mix_foco: pd.DataFrame, compras: pd.DataFrame, por_uf: dict, por_ean: dict) -> pd.DataFrame:
    linhas: list[dict] = []
    if clientes_resultado.empty or mix_foco.empty:
        return pd.DataFrame()
    if compras is not None and not compras.empty:
        compras_base = compras.copy()
        for coluna in ["cnpj_limpo", "ean_limpo", "valor_vendido", "unidades_vendidas"]:
            if coluna not in compras_base.columns:
                compras_base[coluna] = 0 if coluna in {"valor_vendido", "unidades_vendidas"} else ""
        compras_idx = compras_base.set_index(["cnpj_limpo", "ean_limpo"])
    else:
        compras_idx = pd.DataFrame()
    for _, cliente in clientes_resultado.iterrows():
        cnpj = str(cliente.get("cnpj_limpo", ""))
        uf = str(cliente.get("uf", ""))
        for _, produto in mix_foco.iterrows():
            ean = produto["ean_limpo"]
            comprado = False
            valor = 0.0
            unidades = 0.0
            if not compras_idx.empty and (cnpj, ean) in compras_idx.index:
                item = compras_idx.loc[(cnpj, ean)]
                if isinstance(item, pd.DataFrame):
                    item = item.iloc[0]
                valor = _numero(item.get("valor_vendido", 0))
                unidades = _numero(item.get("unidades_vendidas", 0))
                comprado = valor > 0 or unidades > 0
            preco = melhor_preco_produto(ean, uf, por_uf, por_ean)
            linhas.append(
                {
                    "Consultor": cliente.get("consultor", ""),
                    "Cliente": cliente.get("nome_pdv", ""),
                    "CNPJ": cnpj,
                    "Cidade": cliente.get("cidade", ""),
                    "UF": uf,
                    "Produto": produto.get("produto", ""),
                    "EAN": ean,
                    "Tipo mix": _tipo_display(produto.get("tipo_mix", "")),
                    "Situação": "Comprado" if comprado else "Falta comprar",
                    "Valor vendido": valor,
                    "Unidades vendidas": unidades,
                    "Melhor preço MF": _numero(preco.get("preco_sem_imposto", 0)),
                    "Distribuidora MF": preco.get("distribuidora", ""),
                    "Estoque MF": _numero(preco.get("estoque", 0)),
                }
            )
    return pd.DataFrame(linhas)


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]
produtos_mix = dados["produtos_mix"]

titulo_pagina("Oportunidades")

vendas_f, clientes_f, _ = aplicar_filtros_globais(vendas, clientes, chave="oportunidades")
oportunidades_base = gerar_oportunidades(vendas_f, clientes_f, produtos_mix)

consultores_lista = sorted(clientes_f["nome_rep"].dropna().astype(str).unique().tolist()) if not clientes_f.empty and "nome_rep" in clientes_f.columns else []
ufs_lista = sorted(clientes_f["uf"].dropna().astype(str).unique().tolist()) if not clientes_f.empty and "uf" in clientes_f.columns else []
cidades_lista = sorted(clientes_f["cidade"].dropna().astype(str).unique().tolist()) if not clientes_f.empty and "cidade" in clientes_f.columns else []

c1, c2, c3, c4 = st.columns([1, 1.2, 1.2, 1.6])
prioridades = c1.multiselect("Prioridade", ["Alta", "Média", "Baixa"], default=[])
consultor_sel = c2.selectbox("Consultor", ["Todos"] + consultores_lista)
uf_sel = c3.multiselect("UF", ufs_lista)
cidade_sel = c4.multiselect("Cidade", cidades_lista)
busca = st.text_input("Buscar oportunidade, cliente ou CNPJ")

oportunidades = oportunidades_base.copy()
if prioridades and not oportunidades.empty:
    oportunidades = oportunidades[oportunidades["prioridade"].isin(prioridades)].copy()
oportunidades = aplicar_filtros_base(oportunidades, consultor_sel, uf_sel, cidade_sel)
oportunidades = filtrar_busca(oportunidades, busca, ["consultor", "cliente", "cnpj", "grupo_sip", "cidade", "motivo_alerta"])

clientes_filtrados = aplicar_filtros_base(clientes_f, consultor_sel, uf_sel, cidade_sel)
clientes_resultado = gerar_resultado_cliente(vendas_f, clientes_filtrados) if not clientes_filtrados.empty else pd.DataFrame()
clientes_resultado = filtrar_busca(clientes_resultado, busca, ["consultor", "nome_pdv", "cnpj_limpo", "cidade", "uf"])

st.markdown(
    f"<span class='pill-note'>Alta: {int((oportunidades.get('prioridade', '') == 'Alta').sum()) if not oportunidades.empty else 0}</span>"
    f"<span class='pill-note'>Média: {int((oportunidades.get('prioridade', '') == 'Média').sum()) if not oportunidades.empty else 0}</span>"
    f"<span class='pill-note'>Baixa: {int((oportunidades.get('prioridade', '') == 'Baixa').sum()) if not oportunidades.empty else 0}</span>",
    unsafe_allow_html=True,
)

st.subheader("Prioritários e Lançamentos por cliente")
mix_foco = preparar_mix_foco(produtos_mix, vendas_f)
compras_mix = compras_mix_por_cliente(vendas_f, mix_foco)
precos_mercado = carregar_melhores_precos()
preco_por_uf, preco_por_ean = _preco_lookup(precos_mercado)

if mix_foco.empty:
    st.warning("Não encontrei produtos PRIORITARIO ou LANCAMENTO classificados no mix.")
elif clientes_resultado.empty:
    st.info("Nenhum cliente encontrado para os filtros atuais.")
else:
    cliente_opcoes = ["Todos"] + [
        f"{row.nome_pdv} | {row.cnpj_limpo}"
        for row in clientes_resultado[["nome_pdv", "cnpj_limpo"]].drop_duplicates().itertuples(index=False)
    ]
    cliente_sel = st.selectbox("Cliente para análise do mix", cliente_opcoes)
    if cliente_sel != "Todos":
        cnpj_sel = cliente_sel.rsplit("|", 1)[-1].strip()
        clientes_cards = clientes_resultado[clientes_resultado["cnpj_limpo"].astype(str).eq(cnpj_sel)].copy()
    else:
        clientes_cards = clientes_resultado.head(8).copy()
        if len(clientes_resultado) > 8:
            st.caption("Mostrando 8 clientes. Use os filtros ou selecione um cliente para detalhar.")

    for _, cliente in clientes_cards.iterrows():
        comprados, faltantes = montar_mix_cliente(cliente, mix_foco, compras_mix, preco_por_uf, preco_por_ean)
        with st.container(border=True):
            st.markdown(
                f"""
                <div class="contact-title">{escape(_texto(cliente.get('nome_pdv')))}</div>
                <div class="contact-line"><b>Consultor:</b> {escape(_texto(cliente.get('consultor')))} | <b>CNPJ:</b> {escape(_texto(cliente.get('cnpj_limpo')))}</div>
                <div class="contact-line"><b>Cidade/UF:</b> {escape(_texto(cliente.get('cidade')))} / {escape(_texto(cliente.get('uf')))}</div>
                <span class="pill-note">Comprados: {len(comprados)}</span>
                <span class="pill-note">Falta comprar: {len(faltantes)}</span>
                """,
                unsafe_allow_html=True,
            )
            mostrar_tabela_produtos("Comprados (Prioritários e Lançamentos)", comprados, mostrar_vendido=True)
            mostrar_tabela_produtos("Não comprados (Prioritários e Lançamentos)", faltantes, mostrar_vendido=False)

colunas = [
    "prioridade",
    "consultor",
    "cliente",
    "cnpj",
    "grupo_sip",
    "cidade",
    "uf",
    "motivo_alerta",
    "acao_sugerida",
    "ol_sem_combate",
    "ol_prioritarios",
    "ol_lancamentos",
]
renomear = {
    "prioridade": "Prioridade",
    "consultor": "Consultor",
    "cliente": "Cliente",
    "cnpj": "CNPJ",
    "grupo_sip": "Rede / SIP",
    "cidade": "Cidade",
    "uf": "UF",
    "motivo_alerta": "Motivo",
    "acao_sugerida": "Ação sugerida",
    "ol_sem_combate": "OL Sem Combate",
    "ol_prioritarios": "OL Prioritários",
    "ol_lancamentos": "OL Lançamentos",
}

with st.expander("Tabela completa e exportação", expanded=False):
    tabela = formatar_tabela_metricas(oportunidades[colunas]).rename(columns=renomear) if not oportunidades.empty else oportunidades
    dataframe_com_download(tabela, "oportunidades", altura=360)
    botao_download_excel(oportunidades[colunas].rename(columns=renomear) if not oportunidades.empty else oportunidades, "oportunidades_comerciais.xlsx", "Baixar oportunidades em Excel")

mix_export = tabela_mix_clientes(clientes_resultado, mix_foco, compras_mix, preco_por_uf, preco_por_ean)
if not mix_export.empty:
    mix_export_formatado = mix_export.copy()
    for coluna in ["Valor vendido", "Melhor preço MF"]:
        mix_export_formatado[coluna] = mix_export_formatado[coluna].apply(formatar_moeda)
    mix_export_formatado["Unidades vendidas"] = mix_export_formatado["Unidades vendidas"].apply(_unidades)
    mix_export_formatado["Estoque MF"] = mix_export_formatado["Estoque MF"].apply(_unidades)
    nao_comprados = mix_export_formatado[mix_export_formatado["Situação"].eq("Falta comprar")].copy()
    c1, c2 = st.columns(2)
    with c1:
        botao_download_excel(nao_comprados, "produtos_prioritarios_lancamentos_nao_comprados.xlsx", "Baixar não comprados em Excel")
    with c2:
        botao_download_excel(mix_export_formatado, "mix_prioritarios_lancamentos_por_cliente.xlsx", "Baixar mix completo em Excel")
