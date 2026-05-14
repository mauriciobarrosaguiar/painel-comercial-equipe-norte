from __future__ import annotations

from datetime import date
from uuid import uuid4

import pandas as pd
import streamlit as st

from src.datas import formatar_data_brasil, hoje_brasilia
from src.foco_semanal import abreviar_molecula, carregar_foco_semanal, identificar_molecula, salvar_foco_semanal
from src.layout import botao_download_excel, card_metrica, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.tratamento import STATUS_CANCELADO, formatar_moeda, normalizar_ean, slug_coluna


def _catalogo_produtos(produtos_mix: pd.DataFrame, vendas: pd.DataFrame) -> pd.DataFrame:
    if produtos_mix is not None and not produtos_mix.empty:
        colunas = [coluna for coluna in ["ean_limpo", "produto", "tipo_mix"] if coluna in produtos_mix.columns]
        base = produtos_mix[colunas].copy()
    elif vendas is not None and not vendas.empty:
        colunas = [coluna for coluna in ["ean_limpo", "produto", "tipo_mix"] if coluna in vendas.columns]
        base = vendas[colunas].copy()
    else:
        return pd.DataFrame(columns=["ean_limpo", "produto", "tipo_mix", "molecula", "label"])

    for coluna in ["ean_limpo", "produto", "tipo_mix"]:
        if coluna not in base.columns:
            base[coluna] = ""
    base["ean_limpo"] = base["ean_limpo"].fillna("").astype(str).apply(normalizar_ean)
    base["produto"] = base["produto"].fillna("").astype(str).str.strip()
    base["tipo_mix"] = base["tipo_mix"].fillna("").astype(str).str.strip()
    base = base[base["ean_limpo"].ne("")].drop_duplicates("ean_limpo", keep="first").copy()
    base["molecula"] = base["produto"].apply(identificar_molecula)
    base["label"] = base.apply(
        lambda linha: f"{linha['produto'] or 'Produto sem descrição'} | EAN {linha['ean_limpo']}",
        axis=1,
    )
    return base.sort_values("produto").reset_index(drop=True)


def _produto_por_ean(catalogo: pd.DataFrame) -> dict[str, dict[str, str]]:
    if catalogo.empty:
        return {}
    return {
        str(linha["ean_limpo"]): {
            "ean": str(linha["ean_limpo"]),
            "produto": str(linha.get("produto", "") or ""),
            "tipo_mix": str(linha.get("tipo_mix", "") or ""),
            "molecula": str(linha.get("molecula", "") or ""),
        }
        for _, linha in catalogo.iterrows()
    }


def _periodo_acao(acao: dict) -> tuple[date, date]:
    inicio = pd.to_datetime(acao.get("data_inicio"), errors="coerce")
    fim = pd.to_datetime(acao.get("data_fim"), errors="coerce")
    hoje = hoje_brasilia()
    data_inicio = inicio.date() if not pd.isna(inicio) else hoje
    data_fim = fim.date() if not pd.isna(fim) else data_inicio
    return data_inicio, data_fim


def _produtos_da_acao(acao: dict, catalogo: pd.DataFrame) -> pd.DataFrame:
    produtos = pd.DataFrame(acao.get("produtos", []))
    if produtos.empty:
        return pd.DataFrame(columns=["ean", "produto", "tipo_mix", "molecula"])

    for coluna in ["ean", "produto", "tipo_mix", "molecula"]:
        if coluna not in produtos.columns:
            produtos[coluna] = ""
    produtos["ean"] = produtos["ean"].apply(normalizar_ean)
    produtos = produtos[produtos["ean"].ne("")].drop_duplicates("ean", keep="first").copy()
    mapa_produtos = _produto_por_ean(catalogo)
    produtos["produto"] = produtos.apply(
        lambda linha: linha.get("produto", "") or mapa_produtos.get(linha["ean"], {}).get("produto", ""),
        axis=1,
    )
    produtos["tipo_mix"] = produtos.apply(
        lambda linha: linha.get("tipo_mix", "") or mapa_produtos.get(linha["ean"], {}).get("tipo_mix", ""),
        axis=1,
    )
    produtos["molecula"] = produtos.apply(
        lambda linha: linha.get("molecula", "") or mapa_produtos.get(linha["ean"], {}).get("molecula", "") or identificar_molecula(linha.get("produto", "")),
        axis=1,
    )
    produtos["molecula"] = produtos["molecula"].fillna("").astype(str).map(lambda valor: valor or "PRODUTO SEM DESCRIÇÃO")
    return produtos[["ean", "produto", "tipo_mix", "molecula"]]


