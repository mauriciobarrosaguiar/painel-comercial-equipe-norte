from __future__ import annotations

from datetime import date
from html import escape
from uuid import uuid4

import numpy as np
import pandas as pd
import streamlit as st

from src.datas import formatar_data_brasil, hoje_brasilia
from src.foco_semanal import abreviar_molecula, carregar_foco_semanal, identificar_molecula, salvar_foco_semanal
from src.layout import botao_download_excel, card_metrica, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.tratamento import STATUS_CANCELADO, formatar_moeda, formatar_percentual, normalizar_ean


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


def _numero(valor: object, padrao: float = 0.0) -> float:
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return padrao
    if not np.isfinite(numero):
        return padrao
    return numero


def _numero_inteiro(valor: object) -> str:
    numero = _numero(valor)
    return f"{int(round(numero)):,}".replace(",", ".")


def _tipo_meta_unidades(acao: dict) -> str:
    tipo = str(acao.get("tipo_meta_unidades", "") or "").upper()
    if tipo in {"POR_PRODUTO", "CADA", "INDIVIDUAL"}:
        return "POR_PRODUTO"
    return "SOMANDO"


def _escopo_meta(acao: dict) -> str:
    escopo = str(acao.get("escopo_meta", "") or "").upper()
    return "POR_CONSULTOR" if escopo == "POR_CONSULTOR" else "PADRAO"


def _meta_unidades_padrao(acao: dict) -> float:
    if "meta_unidades_padrao" in acao:
        return _numero(acao.get("meta_unidades_padrao"), 0)
    return _numero(acao.get("objetivo_padrao", 12), 12)


def _meta_cnpjs_padrao(acao: dict) -> float:
    return _numero(acao.get("meta_cnpjs_padrao", 12), 12)


def _parse_metas_produtos(valor: object) -> list[dict[str, object]]:
    if valor is None:
        return []
    if isinstance(valor, float) and pd.isna(valor):
        return []

    itens_brutos: list[object] = []
    if isinstance(valor, list):
        itens_brutos = valor
    elif isinstance(valor, dict):
        itens_brutos = [
            {"ean": ean, **meta} if isinstance(meta, dict) else {"ean": ean, "meta_unidades": meta}
            for ean, meta in valor.items()
        ]

    metas: list[dict[str, object]] = []
    vistos: set[str] = set()
    for item in itens_brutos:
        if not isinstance(item, dict):
            continue
        ean = normalizar_ean(item.get("ean") or item.get("ean_limpo") or "")
        if not ean or ean in vistos:
            continue
        vistos.add(ean)
        metas.append(
            {
                "ean": ean,
                "produto": str(item.get("produto", "") or "").strip(),
                "meta_unidades": _numero(item.get("meta_unidades", 0), 0),
            }
        )
    return metas


def _metas_produtos_por_ean(metas_produtos: object) -> dict[str, float]:
    return {
        str(item["ean"]): _numero(item.get("meta_unidades", 0), 0)
        for item in _parse_metas_produtos(metas_produtos)
        if str(item.get("ean", "") or "").strip()
    }


def _produtos_meta_editor(eans: list[str], mapa_produtos: dict[str, dict[str, str]]) -> list[dict[str, str]]:
    produtos: list[dict[str, str]] = []
    for ean in eans:
        ean_limpo = normalizar_ean(ean)
        if not ean_limpo:
            continue
        info = mapa_produtos.get(ean_limpo, {})
        produtos.append(
            {
                "ean": ean_limpo,
                "produto": str(info.get("produto", "") or "").strip(),
            }
        )
    return produtos


def _coluna_meta_produto(item: dict[str, str]) -> str:
    return f"meta_produto__{normalizar_ean(item.get('ean', ''))}"


def _label_meta_produto(item: dict[str, str]) -> str:
    produto = str(item.get("produto", "") or "").strip()
    return produto or f"EAN {normalizar_ean(item.get('ean', ''))}"


