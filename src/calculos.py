from __future__ import annotations

import numpy as np
import pandas as pd

from src.tratamento import (
    STATUS_CANCELADO,
    STATUS_FATURADOS,
    TIPO_SEM_CLASSIFICACAO,
    formatar_data,
    formatar_moeda,
    formatar_percentual,
)


def _dividir(numerador: float, denominador: float) -> float:
    return float(numerador / denominador) if denominador else 0.0


def _vendas_validas(vendas: pd.DataFrame) -> pd.DataFrame:
    if vendas.empty:
        return vendas.copy()
    return vendas[vendas["status_normalizado"].isin(STATUS_FATURADOS)].copy()


def _metricas_vendas(vendas: pd.DataFrame) -> dict[str, float]:
    if vendas.empty:
        return {
            "ol_sem_combate": 0.0,
            "ol_prioritarios": 0.0,
            "percentual_prioritarios": 0.0,
            "ol_lancamentos": 0.0,
            "percentual_lancamentos": 0.0,
            "quantidade_pedidos": 0,
            "ticket_medio": 0.0,
        }
    validas = _vendas_validas(vendas)
    sem_combate = validas[validas["tipo_mix"].ne("COMBATE")]
    ol_sem_combate = float(sem_combate["valor_vendido_sem_imposto"].sum())
    ol_prioritarios = float(validas.loc[validas["tipo_mix"].eq("PRIORITARIO"), "valor_vendido_sem_imposto"].sum())
    ol_lancamentos = float(validas.loc[validas["tipo_mix"].eq("LANCAMENTO"), "valor_vendido_sem_imposto"].sum())
    pedidos = int(validas.loc[validas["valor_vendido_sem_imposto"].gt(0), "pedido_id"].nunique())
    return {
        "ol_sem_combate": ol_sem_combate,
        "ol_prioritarios": ol_prioritarios,
        "percentual_prioritarios": _dividir(ol_prioritarios, ol_sem_combate),
        "ol_lancamentos": ol_lancamentos,
        "percentual_lancamentos": _dividir(ol_lancamentos, ol_sem_combate),
        "quantidade_pedidos": pedidos,
        "ticket_medio": _dividir(ol_sem_combate, pedidos),
    }


def calcular_indicadores(vendas: pd.DataFrame, clientes: pd.DataFrame | None = None) -> dict[str, float]:
    metricas = _metricas_vendas(vendas)
    validas = _vendas_validas(vendas)
    ol_cliente = (
        validas[validas["tipo_mix"].ne("COMBATE")]
        .groupby("cnpj_limpo")["valor_vendido_sem_imposto"]
        .sum()
    )
    clientes_positivados = int(ol_cliente[ol_cliente.gt(0)].index.nunique())
    clientes_ativos = 0
    if clientes is not None and not clientes.empty:
        clientes_base = clientes[clientes["cliente_ativo"].fillna(True)].copy()
        clientes_ativos = int(clientes_base["cnpj_limpo"].nunique())
    clientes_sem_compra = max(clientes_ativos - clientes_positivados, 0)
    metricas.update(
        {
            "clientes_positivados": clientes_positivados,
            "clientes_sem_compra": clientes_sem_compra,
            "clientes_ativos": clientes_ativos,
            "positivacao_percentual": _dividir(clientes_positivados, clientes_ativos),
        }
    )
    return metricas


