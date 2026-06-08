from __future__ import annotations

from typing import Any

import pandas as pd

from src.calculos import gerar_resultado_cliente
from src.sip_store import normalizar_grupo_sip
from src.tratamento import STATUS_CANCELADO, STATUS_FATURADOS


CATEGORIA_FATURADO = "Faturado / nota gerada"
CATEGORIA_SEM_NOTA = "Ainda não gerou nota"
CATEGORIA_CANCELADO = "Cancelado"


def falta_regra(valor: float, meta: float, pagamento: float) -> float:
    return max(float(meta or 0) * (float(pagamento or 0) / 100) - float(valor or 0), 0.0)


def categorizar_pedido(linha: pd.Series) -> str:
    status = str(linha.get("status_normalizado", ""))
    nota = str(linha.get("nota_fiscal", "") or "").strip()
    if status == STATUS_CANCELADO:
        return CATEGORIA_CANCELADO
    if status in STATUS_FATURADOS and nota:
        return CATEGORIA_FATURADO
    if not nota:
        return CATEGORIA_SEM_NOTA
    return "Em andamento"


def filtrar_periodo(vendas: pd.DataFrame, inicio: object, fim: object) -> pd.DataFrame:
    if vendas is None or vendas.empty:
        return pd.DataFrame(columns=list(vendas.columns) if vendas is not None else [])
    data_base = pd.to_datetime(vendas["data_base"], errors="coerce")
    return vendas[
        (data_base >= pd.Timestamp(inicio))
        & (data_base <= pd.Timestamp(fim) + pd.Timedelta(days=1) - pd.Timedelta(seconds=1))
    ].copy()


def preparar_pedidos_sip(vendas_base: pd.DataFrame) -> pd.DataFrame:
    colunas = [
        "categoria",
        "pedido_id",
        "nota_fiscal",
        "status_pedido",
        "status_normalizado",
        "cnpj_limpo",
        "nome_pdv",
        "cidade",
        "uf",
        "data_base",
        "valor_vendido_sem_imposto",
        "valor_sem_nota_sem_imposto",
        "valor_pedido_sem_imposto",
    ]
    if vendas_base is None or vendas_base.empty:
        return pd.DataFrame(columns=colunas)

    base = vendas_base.copy()
    for coluna in ["valor_sem_nota_sem_imposto", "valor_pedido_sem_imposto"]:
        if coluna not in base.columns:
            base[coluna] = 0.0

    agrupado = (
        base.groupby(
            [
                "pedido_id",
                "nota_fiscal",
                "status_pedido",
                "status_normalizado",
                "cnpj_limpo",
                "nome_pdv",
                "cidade",
                "uf",
                "data_base",
            ],
            dropna=False,
        )
        .agg(
            valor_vendido_sem_imposto=("valor_vendido_sem_imposto", "sum"),
            valor_sem_nota_sem_imposto=("valor_sem_nota_sem_imposto", "sum"),
            valor_pedido_sem_imposto=("valor_pedido_sem_imposto", "sum"),
        )
        .reset_index()
    )
    agrupado["categoria"] = agrupado.apply(categorizar_pedido, axis=1)
    return agrupado[colunas].sort_values("data_base", ascending=False)


def filtrar_status_pedido(pedidos: pd.DataFrame, status: str) -> pd.DataFrame:
    if pedidos is None or pedidos.empty:
        return pd.DataFrame(columns=list(pedidos.columns) if pedidos is not None else [])
    status_norm = str(status or "Todos").strip().lower()
    if status_norm in {"todos", "todo"}:
        return pedidos.copy()
    if status_norm in {"faturado", "faturados"}:
        return pedidos[pedidos["categoria"].eq(CATEGORIA_FATURADO)].copy()
    if status_norm in {"sem nota", "sem_nota"}:
        return pedidos[pedidos["categoria"].eq(CATEGORIA_SEM_NOTA)].copy()
    if status_norm in {"cancelado", "cancelados"}:
        return pedidos[pedidos["categoria"].eq(CATEGORIA_CANCELADO)].copy()
    return pedidos.copy()


