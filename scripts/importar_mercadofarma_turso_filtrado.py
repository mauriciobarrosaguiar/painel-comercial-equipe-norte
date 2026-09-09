from __future__ import annotations

from scripts import importar_mercadofarma_d1 as legacy
from scripts import turso_backend as turso


if not turso.configured():
    raise RuntimeError("Turso não configurado para sincronizar o Mercado Farma.")

legacy.localizar_database_id = turso.database_id
legacy.executar = turso.executar
legacy.executar_lotes = turso.executar_lotes

from scripts import importar_mercadofarma_d1_filtrado as filtrado


if __name__ == "__main__":
    filtrado.sincronizar()