def calcular_resumo_operacional(vendas: pd.DataFrame, clientes: pd.DataFrame | None = None) -> dict[str, float]:
    if vendas is None or vendas.empty:
        clientes_ativos = 0
        if clientes is not None and not clientes.empty:
            clientes_ativos = int(clientes[clientes["cliente_ativo"].fillna(True)]["cnpj_limpo"].nunique())
        return {
            "valor_combate": 0.0,
            "faturado_periodo": 0.0,
            "clientes_ativos": clientes_ativos,
            "clientes_com_venda": 0,
            "clientes_sem_venda": clientes_ativos,
            "pedidos_faturados": 0,
            "valor_pedidos_faturados": 0.0,
            "pedidos_sem_nota": 0,
            "valor_sem_nota": 0.0,
            "pedidos_cancelados": 0,
            "valor_cancelado": 0.0,
        }

    base = vendas.copy()
    status = base["status_normalizado"].fillna("").astype(str)
    faturadas = base[status.isin(STATUS_FATURADOS)].copy()
    validas = faturadas.copy()
    canceladas = base[status.eq(STATUS_CANCELADO)].copy()
    if "pedido_sem_nota" in base.columns:
        sem_nota = base[base["pedido_sem_nota"].fillna(False)].copy()
    else:
        sem_nota = base[
            status.ne(STATUS_CANCELADO)
            & base["nota_fiscal"].fillna("").astype(str).str.strip().eq("")
        ].copy()
    coluna_valor_sem_nota = (
        "valor_sem_nota_sem_imposto"
        if "valor_sem_nota_sem_imposto" in sem_nota.columns
        else "valor_vendido_sem_imposto"
    )

    sem_combate = validas[validas["tipo_mix"].ne("COMBATE")]
    ol_cliente = sem_combate.groupby("cnpj_limpo")["valor_vendido_sem_imposto"].sum()
    clientes_com_venda = int(ol_cliente[ol_cliente.gt(0)].index.nunique())

    if clientes is not None and not clientes.empty:
        clientes_ativos = int(clientes[clientes["cliente_ativo"].fillna(True)]["cnpj_limpo"].nunique())
    else:
        clientes_ativos = int(validas["cnpj_limpo"].dropna().astype(str).nunique())

    return {
        "valor_combate": float(validas.loc[validas["tipo_mix"].eq("COMBATE"), "valor_vendido_sem_imposto"].sum()),
        "faturado_periodo": float(faturadas["valor_vendido_sem_imposto"].sum()),
        "clientes_ativos": clientes_ativos,
        "clientes_com_venda": clientes_com_venda,
        "clientes_sem_venda": max(clientes_ativos - clientes_com_venda, 0),
        "pedidos_faturados": int(faturadas["pedido_id"].nunique()),
        "valor_pedidos_faturados": float(faturadas["valor_vendido_sem_imposto"].sum()),
        "pedidos_sem_nota": int(sem_nota["pedido_id"].nunique()),
        "valor_sem_nota": float(sem_nota[coluna_valor_sem_nota].sum()),
        "pedidos_cancelados": int(canceladas["pedido_id"].nunique()),
        "valor_cancelado": float(canceladas["valor_vendido_sem_imposto"].sum()),
    }


def _agregar_vendas_por_chave(vendas: pd.DataFrame, chaves: list[str]) -> pd.DataFrame:
    if vendas.empty:
        return pd.DataFrame(columns=chaves)
    validas = _vendas_validas(vendas)
    sem_combate = validas[validas["tipo_mix"].ne("COMBATE")]

    total = sem_combate.groupby(chaves, dropna=False).agg(
        ol_sem_combate=("valor_vendido_sem_imposto", "sum"),
        quantidade_vendida=("quantidade_base", "sum"),
        quantidade_pedidos=("pedido_id", "nunique"),
        ultima_compra=("data_base", "max"),
        clientes_com_compra=("cnpj_limpo", "nunique"),
    )
    prioritarios = validas[validas["tipo_mix"].eq("PRIORITARIO")].groupby(chaves, dropna=False)["valor_vendido_sem_imposto"].sum()
    lancamentos = validas[validas["tipo_mix"].eq("LANCAMENTO")].groupby(chaves, dropna=False)["valor_vendido_sem_imposto"].sum()

    total = total.join(prioritarios.rename("ol_prioritarios"), how="left")
    total = total.join(lancamentos.rename("ol_lancamentos"), how="left")
    total = total.fillna({"ol_prioritarios": 0, "ol_lancamentos": 0}).reset_index()
    total["percentual_prioritarios"] = np.where(total["ol_sem_combate"] > 0, total["ol_prioritarios"] / total["ol_sem_combate"], 0)
    total["percentual_lancamentos"] = np.where(total["ol_sem_combate"] > 0, total["ol_lancamentos"] / total["ol_sem_combate"], 0)
    total["ticket_medio"] = np.where(total["quantidade_pedidos"] > 0, total["ol_sem_combate"] / total["quantidade_pedidos"], 0)
    return total


