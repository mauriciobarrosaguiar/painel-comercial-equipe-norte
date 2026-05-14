from __future__ import annotations

from datetime import date
from uuid import uuid4

import pandas as pd
import streamlit as st

from src.datas import formatar_data_brasil, hoje_brasilia
from src.foco_semanal import carregar_foco_semanal, salvar_foco_semanal
from src.layout import botao_download_excel, card_metrica, titulo_pagina
from src.loader import carregar_dados_tratados
from src.tratamento import STATUS_CANCELADO, formatar_moeda, normalizar_ean


def _catalogo_produtos(produtos_mix: pd.DataFrame, vendas: pd.DataFrame) -> pd.DataFrame:
    if produtos_mix is not None and not produtos_mix.empty:
        base = produtos_mix[["ean_limpo", "produto", "tipo_mix"]].copy()
    elif vendas is not None and not vendas.empty:
        base = vendas[["ean_limpo", "produto", "tipo_mix"]].copy()
    else:
        return pd.DataFrame(columns=["ean_limpo", "produto", "tipo_mix", "label"])

    base["ean_limpo"] = base["ean_limpo"].fillna("").astype(str).apply(normalizar_ean)
    base["produto"] = base["produto"].fillna("").astype(str).str.strip()
    base["tipo_mix"] = base.get("tipo_mix", "").fillna("").astype(str).str.strip()
    base = base[base["ean_limpo"].ne("")].drop_duplicates("ean_limpo", keep="first").copy()
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


def _resultado_acao(acao: dict, vendas: pd.DataFrame, catalogo: pd.DataFrame) -> pd.DataFrame:
    produtos = pd.DataFrame(acao.get("produtos", []))
    if produtos.empty:
        return pd.DataFrame(columns=["ean", "produto", "tipo_mix", "quantidade_vendida", "valor_vendido", "pedidos", "clientes"])

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

    if vendas is None or vendas.empty:
        agreg = pd.DataFrame(columns=["ean", "quantidade_vendida", "valor_vendido", "pedidos", "clientes"])
    else:
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
            agreg = pd.DataFrame(columns=["ean", "quantidade_vendida", "valor_vendido", "pedidos", "clientes"])
        else:
            agreg = (
                base.groupby("ean_limpo", dropna=False)
                .agg(
                    quantidade_vendida=("quantidade_base", "sum"),
                    valor_vendido=("valor_vendido_sem_imposto", "sum"),
                    pedidos=("pedido_id", "nunique"),
                    clientes=("cnpj_limpo", "nunique"),
                )
                .reset_index()
                .rename(columns={"ean_limpo": "ean"})
            )

    resultado = produtos.merge(agreg, on="ean", how="left")
    for coluna in ["quantidade_vendida", "valor_vendido", "pedidos", "clientes"]:
        resultado[coluna] = pd.to_numeric(resultado.get(coluna, 0), errors="coerce").fillna(0)
    return resultado[["ean", "produto", "tipo_mix", "quantidade_vendida", "valor_vendido", "pedidos", "clientes"]]


def _tabela_formatada(resultado: pd.DataFrame) -> pd.DataFrame:
    tabela = resultado.copy()
    tabela["valor_vendido"] = tabela["valor_vendido"].apply(formatar_moeda)
    tabela["quantidade_vendida"] = tabela["quantidade_vendida"].map(lambda valor: f"{float(valor):,.0f}".replace(",", "."))
    tabela["pedidos"] = tabela["pedidos"].astype(int)
    tabela["clientes"] = tabela["clientes"].astype(int)
    return tabela.rename(
        columns={
            "ean": "EAN",
            "produto": "Produto",
            "tipo_mix": "Tipo mix",
            "quantidade_vendida": "Quantidade vendida",
            "valor_vendido": "Valor vendido",
            "pedidos": "Pedidos",
            "clientes": "Clientes",
        }
    )


