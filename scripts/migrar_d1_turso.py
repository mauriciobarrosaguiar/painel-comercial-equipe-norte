from __future__ import annotations

import os
import re
import sys
import time
from typing import Any

import requests

CF_API = "https://api.cloudflare.com/client/v4"
DB_NAME = os.environ.get("CLOUDFLARE_D1_DATABASE", "painel-equipe-norte-db").strip()
ACCOUNT_ID = os.environ["CLOUDFLARE_ACCOUNT_ID"].strip()
CF_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"].strip()
TURSO_URL = os.environ["TURSO_DATABASE_URL"].strip()
TURSO_TOKEN = os.environ["TURSO_AUTH_TOKEN"].strip()

CF_HEADERS = {
    "authorization": f"Bearer {CF_TOKEN}",
    "content-type": "application/json",
}
TURSO_HTTP = TURSO_URL.replace("libsql://", "https://").replace("turso://", "https://").rstrip("/")
TURSO_PIPELINE = f"{TURSO_HTTP}/v2/pipeline"
TURSO_HEADERS = {
    "authorization": f"Bearer {TURSO_TOKEN}",
    "content-type": "application/json",
}
SKIP_TABLES = {"d1_migrations", "_cf_KV"}


def request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    last = ""
    for attempt in range(1, 6):
        response = requests.request(method, url, headers=headers, json=payload, timeout=120)
        if response.status_code == 429 or response.status_code >= 500:
            last = f"HTTP {response.status_code}: {response.text[:500]}"
            time.sleep(min(2**attempt, 20))
            continue
        try:
            data = response.json()
        except ValueError as exc:
            raise RuntimeError(
                f"Resposta inválida HTTP {response.status_code}: {response.text[:500]}"
            ) from exc
        if not response.ok:
            raise RuntimeError(f"HTTP {response.status_code}: {data}")
        return data
    raise RuntimeError(f"Falha repetida: {last}")


def locate_d1_id() -> str:
    data = request_json(
        "GET",
        f"{CF_API}/accounts/{ACCOUNT_ID}/d1/database?per_page=100",
        headers=CF_HEADERS,
    )
    for item in data.get("result") or []:
        if str(item.get("name", "")) == DB_NAME:
            value = str(item.get("uuid") or item.get("id") or "").strip()
            if value:
                return value
    raise RuntimeError(f"Banco D1 não encontrado: {DB_NAME}")


D1_ID = locate_d1_id()