def _status_comercial(linha: pd.Series) -> str:
    if linha.get("ol_sem_combate", 0) <= 0:
        return "Sem compra no período"
    if linha.get("ol_prioritarios", 0) <= 0:
        return "Comprou sem prioritários"
    if linha.get("ol_lancamentos", 0) <= 0:
        return "Comprou sem lançamentos"
    return "Comprou bem"


def gerar_resultado_cliente(vendas: pd.DataFrame, clientes: pd.DataFrame) -> pd.DataFrame:
    colunas_resultado = [
        "consultor",
        "cnpj_limpo",
        "nome_pdv",
        "cidade",
        "uf",
        "grupo_sip",
        "situacao",
        "proprietario_diretor",
        "comprador_gerente_de_compras",
        "cargo",
        "celular",
        "email",
        "ol_sem_combate",
        "ol_prioritarios",
        "percentual_prioritarios",
        "ol_lancamentos",
        "percentual_lancamentos",
        "quantidade_pedidos",
        "ticket_medio",
        "quantidade_vendida",
        "ultima_compra",
        "status_comercial",
        "cliente_ativo",
        "nome_rep",
    ]
    cadastro = clientes.copy()
    if cadastro.empty:
        return pd.DataFrame(columns=colunas_resultado)
    agreg = _agregar_vendas_por_chave(vendas, ["cnpj_limpo"])
    base = cadastro.merge(agreg, on="cnpj_limpo", how="left")
    for coluna in [
        "ol_sem_combate",
        "ol_prioritarios",
        "percentual_prioritarios",
        "ol_lancamentos",
        "percentual_lancamentos",
        "quantidade_pedidos",
        "ticket_medio",
        "quantidade_vendida",
    ]:
        if coluna not in base.columns:
            base[coluna] = 0
        base[coluna] = base[coluna].fillna(0)
    base["ultima_compra"] = pd.to_datetime(base.get("ultima_compra"), errors="coerce")
    base["status_comercial"] = base.apply(_status_comercial, axis=1)
    base["consultor"] = base["nome_rep"].fillna("").replace("", "SEM CONSULTOR")
    return base


def gerar_base_clientes(clientes: pd.DataFrame, vendas: pd.DataFrame) -> pd.DataFrame:
    return gerar_resultado_cliente(vendas, clientes)


def gerar_resultado_consultor(vendas: pd.DataFrame, clientes: pd.DataFrame) -> pd.DataFrame:
    clientes_base = clientes[clientes["cliente_ativo"].fillna(True)].copy() if not clientes.empty else pd.DataFrame()
    if clientes_base.empty or "nome_rep" not in clientes_base.columns:
        carteira = pd.DataFrame(columns=["consultor", "clientes_na_base"])
    else:
        carteira = clientes_base.groupby("nome_rep", dropna=False).agg(clientes_na_base=("cnpj_limpo", "nunique")).reset_index()
        carteira = carteira.rename(columns={"nome_rep": "consultor"})
        carteira["consultor"] = carteira["consultor"].fillna("").replace("", "SEM CONSULTOR")

    agreg = _agregar_vendas_por_chave(vendas, ["consultor"])
    resultado = carteira.merge(agreg, on="consultor", how="outer")
    resultado["consultor"] = resultado["consultor"].fillna("SEM CONSULTOR")
    for coluna in ["clientes_na_base", "clientes_com_compra", "ol_sem_combate", "ol_prioritarios", "ol_lancamentos", "quantidade_pedidos", "ticket_medio"]:
        if coluna not in resultado.columns:
            resultado[coluna] = 0
        resultado[coluna] = resultado[coluna].fillna(0)
    resultado["clientes_sem_compra"] = (resultado["clientes_na_base"] - resultado["clientes_com_compra"]).clip(lower=0)
    resultado["positivacao_percentual"] = np.where(resultado["clientes_na_base"] > 0, resultado["clientes_com_compra"] / resultado["clientes_na_base"], 0)
    resultado["percentual_prioritarios"] = np.where(resultado["ol_sem_combate"] > 0, resultado["ol_prioritarios"] / resultado["ol_sem_combate"], 0)
    resultado["percentual_lancamentos"] = np.where(resultado["ol_sem_combate"] > 0, resultado["ol_lancamentos"] / resultado["ol_sem_combate"], 0)
    return resultado.sort_values("ol_sem_combate", ascending=False).reset_index(drop=True)