def _resumo_metas_produtos(produtos: pd.DataFrame, metas_produtos: object) -> str:
    metas = _metas_produtos_por_ean(metas_produtos)
    if not metas:
        return ""

    nomes: dict[str, str] = {}
    if {"ean", "produto"}.issubset(produtos.columns):
        for _, linha in produtos[["ean", "produto"]].drop_duplicates("ean").iterrows():
            ean = normalizar_ean(linha.get("ean", ""))
            produto = str(linha.get("produto", "") or "").strip()
            if ean and produto:
                nomes[ean] = produto

    partes = []
    for ean in produtos.get("ean", pd.Series(dtype=str)).astype(str):
        meta = metas.get(ean)
        if meta is None:
            continue
        partes.append(f"{nomes.get(ean, ean)}: {_numero_inteiro(meta)}")
    if len(partes) > 4:
        return "; ".join(partes[:4]) + f" +{len(partes) - 4}"
    return "; ".join(partes)


def _metas_consultores_salvas(acao: dict) -> dict[str, dict[str, object]]:
    metas = acao.get("metas_consultores", [])
    itens: list[dict] = []
    if isinstance(metas, dict):
        for consultor, meta in metas.items():
            if isinstance(meta, dict):
                item = dict(meta)
            else:
                item = {"meta_unidades": meta}
            item["consultor"] = consultor
            itens.append(item)
    elif isinstance(metas, list):
        itens = [item for item in metas if isinstance(item, dict)]

    saida: dict[str, dict[str, object]] = {}
    for item in itens:
        consultor = str(item.get("consultor", "") or "").strip()
        if not consultor or not bool(item.get("ativo", True)):
            continue
        saida[consultor] = {
            "meta_unidades": _numero(item.get("meta_unidades", _meta_unidades_padrao(acao)), 0),
            "meta_cnpjs": _numero(item.get("meta_cnpjs", _meta_cnpjs_padrao(acao)), 0),
            "metas_produtos": _parse_metas_produtos(item.get("metas_produtos", [])),
        }
    return saida


def _usa_metas_produtos_por_consultor(acao: dict) -> bool:
    if _tipo_meta_unidades(acao) != "POR_PRODUTO" or _escopo_meta(acao) != "POR_CONSULTOR":
        return False
    return any(meta.get("metas_produtos") for meta in _metas_consultores_salvas(acao).values())


def _colunas_tabela_meta_consultores(acao: dict) -> list[str]:
    colunas = ["SETOR", "CONSULTOR"]
    if not _usa_metas_produtos_por_consultor(acao):
        colunas.append("META QTD")
    colunas.extend(
        [
            "METAS POR PRODUTO",
            "QTD VENDIDA",
            "QTD BASE META",
            "FALTA QTD",
            "PRODUTOS BATIDOS",
            "META CNPJ",
            "CNPJS POSITIVADOS",
            "FALTA CNPJ",
            "ATING. QTD",
            "ATING. CNPJ",
            "ATING. GERAL",
            "STATUS",
        ]
    )
    return colunas


def _metas_consultores_dataframe(
    consultores: pd.DataFrame,
    meta_unidades: float,
    meta_cnpjs: float,
    produtos_meta: list[dict[str, str]] | None = None,
) -> pd.DataFrame:
    nomes = consultores["consultor"].dropna().astype(str).str.strip().drop_duplicates().tolist() if not consultores.empty else []
    dados: dict[str, object] = {
        "ativo": [True] * len(nomes),
        "consultor": nomes,
    }
    produtos_meta = produtos_meta or []
    if produtos_meta:
        for item in produtos_meta:
            dados[_coluna_meta_produto(item)] = [float(meta_unidades)] * len(nomes)
    else:
        dados["meta_unidades"] = [float(meta_unidades)] * len(nomes)
    dados["meta_cnpjs"] = [float(meta_cnpjs)] * len(nomes)
    return pd.DataFrame(dados)


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


