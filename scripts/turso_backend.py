from __future__ import annotations

import base64
import os
import time
from typing import Any, Iterable

import requests


def configured() -> bool:
    return bool(
        str(os.environ.get("TURSO_DATABASE_URL", "") or "").strip()
        and str(os.environ.get("TURSO_AUTH_TOKEN", "") or "").strip()
    )


def database_id() -> str:
    if not configured():
        raise RuntimeError("Credenciais Turso não configuradas.")
    return "turso"


def _url() -> str:
    raw = str(os.environ.get("TURSO_DATABASE_URL", "") or "").strip()
    if raw.startswith("libsql://"):
        raw = "https://" + raw[len("libsql://") :]
    elif raw.startswith("turso://"):
        raw = "https://" + raw[len("turso://") :]
    if not raw.startswith("https://"):
        raise RuntimeError("TURSO_DATABASE_URL inválida.")
    return raw.rstrip("/") + "/v2/pipeline"


def _headers() -> dict[str, str]:
    token = str(os.environ.get("TURSO_AUTH_TOKEN", "") or "").strip()
    if not token:
        raise RuntimeError("TURSO_AUTH_TOKEN ausente.")
    return {
        "authorization": f"Bearer {token}",
        "content-type": "application/json",
        "accept": "application/json",
    }


def _arg(value: Any) -> dict[str, Any]:
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": "1" if value else "0"}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "float", "value": value}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {
            "type": "blob",
            "base64": base64.b64encode(bytes(value)).decode("ascii"),
        }
    return {"type": "text", "value": str(value)}


def _value(cell: Any) -> Any:
    if not isinstance(cell, dict) or cell.get("type") == "null":
        return None
    kind = cell.get("type")
    if kind == "integer":
        raw = str(cell.get("value") or "0")
        try:
            return int(raw)
        except ValueError:
            return raw
    if kind == "float":
        try:
            return float(cell.get("value"))
        except (TypeError, ValueError):
            return 0.0
    if kind == "blob":
        return base64.b64decode(str(cell.get("base64") or ""))
    return cell.get("value", "")


def _decode_result(result: dict[str, Any]) -> dict[str, Any]:
    columns = [str(item.get("name") or "") for item in (result.get("cols") or [])]
    rows: list[dict[str, Any]] = []
    for raw_row in result.get("rows") or []:
        row = {
            column: _value(raw_row[index]) if index < len(raw_row) else None
            for index, column in enumerate(columns)
        }
        rows.append(row)
    return {
        "success": True,
        "results": rows,
        "meta": {
            "changes": int(result.get("affected_row_count") or 0),
            "last_row_id": result.get("last_insert_rowid"),
            "rows_read": int(result.get("rows_read") or 0),
            "rows_written": int(result.get("rows_written") or result.get("affected_row_count") or 0),
        },
    }


def _pipeline(statements: list[tuple[str, list[Any]]]) -> list[dict[str, Any]]:
    requests_payload: list[dict[str, Any]] = []
    for sql, params in statements:
        stmt: dict[str, Any] = {"sql": str(sql)}
        if params:
            stmt["args"] = [_arg(value) for value in params]
        requests_payload.append({"type": "execute", "stmt": stmt})
    requests_payload.append({"type": "close"})

    last_error = ""
    for attempt in range(1, 6):
        response = requests.post(
            _url(),
            headers=_headers(),
            json={"requests": requests_payload},
            timeout=120,
        )
        if response.status_code == 429 or response.status_code >= 500:
            last_error = f"HTTP {response.status_code}: {response.text[:500]}"
            time.sleep(min(2**attempt, 20))
            continue
        try:
            payload = response.json()
        except ValueError as exc:
            raise RuntimeError(
                f"Resposta inválida do Turso: HTTP {response.status_code}"
            ) from exc
        if not response.ok:
            raise RuntimeError(
                f"Falha no Turso: HTTP {response.status_code} - {payload}"
            )

        results = payload.get("results") or []
        decoded: list[dict[str, Any]] = []
        for index in range(len(statements)):
            item = results[index] if index < len(results) else None
            if not isinstance(item, dict) or item.get("type") != "ok":
                detail = (item or {}).get("error") if isinstance(item, dict) else item
                raise RuntimeError(
                    f"Turso não concluiu a instrução {index + 1}: {detail or item}"
                )
            response_item = item.get("response") or {}
            if response_item.get("type") != "execute":
                raise RuntimeError(
                    f"Resposta inesperada do Turso na instrução {index + 1}: {response_item}"
                )
            decoded.append(_decode_result(response_item.get("result") or {}))
        return decoded

    raise RuntimeError(f"Falha temporária repetida no Turso: {last_error}")


def executar(
    _database_id: str,
    sql: str,
    params: Iterable[Any] | None = None,
) -> dict[str, Any]:
    result = _pipeline([(sql, list(params or []))])[0]
    return {"success": True, "result": [result]}


def executar_lotes(
    _database_id: str,
    consultas: list[dict[str, Any]],
    tamanho: int = 20,
) -> None:
    for inicio in range(0, len(consultas), tamanho):
        bloco = consultas[inicio : inicio + tamanho]
        statements = [
            (str(item["sql"]), list(item.get("params") or []))
            for item in bloco
        ]
        _pipeline(statements)


def linhas(dados: dict[str, Any]) -> list[dict[str, Any]]:
    result = dados.get("result") or []
    if not result:
        return []
    return list((result[0] or {}).get("results") or [])