def _resultado_detalhado_acao(acao: dict, vendas: pd.DataFrame, catalogo: pd.DataFrame) -> pd.DataFrame:
    produtos = _produtos_da_acao(acao, catalogo)
    if produtos.empty:
        return pd.DataFrame(
            columns=["consultor", "ean", "produto", "tipo_mix", "molecula", "quantidade_vendida", "valor_vendido", "pedidos", "clientes"]
        )

    if vendas is None or vendas.empty:
        return pd.DataFrame(
            columns=["consultor", "ean", "produto", "tipo_mix", "molecula", "quantidade_vendida", "valor_vendido", "pedidos", "clientes"]
        )

    inicio, fim = _periodo_acao(acao)
    base = vendas.copy()
    base["data_base"] = pd.to_datetime(base["data_base"], errors="coerce")
    base = base[
        base["ean_limpo"].astype(str).isin(set(produtos["ean"]))
        & base["data_base"].dt.date.ge(inicio)
        & base["data_base"].dt.date.le(fim)
        & base["status_normalizado"].ne(STATUS_CANCELADO)
    ].copy()
    if base.empty:
        return pd.DataFrame(
            columns=["consultor", "ean", "produto", "tipo_mix", "molecula", "quantidade_vendida", "valor_vendido", "pedidos", "clientes"]
        )

    agreg = (
        base.groupby(["consultor", "ean_limpo"], dropna=False)
        .agg(
            quantidade_vendida=("quantidade_base", "sum"),
            valor_vendido=("valor_vendido_sem_imposto", "sum"),
            pedidos=("pedido_id", "nunique"),
            clientes=("cnpj_limpo", "nunique"),
        )
        .reset_index()
        .rename(columns={"ean_limpo": "ean"})
    )
    resultado = agreg.merge(produtos, on="ean", how="left")
    for coluna in ["quantidade_vendida", "valor_vendido", "pedidos", "clientes"]:
        resultado[coluna] = pd.to_numeric(resultado.get(coluna, 0), errors="coerce").fillna(0)
    return resultado[["consultor", "ean", "produto", "tipo_mix", "molecula", "quantidade_vendida", "valor_vendido", "pedidos", "clientes"]]


def _consultores_base(clientes: pd.DataFrame, vendas: pd.DataFrame) -> pd.DataFrame:
    if clientes is not None and not clientes.empty and "nome_rep" in clientes.columns:
        base = clientes[["nome_rep", "setor_rep"] if "setor_rep" in clientes.columns else ["nome_rep"]].copy()
        base = base.rename(columns={"nome_rep": "consultor"})
        if "setor_rep" not in base.columns:
            base["setor_rep"] = ""
    elif vendas is not None and not vendas.empty and "consultor" in vendas.columns:
        base = vendas[["consultor"]].copy()
        base["setor_rep"] = ""
    else:
        return pd.DataFrame(columns=["consultor", "setor_rep", "setor"])

    base["consultor"] = base["consultor"].fillna("").astype(str).str.strip()
    base["setor_rep"] = base["setor_rep"].fillna("").astype(str).str.strip()
    base = base[base["consultor"].ne("")].drop_duplicates(["consultor", "setor_rep"]).copy()
    base["setor"] = base.apply(
        lambda linha: f"{linha['setor_rep']} - {linha['consultor']}" if linha["setor_rep"] else linha["consultor"],
        axis=1,
    )
    return base.sort_values(["setor_rep", "consultor"]).reset_index(drop=True)


def _objetivo_molecula(acao: dict, molecula: str) -> float:
    objetivos = acao.get("objetivos_molecula", {})
    if isinstance(objetivos, dict):
        if molecula in objetivos:
            return float(objetivos.get(molecula, 0) or 0)
        abreviada = abreviar_molecula(molecula)
        if abreviada in objetivos:
            return float(objetivos.get(abreviada, 0) or 0)
    return float(acao.get("objetivo_padrao", 12) or 12)