def d1_query(sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    data = request_json(
        "POST",
        f"{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{D1_ID}/query",
        headers=CF_HEADERS,
        payload={"sql": sql, "params": params or []},
    )
    if not data.get("success", False):
        raise RuntimeError(f"Consulta D1 falhou: {data.get('errors') or data}")
    result = data.get("result") or []
    if not result:
        return []
    first = result[0] if isinstance(result[0], dict) else {}
    if not first.get("success", True):
        raise RuntimeError(f"Consulta D1 falhou: {first}")
    rows = first.get("results") or []
    return [row for row in rows if isinstance(row, dict)]


def turso_value(value: Any) -> dict[str, Any]:
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": "1" if value else "0"}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "float", "value": str(value)}
    if isinstance(value, (bytes, bytearray, memoryview)):
        import base64

        return {
            "type": "blob",
            "base64": base64.b64encode(bytes(value)).decode("ascii"),
        }
    return {"type": "text", "value": str(value)}


def turso_pipeline(statements: list[tuple[str, list[Any]]]) -> list[dict[str, Any]]:
    requests_payload: list[dict[str, Any]] = []
    for sql, args in statements:
        stmt: dict[str, Any] = {"sql": sql}
        if args:
            stmt["args"] = [turso_value(value) for value in args]
        requests_payload.append({"type": "execute", "stmt": stmt})
    requests_payload.append({"type": "close"})

    data = request_json(
        "POST",
        TURSO_PIPELINE,
        headers=TURSO_HEADERS,
        payload={"requests": requests_payload},
    )
    results = data.get("results") or []
    decoded: list[dict[str, Any]] = []
    for index, item in enumerate(results[:-1]):
        if item.get("type") != "ok":
            raise RuntimeError(f"Turso falhou na instrução {index + 1}: {item}")
        response = item.get("response") or {}
        if response.get("type") != "execute":
            raise RuntimeError(f"Resposta Turso inesperada: {response}")
        decoded.append(response.get("result") or {})
    return decoded


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def schema_objects() -> list[dict[str, Any]]:
    return d1_query(
        """
        SELECT type,name,tbl_name,sql
          FROM sqlite_master
         WHERE sql IS NOT NULL
           AND name NOT LIKE 'sqlite_%'
         ORDER BY CASE type
                    WHEN 'table' THEN 1
                    WHEN 'view' THEN 3
                    WHEN 'index' THEN 4
                    WHEN 'trigger' THEN 5
                    ELSE 9
                  END, name
        """
    )


def table_columns(table: str) -> list[str]:
    rows = d1_query(f"PRAGMA table_xinfo({quote_ident(table)})")
    cols: list[str] = []
    for row in rows:
        try:
            hidden = int(row.get("hidden") or 0)
        except (TypeError, ValueError):
            hidden = 0
        if hidden == 0 and row.get("name"):
            cols.append(str(row["name"]))
    return cols


def foreign_key_parents(table: str, valid_tables: set[str]) -> set[str]:
    parents: set[str] = set()
    for row in d1_query(f"PRAGMA foreign_key_list({quote_ident(table)})"):
        parent = str(row.get("table") or "").strip()
        if parent and parent != table and parent in valid_tables:
            parents.add(parent)
    return parents


def order_tables(tables: list[str]) -> list[str]:
    valid = set(tables)
    dependencies = {table: foreign_key_parents(table, valid) for table in tables}
    ordered: list[str] = []
    pending = set(tables)

    while pending:
        ready = sorted(
            table
            for table in pending
            if not (dependencies.get(table, set()) & pending)
        )
        if not ready:
            # Ciclo de FK: mantém ordem estável. A cópia usa FK OFF por lote como
            # contingência, preservando exatamente os dados já válidos no D1.
            ready = [sorted(pending)[0]]
        for table in ready:
            ordered.append(table)
            pending.remove(table)

    return ordered


def copy_table(
    table: str,
    *,
    page_size: int = 500,
    insert_batch: int = 50,
) -> int:
    columns = table_columns(table)
    if not columns:
        print(f"[skip] {table}: sem colunas copiáveis")
        return 0

    quoted_cols = ",".join(quote_ident(col) for col in columns)
    offset = 0
    total = 0
    while True:
        rows = d1_query(
            f"SELECT {quoted_cols} FROM {quote_ident(table)} LIMIT ? OFFSET ?",
            [page_size, offset],
        )
        if not rows:
            break

        for start in range(0, len(rows), insert_batch):
            chunk = rows[start : start + insert_batch]
            placeholders = "(" + ",".join("?" for _ in columns) + ")"
            sql = (
                f"INSERT OR REPLACE INTO {quote_ident(table)} ({quoted_cols}) VALUES "
                + ",".join(placeholders for _ in chunk)
            )
            args = [row.get(col) for row in chunk for col in columns]
            # Cada pipeline usa uma conexão única. Desabilitamos FK somente neste
            # lote de cópia para suportar ciclos e relações antigas já válidas no D1.
            turso_pipeline(
                [
                    ("PRAGMA foreign_keys=OFF", []),
                    (sql, args),
                    ("PRAGMA foreign_keys=ON", []),
                ]
            )

        total += len(rows)
        offset += len(rows)
        print(f"  {table}: {total} linhas")
        if len(rows) < page_size:
            break

    return total


def scalar_turso(sql: str, args: list[Any] | None = None) -> Any:
    result = turso_pipeline([(sql, args or [])])[0]
    cols = result.get("cols") or []
    rows = result.get("rows") or []
    if not rows or not cols:
        return None
    cell = rows[0][0] if rows[0] else None
    if not isinstance(cell, dict) or cell.get("type") == "null":
        return None
    return cell.get("value")


def main() -> None:
    print(f"Origem D1: {DB_NAME} ({D1_ID})")
    print(f"Destino Turso: {TURSO_HTTP}")

    objects = schema_objects()
    tables = [
        obj
        for obj in objects
        if obj.get("type") == "table"
        and str(obj.get("name") or "") not in SKIP_TABLES
    ]
    later = [
        obj
        for obj in objects
        if obj.get("type") in {"view", "index", "trigger"}
        and str(obj.get("tbl_name") or "") not in SKIP_TABLES
    ]

    print(f"Tabelas encontradas: {len(tables)}")
    for obj in tables:
        sql = str(obj.get("sql") or "").strip()
        if not sql:
            continue
        if "IF NOT EXISTS" not in sql.upper():
            sql = re.sub(
                r"(?i)^CREATE\s+TABLE\s+",
                "CREATE TABLE IF NOT EXISTS ",
                sql,
                count=1,
            )
        turso_pipeline([(sql, [])])

    table_names = [str(obj["name"]) for obj in tables]
    ordered_tables = order_tables(table_names)
    print("Ordem de cópia calculada por chaves estrangeiras.")

    copied: dict[str, int] = {}
    for table in ordered_tables:
        copied[table] = copy_table(table)

    for obj in later:
        sql = str(obj.get("sql") or "").strip()
        if not sql:
            continue
        obj_type = str(obj.get("type") or "").upper()
        name = str(obj.get("name") or "")
        if "IF NOT EXISTS" not in sql.upper():
            if obj_type == "INDEX":
                sql = re.sub(
                    r"(?i)^CREATE\s+UNIQUE\s+INDEX\s+",
                    "CREATE UNIQUE INDEX IF NOT EXISTS ",
                    sql,
                    count=1,
                )
                sql = re.sub(
                    r"(?i)^CREATE\s+INDEX\s+",
                    "CREATE INDEX IF NOT EXISTS ",
                    sql,
                    count=1,
                )
            elif obj_type == "VIEW":
                sql = re.sub(
                    r"(?i)^CREATE\s+VIEW\s+",
                    "CREATE VIEW IF NOT EXISTS ",
                    sql,
                    count=1,
                )
            elif obj_type == "TRIGGER":
                sql = re.sub(
                    r"(?i)^CREATE\s+TRIGGER\s+",
                    "CREATE TRIGGER IF NOT EXISTS ",
                    sql,
                    count=1,
                )
        try:
            turso_pipeline([(sql, [])])
        except Exception as exc:
            print(f"[aviso] não foi possível recriar {obj_type} {name}: {exc}")

    mismatches: list[tuple[str, int, int]] = []
    for table, expected in copied.items():
        actual = scalar_turso(f"SELECT COUNT(*) FROM {quote_ident(table)}")
        actual_int = int(actual or 0)
        if actual_int != expected:
            mismatches.append((table, expected, actual_int))
        print(f"[ok] {table}: D1={expected} Turso={actual_int}")

    fk_check = turso_pipeline([("PRAGMA foreign_key_check", [])])[0]
    fk_rows = fk_check.get("rows") or []
    if fk_rows:
        print(
            f"[aviso] O Turso reportou {len(fk_rows)} divergências de FK já presentes nos dados copiados.",
            file=sys.stderr,
        )

    if mismatches:
        print("Divergências encontradas:", mismatches, file=sys.stderr)
        raise SystemExit(2)

    print("MIGRACAO_TURSO_OK")


if __name__ == "__main__":
    main()