def _vendas_para_status(vendas_periodo: pd.DataFrame, pedidos_filtrados: pd.DataFrame, status: str) -> pd.DataFrame:
    if str(status or "Todos").strip().lower() in {"todos", "todo"}:
        return vendas_periodo.copy()
    if vendas_periodo.empty or pedidos_filtrados.empty:
        return vendas_periodo.iloc[0:0].copy()
    pedidos = set(pedidos_filtrados["pedido_id"].dropna().astype(str))
    return vendas_periodo[vendas_periodo["pedido_id"].astype(str).isin(pedidos)].copy()


def calcular_indicadores_sip(
    df_vendas: pd.DataFrame,
    df_clientes: pd.DataFrame,
    sip_normalizada: dict[str, Any],
    data_inicial: object,
    data_final: object,
    status_pedido: str = "Todos",
) -> dict[str, Any]:
    grupo = normalizar_grupo_sip(sip_normalizada)
    cnpjs = set(grupo.get("cnpjs", []))
    vendas_total = df_vendas[df_vendas["cnpj_limpo"].astype(str).isin(cnpjs)].copy() if cnpjs and not df_vendas.empty else df_vendas.iloc[0:0].copy()
    vendas_periodo = filtrar_periodo(vendas_total, data_inicial, data_final)
    pedidos_total = preparar_pedidos_sip(vendas_periodo)
    pedidos = filtrar_status_pedido(pedidos_total, status_pedido)
    vendas_metricas = _vendas_para_status(vendas_periodo, pedidos, status_pedido)

    clientes_resultado = gerar_resultado_cliente(vendas_metricas, df_clientes)
    membros_sip = clientes_resultado[clientes_resultado["cnpj_limpo"].astype(str).isin(cnpjs)].copy() if cnpjs else clientes_resultado.iloc[0:0].copy()

    ol = float(membros_sip["ol_sem_combate"].sum()) if not membros_sip.empty else 0.0
    prio = float(membros_sip["ol_prioritarios"].sum()) if not membros_sip.empty else 0.0
    lanc = float(membros_sip["ol_lancamentos"].sum()) if not membros_sip.empty else 0.0
    meta = float(grupo.get("meta_mes", 0) or 0)
    pagamento = float(grupo.get("pagamento_percentual", 80) or 80)

    faturados = pedidos[pedidos["categoria"].eq(CATEGORIA_FATURADO)].copy()
    sem_nota = pedidos[pedidos["categoria"].eq(CATEGORIA_SEM_NOTA)].copy()
    cancelados = pedidos[pedidos["categoria"].eq(CATEGORIA_CANCELADO)].copy()

    return {
        "grupo": grupo,
        "data_inicial": pd.Timestamp(data_inicial),
        "data_final": pd.Timestamp(data_final),
        "status_pedido": status_pedido,
        "vendas_total": vendas_total,
        "vendas_periodo": vendas_periodo,
        "vendas_metricas": vendas_metricas,
        "clientes_resultado": clientes_resultado,
        "membros_sip": membros_sip,
        "pedidos_total": pedidos_total,
        "pedidos": pedidos,
        "faturados": faturados,
        "sem_nota": sem_nota,
        "cancelados": cancelados,
        "cnpjs": len(grupo.get("cnpjs", [])),
        "meta": meta,
        "faturado": ol,
        "ol_prioritarios": prio,
        "ol_lancamentos": lanc,
        "falta_regra": falta_regra(ol, meta, pagamento),
        "atingimento": (ol / meta) if meta else 0.0,
        "pagamento_percentual": pagamento,
        "pedidos_faturados": int(len(faturados)),
        "pedidos_sem_nota": int(len(sem_nota)),
        "pedidos_cancelados": int(len(cancelados)),
        "valor_pedidos_faturados": float(faturados["valor_vendido_sem_imposto"].sum()) if not faturados.empty else 0.0,
        "valor_sem_nota": float(sem_nota["valor_sem_nota_sem_imposto"].sum()) if not sem_nota.empty else 0.0,
        "valor_cancelado": float(cancelados["valor_vendido_sem_imposto"].sum()) if not cancelados.empty else 0.0,
        "linhas_venda_usadas": int(len(vendas_metricas)),
        "linhas_pedidos_usados": int(len(pedidos)),
        "soma_bruta_faturamento": float(vendas_metricas["valor_vendido_sem_imposto"].sum()) if not vendas_metricas.empty else 0.0,
    }