def gerar_resultado_sip(vendas: pd.DataFrame, clientes: pd.DataFrame) -> pd.DataFrame:
    clientes_resultado = gerar_resultado_cliente(vendas, clientes)
    if clientes_resultado.empty:
        return pd.DataFrame()

    agrupado = clientes_resultado.groupby("grupo_sip", dropna=False).agg(
        quantidade_cnpjs=("cnpj_limpo", "nunique"),
        consultores_envolvidos=("consultor", lambda s: ", ".join(sorted({str(x) for x in s if str(x).strip()}))),
        ol_sem_combate=("ol_sem_combate", "sum"),
        ol_prioritarios=("ol_prioritarios", "sum"),
        ol_lancamentos=("ol_lancamentos", "sum"),
        cnpjs_com_compra=("ol_sem_combate", lambda s: int((s > 0).sum())),
        cnpjs_sem_compra=("ol_sem_combate", lambda s: int((s <= 0).sum())),
    ).reset_index()
    agrupado["percentual_prioritarios"] = np.where(agrupado["ol_sem_combate"] > 0, agrupado["ol_prioritarios"] / agrupado["ol_sem_combate"], 0)
    agrupado["percentual_lancamentos"] = np.where(agrupado["ol_sem_combate"] > 0, agrupado["ol_lancamentos"] / agrupado["ol_sem_combate"], 0)
    return agrupado.sort_values("ol_sem_combate", ascending=False).reset_index(drop=True)


def gerar_resultado_produto(vendas: pd.DataFrame, produtos_mix: pd.DataFrame) -> pd.DataFrame:
    colunas_resultado = [
        "ean",
        "produto",
        "tipo_mix",
        "ol_total",
        "quantidade_vendida",
        "clientes_compradores",
        "consultores_que_venderam",
    ]
    validas = _vendas_validas(vendas)
    if validas.empty and produtos_mix.empty:
        return pd.DataFrame(columns=colunas_resultado)
    vendas_prod = validas.groupby(["ean_limpo", "produto", "tipo_mix"], dropna=False).agg(
        ol_total=("valor_vendido_sem_imposto", "sum"),
        quantidade_vendida=("quantidade_base", "sum"),
        clientes_compradores=("cnpj_limpo", "nunique"),
        consultores_que_venderam=("consultor", lambda s: ", ".join(sorted({str(x) for x in s if str(x).strip()}))),
    ).reset_index()
    produtos = produtos_mix.copy()
    if not produtos.empty:
        produtos = produtos.rename(columns={"ean": "ean_mix", "produto": "produto_mix", "tipo_mix": "tipo_mix_mix"})
        resultado = produtos.merge(vendas_prod, on="ean_limpo", how="outer")
        resultado["ean_limpo"] = resultado["ean_limpo"].fillna(resultado.get("ean_mix", ""))
        resultado["produto"] = resultado.get("produto_mix", "").fillna("").where(resultado.get("produto_mix", "").fillna("").ne(""), resultado.get("produto", "").fillna(""))
        resultado["tipo_mix"] = resultado.get("tipo_mix_mix", "").fillna("").where(resultado.get("tipo_mix_mix", "").fillna("").ne(""), resultado.get("tipo_mix", "").fillna(TIPO_SEM_CLASSIFICACAO))
    else:
        resultado = vendas_prod
    for coluna in ["ol_total", "quantidade_vendida", "clientes_compradores"]:
        if coluna not in resultado.columns:
            resultado[coluna] = 0
        resultado[coluna] = resultado[coluna].fillna(0)
    if "consultores_que_venderam" not in resultado.columns:
        resultado["consultores_que_venderam"] = ""
    resultado["ean"] = resultado["ean_limpo"].fillna("")
    resultado["tipo_mix"] = resultado["tipo_mix"].fillna(TIPO_SEM_CLASSIFICACAO)
    return resultado[colunas_resultado].drop_duplicates("ean")