def _tabela_consultor_molecula(acao: dict, resultado: pd.DataFrame, produtos: pd.DataFrame, clientes: pd.DataFrame, vendas: pd.DataFrame) -> pd.DataFrame:
    familias = produtos["molecula"].dropna().astype(str).drop_duplicates().tolist()
    consultores = _consultores_base(clientes, vendas)
    if consultores.empty and not resultado.empty:
        consultores = _consultores_base(pd.DataFrame(), resultado.rename(columns={"consultor": "consultor"}))

    if not resultado.empty:
        agrupado = (
            resultado.groupby(["consultor", "molecula"], dropna=False)
            .agg(quantidade=("quantidade_vendida", "sum"), valor=("valor_vendido", "sum"))
            .reset_index()
        )
    else:
        agrupado = pd.DataFrame(columns=["consultor", "molecula", "quantidade", "valor"])

    linhas = []
    for _, consultor in consultores.iterrows():
        nome = str(consultor["consultor"])
        linha = {"SETOR": str(consultor["setor"])}
        for familia in familias:
            resumo = agrupado[agrupado["consultor"].astype(str).eq(nome) & agrupado["molecula"].astype(str).eq(familia)]
            quantidade = float(resumo["quantidade"].sum()) if not resumo.empty else 0.0
            abrev = abreviar_molecula(familia)
            linha[f"{abrev} OBJ."] = int(round(_objetivo_molecula(acao, familia)))
            linha[f"{abrev} ATEND."] = int(round(quantidade))
        linhas.append(linha)
    return pd.DataFrame(linhas)


def _detalhe_formatado(resultado: pd.DataFrame) -> pd.DataFrame:
    if resultado.empty:
        return pd.DataFrame(columns=["Consultor", "Molécula", "EAN", "Produto", "Tipo mix", "Quantidade vendida", "Valor vendido", "Pedidos", "Clientes"])
    tabela = resultado.copy()
    tabela = tabela.sort_values(["consultor", "molecula", "produto"]).reset_index(drop=True)
    tabela["valor_vendido"] = tabela["valor_vendido"].apply(formatar_moeda)
    tabela["quantidade_vendida"] = tabela["quantidade_vendida"].map(lambda valor: f"{float(valor):,.0f}".replace(",", "."))
    tabela["pedidos"] = tabela["pedidos"].astype(int)
    tabela["clientes"] = tabela["clientes"].astype(int)
    return tabela.rename(
        columns={
            "consultor": "Consultor",
            "molecula": "Molécula",
            "ean": "EAN",
            "produto": "Produto",
            "tipo_mix": "Tipo mix",
            "quantidade_vendida": "Quantidade vendida",
            "valor_vendido": "Valor vendido",
            "pedidos": "Pedidos",
            "clientes": "Clientes",
        }
    )[["Consultor", "Molécula", "EAN", "Produto", "Tipo mix", "Quantidade vendida", "Valor vendido", "Pedidos", "Clientes"]]


def _montar_eans_preview(selecionados: list[str], eans_manuais: str, catalogo: pd.DataFrame) -> list[str]:
    mapa_label = dict(zip(catalogo["label"], catalogo["ean_limpo"], strict=False))
    eans = [mapa_label[label] for label in selecionados if label in mapa_label]
    eans.extend(normalizar_ean(linha) for linha in eans_manuais.replace(",", "\n").splitlines())
    return [ean for ean in dict.fromkeys(eans) if ean]


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]
produtos_mix = dados["produtos_mix"]
catalogo = _catalogo_produtos(produtos_mix, vendas)
foco = carregar_foco_semanal()
acoes = foco.get("acoes", [])

titulo_pagina("Foco Semanal", "Produtos da ação agrupados por molécula, consultor e período cadastrado.")

