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
      LEFT JOIN consultores co ON co.id=COALESCE(pe.consultor_bussola_id,pe.consultor_id,cl.consultor_id)
     WHERE pe.ativo=1 AND ip.ativo=1
       AND DATE(pe.data_pedido) BETWEEN DATE('2026-07-01') AND DATE('2026-07-31')
    """
    mauricio = "UPPER(TRIM(COALESCE(co.nome,'')))='MAURICIO BARROS DE AGUIAR'"
    representante_mauricio = "UPPER(TRIM(COALESCE(pe.representante_bussola,''))) LIKE '%MAURICIO BARROS DE AGUIAR%'"

    dados = {
        "ultima_extracao": query(db, """
          SELECT status,total_registros,mensagem,iniciado_em,finalizado_em
            FROM extracoes
           WHERE tipo='BUSSOLA'
           ORDER BY COALESCE(finalizado_em,iniciado_em,criado_em) DESC
           LIMIT 1
        """),
        "sincronizacao": query(db, """
          SELECT valor_json,atualizado_em
            FROM configuracoes
           WHERE chave='bussola_ultima_sincronizacao'
           LIMIT 1
        """),
        "vinculos": query(db, """
          SELECT COUNT(DISTINCT CASE WHEN pe.consultor_bussola_id IS NOT NULL THEN pe.id END) pedidos_com_representante,
                 COUNT(DISTINCT pe.id) pedidos_ativos
            FROM pedidos pe
           WHERE pe.origem='BUSSOLA' AND pe.ativo=1
        """),
        "mauricio_resumo_emissao_todos_status": query(db, f"""
          SELECT ROUND(COALESCE(SUM(ip.valor_total_solicitado_sem_imposto),0),2) solicitado,
                 ROUND(COALESCE(SUM(ip.total_atendido_sem_imposto),0),2) atendido,
                 ROUND(COALESCE(SUM(ip.valor_faturado),0),2) faturado,
                 COUNT(DISTINCT pe.id) pedidos,
                 COUNT(ip.id) itens
          {base_joins} AND {mauricio}
        """),
        "mauricio_resumo_emissao_status_faturado": query(db, f"""
          SELECT ROUND(COALESCE(SUM(ip.valor_total_solicitado_sem_imposto),0),2) solicitado,
                 ROUND(COALESCE(SUM(ip.total_atendido_sem_imposto),0),2) atendido,
                 ROUND(COALESCE(SUM(ip.valor_faturado),0),2) faturado,
                 COUNT(DISTINCT pe.id) pedidos,
                 COUNT(ip.id) itens
          {base_joins} AND {mauricio}
            AND UPPER(TRIM(COALESCE(pe.status,''))) IN ('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO')
        """),
        "representante_mauricio_resumo_emissao": query(db, f"""
          SELECT ROUND(COALESCE(SUM(ip.valor_total_solicitado_sem_imposto),0),2) solicitado,
                 ROUND(COALESCE(SUM(ip.total_atendido_sem_imposto),0),2) atendido,
                 ROUND(COALESCE(SUM(ip.valor_faturado),0),2) faturado,
                 COUNT(DISTINCT pe.id) pedidos,
                 COUNT(ip.id) itens
          {base_joins} AND {representante_mauricio}
        """),
        "mauricio_por_status_emissao": query(db, f"""
          SELECT UPPER(TRIM(COALESCE(pe.status,'SEM STATUS'))) status,
                 ROUND(COALESCE(SUM(ip.valor_total_solicitado_sem_imposto),0),2) solicitado,
                 ROUND(COALESCE(SUM(ip.total_atendido_sem_imposto),0),2) atendido,
                 ROUND(COALESCE(SUM(ip.valor_faturado),0),2) faturado,
                 COUNT(DISTINCT pe.id) pedidos,
                 COUNT(ip.id) itens
          {base_joins} AND {mauricio}
          GROUP BY UPPER(TRIM(COALESCE(pe.status,'SEM STATUS')))
          ORDER BY solicitado DESC
        """),
        "por_representante_emissao": query(db, f"""
          SELECT COALESCE(NULLIF(TRIM(pe.representante_bussola),''),'SEM REPRESENTANTE') representante,
                 COALESCE(NULLIF(TRIM(co.nome),''),'SEM CONSULTOR') consultor,
                 ROUND(COALESCE(SUM(ip.valor_total_solicitado_sem_imposto),0),2) solicitado,
                 ROUND(COALESCE(SUM(ip.total_atendido_sem_imposto),0),2) atendido,
                 ROUND(COALESCE(SUM(ip.valor_faturado),0),2) faturado,
                 COUNT(DISTINCT pe.id) pedidos,
                 COUNT(ip.id) itens
          {base_joins}
          GROUP BY COALESCE(NULLIF(TRIM(pe.representante_bussola),''),'SEM REPRESENTANTE'),
                   COALESCE(NULLIF(TRIM(co.nome),''),'SEM CONSULTOR')
          ORDER BY faturado DESC
        """),
        "mauricio_data_faturamento": query(db, """
          SELECT ROUND(COALESCE(SUM(ip.valor_total_solicitado_sem_imposto),0),2) solicitado,
                 ROUND(COALESCE(SUM(ip.total_atendido_sem_imposto),0),2) atendido,
                 ROUND(COALESCE(SUM(ip.valor_faturado),0),2) faturado,
                 COUNT(DISTINCT pe.id) pedidos,
                 COUNT(ip.id) itens
            FROM itens_pedido ip
            JOIN pedidos pe ON pe.id=ip.pedido_id
            LEFT JOIN clientes cl ON cl.id=pe.cliente_id
            JOIN consultores co ON co.id=COALESCE(pe.consultor_bussola_id,pe.consultor_id,cl.consultor_id)
           WHERE pe.ativo=1 AND ip.ativo=1
             AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE('2026-07-01') AND DATE('2026-07-31')
             AND UPPER(TRIM(COALESCE(co.nome,'')))='MAURICIO BARROS DE AGUIAR'
        """),
    }
    print("VERIFICACAO_BUSSOLA_REPRESENTANTE=" + json.dumps(dados, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
