from __future__ import annotations

import json
import os
from typing import Any

import requests

API_BASE = "https://api.cloudflare.com/client/v4"
ACCOUNT_ID = os.environ["CLOUDFLARE_ACCOUNT_ID"]
API_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
DATABASE_NAME = os.environ.get("CLOUDFLARE_D1_DATABASE", "painel-equipe-norte-db")
HEADERS = {"authorization": f"Bearer {API_TOKEN}", "content-type": "application/json"}
INICIO = "2026-07-01"
FIM = "2026-07-31"
STATUS = "UPPER(TRIM(COALESCE(pe.status,''))) IN ('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO')"
ATIVOS = "pe.ativo=1 AND ip.ativo=1"


def request(method: str, url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    response = requests.request(method, url, headers=HEADERS, json=payload, timeout=90)
    response.raise_for_status()
    data = response.json()
    if not data.get("success"):
        raise RuntimeError(data)
    return data


def database_id() -> str:
    data = request("GET", f"{API_BASE}/accounts/{ACCOUNT_ID}/d1/database?per_page=100")
    for item in data.get("result") or []:
        if str(item.get("name") or "").strip() == DATABASE_NAME:
            return str(item["uuid"])
    raise RuntimeError(f"Banco não encontrado: {DATABASE_NAME}")


def query(db: str, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    data = request(
        "POST",
        f"{API_BASE}/accounts/{ACCOUNT_ID}/d1/database/{db}/query",
        {"sql": sql, "params": params or []},
    )
    result = data.get("result") or []
    return (result[0].get("results") if result else []) or []


def total_sql(data_expr: str, extra: str = "1=1") -> str:
    return f"""
      SELECT ROUND(COALESCE(SUM(ip.valor_faturado),0),2) total,
             COUNT(DISTINCT pe.id) pedidos,
             COUNT(ip.id) itens,
             COUNT(DISTINCT pe.cliente_id) clientes
        FROM itens_pedido ip
        JOIN pedidos pe ON pe.id=ip.pedido_id
        LEFT JOIN clientes cl ON cl.id=pe.cliente_id
        LEFT JOIN consultores co ON co.id=cl.consultor_id
       WHERE {ATIVOS}
         AND {STATUS}
         AND DATE({data_expr}) BETWEEN DATE(?) AND DATE(?)
         AND {extra}
    """


def main() -> None:
    db = database_id()
    params = [INICIO, FIM]
    reports: dict[str, Any] = {}

    reports["geral_por_data_pedido"] = query(db, total_sql("pe.data_pedido"), params)
    reports["geral_por_data_faturamento"] = query(
        db,
        total_sql("COALESCE(pe.data_faturamento,pe.data_pedido)"),
        params,
    )
    reports["mauricio_por_data_pedido"] = query(
        db,
        total_sql("pe.data_pedido", "UPPER(TRIM(COALESCE(co.nome,'')))='MAURICIO BARROS DE AGUIAR' AND cl.carteira_importada=1"),
        params,
    )
    reports["mauricio_por_data_faturamento"] = query(
        db,
        total_sql("COALESCE(pe.data_faturamento,pe.data_pedido)", "UPPER(TRIM(COALESCE(co.nome,'')))='MAURICIO BARROS DE AGUIAR' AND cl.carteira_importada=1"),
        params,
    )
    reports["fora_carteira_por_data_pedido"] = query(
        db,
        total_sql("pe.data_pedido", "COALESCE(cl.carteira_importada,0)<>1 OR cl.consultor_id IS NULL"),
        params,
    )
    reports["fora_carteira_por_data_faturamento"] = query(
        db,
        total_sql("COALESCE(pe.data_faturamento,pe.data_pedido)", "COALESCE(cl.carteira_importada,0)<>1 OR cl.consultor_id IS NULL"),
        params,
    )
    reports["por_consultor_data_pedido"] = query(db, f"""
      SELECT COALESCE(co.nome,'SEM CONSULTOR') consultor,
             COALESCE(cl.carteira_importada,0) carteira_importada,
             ROUND(COALESCE(SUM(ip.valor_faturado),0),2) total,
             COUNT(DISTINCT pe.id) pedidos
        FROM itens_pedido ip
        JOIN pedidos pe ON pe.id=ip.pedido_id
        LEFT JOIN clientes cl ON cl.id=pe.cliente_id
        LEFT JOIN consultores co ON co.id=cl.consultor_id
       WHERE {ATIVOS} AND {STATUS}
         AND DATE(pe.data_pedido) BETWEEN DATE(?) AND DATE(?)
       GROUP BY COALESCE(co.nome,'SEM CONSULTOR'),COALESCE(cl.carteira_importada,0)
       ORDER BY total DESC
    """, params)
    reports["por_status_data_pedido"] = query(db, f"""
      SELECT UPPER(TRIM(COALESCE(pe.status,'SEM STATUS'))) status,
             ROUND(COALESCE(SUM(ip.valor_faturado),0),2) total,
             COUNT(DISTINCT pe.id) pedidos
        FROM itens_pedido ip
        JOIN pedidos pe ON pe.id=ip.pedido_id
       WHERE {ATIVOS}
         AND DATE(pe.data_pedido) BETWEEN DATE(?) AND DATE(?)
       GROUP BY UPPER(TRIM(COALESCE(pe.status,'SEM STATUS')))
       ORDER BY total DESC
    """, params)
    reports["faturados_em_agosto_de_pedidos_julho"] = query(db, f"""
      SELECT ROUND(COALESCE(SUM(ip.valor_faturado),0),2) total,
             COUNT(DISTINCT pe.id) pedidos
        FROM itens_pedido ip
        JOIN pedidos pe ON pe.id=ip.pedido_id
       WHERE {ATIVOS} AND {STATUS}
         AND DATE(pe.data_pedido) BETWEEN DATE(?) AND DATE(?)
         AND DATE(pe.data_faturamento)>DATE(?)
    """, [INICIO, FIM, FIM])
    reports["ultima_extracao"] = query(db, """
      SELECT status,total_registros,mensagem,iniciado_em,finalizado_em
        FROM extracoes
       WHERE tipo='BUSSOLA'
       ORDER BY COALESCE(finalizado_em,iniciado_em,criado_em) DESC
       LIMIT 1
    """)
    reports["sincronizacao"] = query(db, """
      SELECT valor_json,atualizado_em
        FROM configuracoes
       WHERE chave='bussola_ultima_sincronizacao'
       LIMIT 1
    """)

    print("DIAGNOSTICO_BUSSOLA_JULHO=" + json.dumps(reports, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
