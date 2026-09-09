from __future__ import annotations

from scripts import identificar_desafio_gigantes_sap as desafio
from scripts import turso_backend as turso


if not turso.configured():
    raise RuntimeError("Turso não configurado para o Desafio de Gigantes.")


def query(_db: str, sql: str, params: list | None = None) -> list[dict]:
    return turso.linhas(turso.executar(turso.database_id(), sql, params or []))


def execute(_db: str, sql: str, params: list | None = None) -> None:
    turso.executar(turso.database_id(), sql, params or [])


desafio.database_id = turso.database_id
desafio.query = query
desafio.execute = execute


if __name__ == "__main__":
    raise SystemExit(desafio.main())