dados = carregar_dados_tratados()
vendas = dados["vendas"]
produtos_mix = dados["produtos_mix"]
catalogo = _catalogo_produtos(produtos_mix, vendas)
foco = carregar_foco_semanal()
acoes = foco.get("acoes", [])

titulo_pagina("Foco Semanal", "Produtos da ação e resultado vendido somente dentro do período cadastrado.")

with st.expander("Cadastrar nova ação", expanded=not bool(acoes)):
    nome = st.text_input("Nome da ação", placeholder="Ex.: Foco semanal Olmesartana 40mg")
    hoje = hoje_brasilia()
    c1, c2 = st.columns(2)
    data_inicio = c1.date_input("Data inicial", value=hoje, format="DD/MM/YYYY")
    data_fim = c2.date_input("Data final", value=hoje, format="DD/MM/YYYY")

    opcoes = catalogo["label"].tolist()
    selecionados = st.multiselect("Produtos da ação", opcoes)
    eans_manuais = st.text_area("EANs adicionais, se precisar", placeholder="Um EAN por linha")

    if st.button("Salvar foco semanal", width="stretch"):
        mapa_label = dict(zip(catalogo["label"], catalogo["ean_limpo"], strict=False))
        mapa_produtos = _produto_por_ean(catalogo)
        eans = [mapa_label[label] for label in selecionados if label in mapa_label]
        eans.extend(normalizar_ean(linha) for linha in eans_manuais.replace(",", "\n").splitlines())
        eans = [ean for ean in dict.fromkeys(eans) if ean]

        if not eans:
            st.warning("Escolha pelo menos um produto ou informe um EAN.")
        elif data_fim < data_inicio:
            st.warning("A data final precisa ser igual ou posterior à data inicial.")
        else:
            produtos = [
                {
                    "ean": ean,
                    "produto": mapa_produtos.get(ean, {}).get("produto", ""),
                    "tipo_mix": mapa_produtos.get(ean, {}).get("tipo_mix", ""),
                }
                for ean in eans
            ]
            acoes.append(
                {
                    "id": str(uuid4()),
                    "nome": nome.strip() or "Foco semanal",
                    "data_inicio": data_inicio.isoformat(),
                    "data_fim": data_fim.isoformat(),
                    "produtos": produtos,
                }
            )
            foco["acoes"] = acoes
            salvar_foco_semanal(foco)
            st.success("Foco semanal salvo.")
            st.rerun()

if acoes:
    opcoes_excluir = {f"{acao.get('nome', 'Foco semanal')} - {formatar_data_brasil(acao.get('data_inicio'))} até {formatar_data_brasil(acao.get('data_fim'))}": acao for acao in acoes}
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
    resultado = _resultado_acao(acao, vendas, catalogo)
    total_qtd = float(resultado["quantidade_vendida"].sum()) if not resultado.empty else 0
    total_valor = float(resultado["valor_vendido"].sum()) if not resultado.empty else 0
    vendidos = int((resultado["quantidade_vendida"] > 0).sum()) if not resultado.empty else 0

    st.markdown('<div class="consultor-card">', unsafe_allow_html=True)
    st.markdown(f"<div class='consultor-name'>{acao.get('nome', 'Foco semanal')}</div>", unsafe_allow_html=True)
    st.caption(f"Período: {inicio.strftime('%d/%m/%Y')} até {fim.strftime('%d/%m/%Y')}")

    m1, m2, m3 = st.columns(3)
    with m1:
        card_metrica("Quantidade vendida", f"{total_qtd:,.0f}".replace(",", "."))
    with m2:
        card_metrica("Valor vendido", formatar_moeda(total_valor))
    with m3:
        card_metrica("Produtos com venda", str(vendidos))

    tabela = _tabela_formatada(resultado)
    st.dataframe(tabela, width="stretch", height=260)
    botao_download_excel(tabela, f"foco_semanal_{acao.get('id', 'acao')}.xlsx", "Baixar resultado da ação")
    st.markdown("</div>", unsafe_allow_html=True)
