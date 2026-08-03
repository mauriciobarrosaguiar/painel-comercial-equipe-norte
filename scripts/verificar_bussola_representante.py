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


def main() -> None:
    db = database_id()
    base_joins = """
      FROM itens_pedido ip
      JOIN pedidos pe ON pe.id=ip.pedido_id
      LEFT JOIN clientes cl ON cl.id=pe.cliente_id
      LEFT JOIN consultores co_origem ON co_origem.id=pe.consultor_bussola_id
      LEFT JOIN consultores co_carteira ON co_carteira.id=cl.consultor_id
     WHERE pe.ativo=1 AND ip.ativo=1
       AND DATE(pe.data_pedido) BETWEEN DATE('2026-07-01') AND DATE('2026-07-31')
    """
    origem_mauricio = "UPPER(TRIM(COALESCE(co_origem.nome,'')))='MAURICIO BARROS DE AGUIAR'"
    carteira_mauricio = "UPPER(TRIM(COALESCE(co_carteira.nome,'')))='MAURICIO BARROS DE AGUIAR'"

    resumo = """
      SELECT ROUND(COALESCE(SUM(ip.valor_total_solicitado_sem_imposto),0),2) solicitado,
             ROUND(COALESCE(SUM(ip.total_atendido_sem_imposto),0),2) atendido,
             ROUND(COALESCE(SUM(ip.valor_faturado),0),2) faturado,
             COUNT(DISTINCT pe.id) pedidos,
             COUNT(ip.id) itens
    """

    dados = {
        "ultima_extracao": query(db, """
          SELECT status,total_registros,mensagem,iniciado_em,finalizado_em
            FROM extracoes
           WHERE tipo='BUSSOLA'
           ORDER BY COALESCE(finalizado_em,iniciado_em,criado_em) DESC
           LIMIT 1
        """),
        "somente_origem_mauricio": query(db, f"{resumo} {base_joins} AND {origem_mauricio}"),
        "somente_carteira_mauricio": query(db, f"{resumo} {base_joins} AND {carteira_mauricio}"),
        "uniao_origem_ou_carteira": query(db, f"{resumo} {base_joins} AND ({origem_mauricio} OR {carteira_mauricio})"),
        "intersecao_origem_e_carteira": query(db, f"{resumo} {base_joins} AND {origem_mauricio} AND {carteira_mauricio}"),
        "origem_apenas_fora_carteira": query(db, f"{resumo} {base_joins} AND {origem_mauricio} AND NOT ({carteira_mauricio})"),
        "carteira_apenas_outra_origem": query(db, f"{resumo} {base_joins} AND {carteira_mauricio} AND NOT ({origem_mauricio})"),
        "uniao_por_status": query(db, f"""
          SELECT UPPER(TRIM(COALESCE(pe.status,'SEM STATUS'))) status,
                 ROUND(COALESCE(SUM(ip.valor_total_solicitado_sem_imposto),0),2) solicitado,
                 ROUND(COALESCE(SUM(ip.total_atendido_sem_imposto),0),2) atendido,
                 ROUND(COALESCE(SUM(ip.valor_faturado),0),2) faturado,
                 COUNT(DISTINCT pe.id) pedidos
          {base_joins}
            AND ({origem_mauricio} OR {carteira_mauricio})
          GROUP BY UPPER(TRIM(COALESCE(pe.status,'SEM STATUS')))
          ORDER BY solicitado DESC
        """),
    }
    print("VERIFICACAO_BUSSOLA_UNIAO=" + json.dumps(dados, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