with st.expander("Cadastrar nova ação", expanded=not bool(acoes)):
    nome = st.text_input("Nome da ação", placeholder="Ex.: Foco semanal 12 a 14 de MAIO")
    hoje = hoje_brasilia()
    c1, c2 = st.columns(2)
    data_inicio = c1.date_input("Data inicial", value=hoje, format="DD/MM/YYYY")
    data_fim = c2.date_input("Data final", value=hoje, format="DD/MM/YYYY")

    opcoes = catalogo["label"].tolist()
    selecionados = st.multiselect("Produtos da ação", opcoes)
    eans_manuais = st.text_area("EANs adicionais, se precisar", placeholder="Um EAN por linha")
    eans_preview = _montar_eans_preview(selecionados, eans_manuais, catalogo)
    mapa_produtos = _produto_por_ean(catalogo)
    familias_preview = []
    for ean in eans_preview:
        info = mapa_produtos.get(ean, {})
        familias_preview.append(info.get("molecula") or identificar_molecula(info.get("produto", "")))
    familias_preview = sorted({familia for familia in familias_preview if familia})

    objetivos_molecula = {}
    objetivo_padrao = 12
    if familias_preview:
        st.caption("Objetivo por consultor para cada molécula")
        cols_obj = st.columns(min(3, len(familias_preview)))
        for idx, familia in enumerate(familias_preview):
            with cols_obj[idx % len(cols_obj)]:
                objetivos_molecula[familia] = st.number_input(
                    f"{abreviar_molecula(familia)} OBJ.",
                    min_value=0,
                    step=1,
                    value=12,
                    key=f"foco_obj_{slug_coluna(familia)}",
                )
    else:
        objetivo_padrao = st.number_input("Objetivo padrão por consultor/molécula", min_value=0, step=1, value=12)

    if st.button("Salvar foco semanal", width="stretch"):
        eans = _montar_eans_preview(selecionados, eans_manuais, catalogo)
        if not eans:
            st.warning("Escolha pelo menos um produto ou informe um EAN.")
        elif data_fim < data_inicio:
            st.warning("A data final precisa ser igual ou posterior à data inicial.")
        else:
            produtos = []
            for ean in eans:
                info = mapa_produtos.get(ean, {})
                produto = info.get("produto", "")
                molecula = info.get("molecula") or identificar_molecula(produto)
                produtos.append(
                    {
                        "ean": ean,
                        "produto": produto,
                        "tipo_mix": info.get("tipo_mix", ""),
                        "molecula": molecula,
                    }
                )
            acoes.append(
                {
                    "id": str(uuid4()),
                    "nome": nome.strip() or "Foco semanal",
                    "data_inicio": data_inicio.isoformat(),
                    "data_fim": data_fim.isoformat(),
                    "objetivo_padrao": objetivo_padrao,
                    "objetivos_molecula": objetivos_molecula,
                    "produtos": produtos,
                }
            )
            foco["acoes"] = acoes
            salvar_foco_semanal(foco)
            st.success("Foco semanal salvo.")
            st.rerun()

if acoes:
    opcoes_excluir = {
        f"{acao.get('nome', 'Foco semanal')} - {formatar_data_brasil(acao.get('data_inicio'))} até {formatar_data_brasil(acao.get('data_fim'))}": acao
        for acao in acoes
    }
    c1, c2 = st.columns([2, 1])
    escolhido = c1.selectbox("Excluir ação cadastrada", list(opcoes_excluir.keys()))
    if c2.button("Excluir ação", width="stretch"):
        remover_id = opcoes_excluir[escolhido].get("id")
        foco["acoes"] = [acao for acao in acoes if acao.get("id") != remover_id]
        salvar_foco_semanal(foco)
        st.success("Ação excluída.")
        st.rerun()

st.subheader("Resultado das ações")
if not acoes:
    st.info("Nenhum foco semanal cadastrado.")

for acao in acoes:
    inicio, fim = _periodo_acao(acao)
    produtos_acao = _produtos_da_acao(acao, catalogo)
    resultado = _resultado_detalhado_acao(acao, vendas, catalogo)
    total_qtd = float(resultado["quantidade_vendida"].sum()) if not resultado.empty else 0
    total_valor = float(resultado["valor_vendido"].sum()) if not resultado.empty else 0
    moleculas = int(produtos_acao["molecula"].nunique()) if not produtos_acao.empty else 0

    st.markdown('<div class="consultor-card">', unsafe_allow_html=True)
    st.markdown(f"<div class='consultor-name'>{acao.get('nome', 'Foco semanal')}</div>", unsafe_allow_html=True)
    st.caption(f"Período: {inicio.strftime('%d/%m/%Y')} até {fim.strftime('%d/%m/%Y')}")

    m1, m2, m3 = st.columns(3)
    with m1:
        card_metrica("Quantidade vendida", f"{total_qtd:,.0f}".replace(",", "."))
    with m2:
        card_metrica("Valor vendido", formatar_moeda(total_valor))
    with m3:
        card_metrica("Moléculas na ação", str(moleculas))

    st.markdown("#### Resultado por consultor e molécula")
    tabela_consultor = _tabela_consultor_molecula(acao, resultado, produtos_acao, clientes, vendas)
    if tabela_consultor.empty:
        st.info("Nenhum consultor encontrado para montar a visão da ação.")
    else:
        st.dataframe(tabela_consultor, width="stretch", height=min(420, 74 + 36 * len(tabela_consultor)))
        botao_download_excel(tabela_consultor, f"foco_semanal_consultores_{acao.get('id', 'acao')}.xlsx", "Baixar resultado por consultor")

    with st.expander("Detalhe por produto", expanded=False):
        detalhe = _detalhe_formatado(resultado)
        if detalhe.empty:
            st.info("Nenhum produto vendido nesta ação e período.")
        else:
            dataframe_com_download(detalhe, f"foco_semanal_produtos_{acao.get('id', 'acao')}", altura=330)
    st.markdown("</div>", unsafe_allow_html=True)