def auditar_produtos_mix(produtos_mix: pd.DataFrame, vendas: pd.DataFrame) -> dict[str, object]:
    produtos = produtos_mix.copy() if produtos_mix is not None else pd.DataFrame()
    if "ean_limpo" not in produtos.columns:
        produtos["ean_limpo"] = produtos.get("ean", pd.Series(dtype=str)).fillna("").astype(str)
    if "tipo_mix" not in produtos.columns:
        produtos["tipo_mix"] = TIPO_SEM_CLASSIFICACAO

    produtos["ean_limpo"] = produtos["ean_limpo"].fillna("").astype(str).str.strip()
    produtos["tipo_mix"] = produtos["tipo_mix"].fillna(TIPO_SEM_CLASSIFICACAO).astype(str)
    template_eans = set(produtos.loc[produtos["ean_limpo"].ne(""), "ean_limpo"])
    classificados_template = produtos[
        produtos["ean_limpo"].ne("")
        & produtos["tipo_mix"].ne(TIPO_SEM_CLASSIFICACAO)
    ]

    if vendas is None or vendas.empty or "ean_limpo" not in vendas.columns:
        vendas_eans: set[str] = set()
        vendas_classificados: set[str] = set()
    else:
        validas = _vendas_validas(vendas)
        vendas_eans = set(validas["ean_limpo"].dropna().astype(str).str.strip())
        vendas_eans.discard("")
        venda_tipo = validas[["ean_limpo", "tipo_mix"]].copy() if "tipo_mix" in validas.columns else pd.DataFrame(columns=["ean_limpo", "tipo_mix"])
        venda_tipo["ean_limpo"] = venda_tipo["ean_limpo"].fillna("").astype(str).str.strip()
        venda_tipo["tipo_mix"] = venda_tipo["tipo_mix"].fillna(TIPO_SEM_CLASSIFICACAO).astype(str)
        vendas_classificados = set(
            venda_tipo.loc[
                venda_tipo["ean_limpo"].ne("")
                & venda_tipo["tipo_mix"].ne(TIPO_SEM_CLASSIFICACAO),
                "ean_limpo",
            ]
        )

    vendas_sem_classificacao = vendas_eans - vendas_classificados
    vendas_fora_template = vendas_eans - template_eans
    vendas_total = len(vendas_eans)
    percentual_classificado = (len(vendas_classificados) / vendas_total) if vendas_total else 0.0
    taxa_sem_classificacao = (len(vendas_sem_classificacao) / vendas_total) if vendas_total else 0.0

    return {
        "total_template": int(len(template_eans)),
        "classificados_template": int(classificados_template["ean_limpo"].nunique()),
        "sem_classificacao_template": int(max(len(template_eans) - classificados_template["ean_limpo"].nunique(), 0)),
        "vendas_total_eans": int(vendas_total),
        "vendas_eans_classificados": int(len(vendas_classificados)),
        "vendas_eans_sem_classificacao": int(len(vendas_sem_classificacao)),
        "vendas_eans_fora_template": int(len(vendas_fora_template)),
        "percentual_classificado": float(percentual_classificado),
        "alerta_critico": bool((vendas_total > 0 and taxa_sem_classificacao > 0.30) or (len(template_eans) > 0 and classificados_template.empty)),
        "tipos_mix_contagem": produtos["tipo_mix"].value_counts().to_dict(),
    }


def formatar_tabela_metricas(df: pd.DataFrame) -> pd.DataFrame:
    base = df.copy()
    for coluna in ["ol_sem_combate", "ol_prioritarios", "ol_lancamentos", "ticket_medio", "ol_total", "ol_antes_acao", "ol_durante_acao", "meta_mes"]:
        if coluna in base.columns:
            base[coluna] = base[coluna].apply(formatar_moeda)
    for coluna in ["percentual_prioritarios", "percentual_lancamentos", "positivacao_percentual", "crescimento_percentual", "atingimento_meta"]:
        if coluna in base.columns:
            base[coluna] = base[coluna].apply(formatar_percentual)
    for coluna in ["ultima_compra", "data_inicio", "data_fim"]:
        if coluna in base.columns:
            base[coluna] = base[coluna].apply(formatar_data)
    return base