def _vendas_da_acao(acao: dict, vendas: pd.DataFrame, produtos: pd.DataFrame) -> pd.DataFrame:
    colunas = [
        "consultor",
        "ean_limpo",
        "quantidade_base",
        "valor_vendido_sem_imposto",
        "pedido_id",
        "cnpj_limpo",
        "data_base",
        "status_normalizado",
    ]
    if produtos.empty or vendas is None or vendas.empty:
        return pd.DataFrame(columns=colunas)

    inicio, fim = _periodo_acao(acao)
    base = vendas.copy()
    for coluna in colunas:
        if coluna not in base.columns:
            base[coluna] = 0 if coluna in {"quantidade_base", "valor_vendido_sem_imposto"} else ""
    base["data_base"] = pd.to_datetime(base["data_base"], errors="coerce")
    base = base[
        base["ean_limpo"].astype(str).isin(set(produtos["ean"]))
        & base["data_base"].dt.date.ge(inicio)
        & base["data_base"].dt.date.le(fim)
        & base["status_normalizado"].ne(STATUS_CANCELADO)
    ].copy()
    return base


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

    base = _vendas_da_acao(acao, vendas, produtos)
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


def _metricas_unidades_consultor(
    vendas_consultor: pd.DataFrame,
    produtos: pd.DataFrame,
    meta_unidades: float,
    tipo_meta: str,
    metas_produtos: object | None = None,
) -> dict[str, object]:
    quantidade_total = float(vendas_consultor["quantidade_base"].sum()) if not vendas_consultor.empty else 0.0
    metas_por_ean = _metas_produtos_por_ean(metas_produtos)
    tem_meta_produtos = any(meta > 0 for meta in metas_por_ean.values())
    if meta_unidades <= 0 and not tem_meta_produtos:
        return {
            "quantidade_meta_base": quantidade_total,
            "quantidade_vendida": quantidade_total,
            "falta_unidades": 0.0,
            "atingimento_unidades": 0.0,
            "produtos_batidos": 0,
            "produtos_meta": int(len(produtos.index)),
            "unidades_ok": True,
        }

    if tipo_meta == "POR_PRODUTO" and not produtos.empty:
        por_ean = vendas_consultor.groupby("ean_limpo")["quantidade_base"].sum() if not vendas_consultor.empty else pd.Series(dtype=float)
        alvos = []
        for ean in produtos["ean"].astype(str):
            meta_ean = metas_por_ean.get(ean, meta_unidades)
            if meta_ean <= 0:
                continue
            alvos.append((float(por_ean.get(ean, 0) or 0), meta_ean))
        if not alvos:
            return {
                "quantidade_meta_base": quantidade_total,
                "quantidade_vendida": quantidade_total,
                "falta_unidades": 0.0,
                "atingimento_unidades": 0.0,
                "produtos_batidos": 0,
                "produtos_meta": 0,
                "unidades_ok": True,
            }
        produtos_batidos = sum(1 for quantidade, meta_ean in alvos if quantidade >= meta_ean)
        falta = sum(max(meta_ean - quantidade, 0) for quantidade, meta_ean in alvos)
        atingimento = min((quantidade / meta_ean for quantidade, meta_ean in alvos), default=0.0)
        return {
            "quantidade_meta_base": min((quantidade for quantidade, _ in alvos), default=0.0),
            "quantidade_vendida": quantidade_total,
            "falta_unidades": float(falta),
            "atingimento_unidades": float(atingimento),
            "produtos_batidos": int(produtos_batidos),
            "produtos_meta": int(len(alvos)),
            "unidades_ok": produtos_batidos == len(alvos),
        }

    return {
        "quantidade_meta_base": quantidade_total,
        "quantidade_vendida": quantidade_total,
        "falta_unidades": float(max(meta_unidades - quantidade_total, 0)),
        "atingimento_unidades": float(quantidade_total / meta_unidades),
        "produtos_batidos": int(quantidade_total >= meta_unidades),
        "produtos_meta": 1,
        "unidades_ok": quantidade_total >= meta_unidades,
    }


def _tabela_meta_consultores(acao: dict, vendas_filtradas: pd.DataFrame, produtos: pd.DataFrame, clientes: pd.DataFrame, vendas: pd.DataFrame) -> pd.DataFrame:
    colunas_saida = _colunas_tabela_meta_consultores(acao)
    ocultar_meta_qtd = _usa_metas_produtos_por_consultor(acao)
    consultores = _consultores_base(clientes, vendas)
    if consultores.empty and not vendas_filtradas.empty:
        consultores = _consultores_base(pd.DataFrame(), vendas_filtradas)
    if consultores.empty:
        return pd.DataFrame(columns=colunas_saida)

    tipo_meta = _tipo_meta_unidades(acao)
    metas_individuais = _metas_consultores_salvas(acao)
    meta_unidades_padrao = _meta_unidades_padrao(acao)
    meta_cnpjs_padrao = _meta_cnpjs_padrao(acao)
    usar_individual = _escopo_meta(acao) == "POR_CONSULTOR"
    linhas = []
    for _, consultor in consultores.iterrows():
        nome = str(consultor["consultor"])
        if usar_individual and nome not in metas_individuais:
            continue
        metas = metas_individuais.get(nome, {})
        meta_unidades = _numero(metas.get("meta_unidades", meta_unidades_padrao), 0)
        meta_cnpjs = _numero(metas.get("meta_cnpjs", meta_cnpjs_padrao), 0)
        metas_produtos = metas.get("metas_produtos", [])
        vendas_consultor = vendas_filtradas[vendas_filtradas["consultor"].astype(str).eq(nome)].copy() if not vendas_filtradas.empty else pd.DataFrame()
        comprou = vendas_consultor[
            (pd.to_numeric(vendas_consultor.get("quantidade_base", 0), errors="coerce").fillna(0) > 0)
            | (pd.to_numeric(vendas_consultor.get("valor_vendido_sem_imposto", 0), errors="coerce").fillna(0) > 0)
        ].copy() if not vendas_consultor.empty else pd.DataFrame()
        cnpjs = int(comprou["cnpj_limpo"].nunique()) if not comprou.empty and "cnpj_limpo" in comprou.columns else 0
        unidades = _metricas_unidades_consultor(vendas_consultor, produtos, meta_unidades, tipo_meta, metas_produtos)
        falta_cnpjs = int(max(meta_cnpjs - cnpjs, 0)) if meta_cnpjs > 0 else 0
        ating_cnpjs = (cnpjs / meta_cnpjs) if meta_cnpjs > 0 else 0.0
        cnpjs_ok = cnpjs >= meta_cnpjs if meta_cnpjs > 0 else True
        atingimentos = []
        meta_unidades_ativa = meta_unidades > 0 or (tipo_meta == "POR_PRODUTO" and int(unidades.get("produtos_meta", 0) or 0) > 0)
        if meta_unidades_ativa:
            atingimentos.append(float(unidades["atingimento_unidades"]))
        if meta_cnpjs > 0:
            atingimentos.append(float(ating_cnpjs))
        ating_geral = min(atingimentos) if atingimentos else 0.0
        status = "BATIDA" if bool(unidades["unidades_ok"]) and cnpjs_ok and atingimentos else "EM ANDAMENTO"
        linha = {
            "SETOR": str(consultor["setor"]),
            "CONSULTOR": nome,
            "METAS POR PRODUTO": _resumo_metas_produtos(produtos, metas_produtos),
            "QTD VENDIDA": int(round(float(unidades["quantidade_vendida"]))),
            "QTD BASE META": int(round(float(unidades["quantidade_meta_base"]))),
            "FALTA QTD": int(round(float(unidades["falta_unidades"]))),
            "PRODUTOS BATIDOS": f"{int(unidades.get('produtos_batidos', 0) or 0)}/{int(unidades.get('produtos_meta', 0) or 0)}",
            "META CNPJ": int(round(meta_cnpjs)),
            "CNPJS POSITIVADOS": cnpjs,
            "FALTA CNPJ": falta_cnpjs,
            "ATING. QTD": formatar_percentual(unidades["atingimento_unidades"]),
            "ATING. CNPJ": formatar_percentual(ating_cnpjs),
            "ATING. GERAL": formatar_percentual(ating_geral),
            "STATUS": status,
        }
        if not ocultar_meta_qtd:
            linha["META QTD"] = int(round(meta_unidades))
        linhas.append(linha)
    return pd.DataFrame(linhas, columns=colunas_saida)


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
    produtos_meta_preview = _produtos_meta_editor(eans_preview, mapa_produtos)
    familias_preview = []
    for ean in eans_preview:
        info = mapa_produtos.get(ean, {})
        familias_preview.append(info.get("molecula") or identificar_molecula(info.get("produto", "")))
    familias_preview = sorted({familia for familia in familias_preview if familia})

    meta1, meta2, meta3 = st.columns([1, 1, 1.25])
    meta_unidades_padrao = meta1.number_input("Meta mínima de unidades", min_value=0, step=1, value=12)
    meta_cnpjs_padrao = meta2.number_input("Meta mínima de PDV/CNPJ positivado", min_value=0, step=1, value=12)
    modo_unidades = meta3.radio(
        "Como contar unidades",
        ["Somando os produtos", "Meta em cada produto"],
        horizontal=True,
    )
    tipo_meta_unidades = "POR_PRODUTO" if modo_unidades == "Meta em cada produto" else "SOMANDO"

    escopo_label = st.radio(
        "Aplicação da meta",
        ["Meta padrão para todos os consultores", "Meta separada por consultor"],
        horizontal=True,
    )
    escopo_meta = "POR_CONSULTOR" if escopo_label == "Meta separada por consultor" else "PADRAO"
    metas_consultores = []
    if escopo_meta == "POR_CONSULTOR":
        consultores_edicao = _consultores_base(clientes, vendas)
        usar_metas_produtos = tipo_meta_unidades == "POR_PRODUTO" and bool(produtos_meta_preview)
        metas_base = _metas_consultores_dataframe(
            consultores_edicao,
            meta_unidades_padrao,
            meta_cnpjs_padrao,
            produtos_meta_preview if usar_metas_produtos else [],
        )
        column_config = {
            "ativo": st.column_config.CheckboxColumn("Usar", default=True),
            "consultor": st.column_config.TextColumn("Consultor"),
        }
        if usar_metas_produtos:
            for item in produtos_meta_preview:
                column_config[_coluna_meta_produto(item)] = st.column_config.NumberColumn(
                    f"Meta (Un.) {_label_meta_produto(item)}",
                    min_value=0,
                    step=1,
                )
        else:
            column_config["meta_unidades"] = st.column_config.NumberColumn("Meta unidades", min_value=0, step=1)
        column_config["meta_cnpjs"] = st.column_config.NumberColumn("Meta CNPJs", min_value=0, step=1)
        metas_editadas = st.data_editor(
            metas_base,
            use_container_width=True,
            hide_index=True,
            disabled=["consultor"],
            column_config=column_config,
            key=f"foco_metas_consultores_{tipo_meta_unidades}_{'_'.join(eans_preview)}",
        )
        for _, linha in metas_editadas.iterrows():
            consultor = str(linha.get("consultor", "") or "").strip()
            if not bool(linha.get("ativo", True)) or not consultor:
                continue
            meta_unidades_linha = _numero(linha.get("meta_unidades", meta_unidades_padrao), 0)
            item_meta = {
                "consultor": consultor,
                "ativo": True,
                "meta_unidades": meta_unidades_linha,
                "meta_cnpjs": _numero(linha.get("meta_cnpjs", meta_cnpjs_padrao), 0),
            }
            if usar_metas_produtos:
                item_meta["metas_produtos"] = [
                    {
                        "ean": normalizar_ean(produto.get("ean", "")),
                        "produto": str(produto.get("produto", "") or "").strip(),
                        "meta_unidades": _numero(linha.get(_coluna_meta_produto(produto), meta_unidades_linha), 0),
                    }
                    for produto in produtos_meta_preview
                    if normalizar_ean(produto.get("ean", ""))
                ]
            metas_consultores.append(item_meta)

    objetivo_padrao = int(meta_unidades_padrao)
    objetivos_molecula = {familia: int(meta_unidades_padrao) for familia in familias_preview}

    if st.button("Salvar foco semanal", use_container_width=True):
        eans = _montar_eans_preview(selecionados, eans_manuais, catalogo)
        if not eans:
            st.warning("Escolha pelo menos um produto ou informe um EAN.")
        elif data_fim < data_inicio:
            st.warning("A data final precisa ser igual ou posterior à data inicial.")
        elif escopo_meta == "POR_CONSULTOR" and not metas_consultores:
            st.warning("Marque pelo menos um consultor para a meta separada.")
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
                    "meta_unidades_padrao": int(meta_unidades_padrao),
                    "meta_cnpjs_padrao": int(meta_cnpjs_padrao),
                    "tipo_meta_unidades": tipo_meta_unidades,
                    "escopo_meta": escopo_meta,
                    "metas_consultores": metas_consultores,
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
    if c2.button("Excluir ação", use_container_width=True):
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
    vendas_acao = _vendas_da_acao(acao, vendas, produtos_acao)
    resultado = _resultado_detalhado_acao(acao, vendas, catalogo)
    total_qtd = float(resultado["quantidade_vendida"].sum()) if not resultado.empty else 0
    total_valor = float(resultado["valor_vendido"].sum()) if not resultado.empty else 0
    total_cnpjs = int(vendas_acao["cnpj_limpo"].nunique()) if not vendas_acao.empty and "cnpj_limpo" in vendas_acao.columns else 0
    moleculas = int(produtos_acao["molecula"].nunique()) if not produtos_acao.empty else 0

    st.markdown('<div class="consultor-card">', unsafe_allow_html=True)
    st.markdown(f"<div class='consultor-name'>{escape(str(acao.get('nome', 'Foco semanal')))}</div>", unsafe_allow_html=True)
    if _usa_metas_produtos_por_consultor(acao):
        texto_meta = "Meta: unidades por produto e consultor"
    else:
        texto_meta = (
            f"Meta: {_numero_inteiro(_meta_unidades_padrao(acao))} unidades "
            f"({'por produto' if _tipo_meta_unidades(acao) == 'POR_PRODUTO' else 'somando produtos'})"
        )
    st.caption(
        f"Período: {inicio.strftime('%d/%m/%Y')} até {fim.strftime('%d/%m/%Y')} | "
        f"{texto_meta} | CNPJs: {_numero_inteiro(_meta_cnpjs_padrao(acao))}"
    )

    m1, m2, m3, m4 = st.columns(4)
    with m1:
        card_metrica("Quantidade vendida", f"{total_qtd:,.0f}".replace(",", "."))
    with m2:
        card_metrica("Valor vendido", formatar_moeda(total_valor))
    with m3:
        card_metrica("CNPJs positivados", str(total_cnpjs))
    with m4:
        card_metrica("Moléculas na ação", str(moleculas))

    st.markdown("#### Resultado por consultor")
    tabela_metas = _tabela_meta_consultores(acao, vendas_acao, produtos_acao, clientes, vendas)
    if tabela_metas.empty:
        st.info("Nenhum consultor encontrado para montar a visão da ação.")
    else:
        st.dataframe(tabela_metas, use_container_width=True, height=min(420, 74 + 36 * len(tabela_metas)))
        botao_download_excel(tabela_metas, f"foco_semanal_consultores_{acao.get('id', 'acao')}.xlsx", "Baixar resultado por consultor")

    with st.expander("Resultado por consultor e molécula", expanded=False):
        tabela_consultor = _tabela_consultor_molecula(acao, resultado, produtos_acao, clientes, vendas)
        if tabela_consultor.empty:
            st.info("Nenhum consultor encontrado para montar a visão por molécula.")
        else:
            st.dataframe(tabela_consultor, use_container_width=True, height=min(420, 74 + 36 * len(tabela_consultor)))

    with st.expander("Detalhe por produto", expanded=False):
        detalhe = _detalhe_formatado(resultado)
        if detalhe.empty:
            st.info("Nenhum produto vendido nesta ação e período.")
        else:
            dataframe_com_download(detalhe, f"foco_semanal_produtos_{acao.get('id', 'acao')}", altura=330)
    st.markdown("</div>", unsafe_allow_html=True)
