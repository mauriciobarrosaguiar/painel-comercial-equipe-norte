from __future__ import annotations

from scripts import importar_mercadofarma_d1 as d1
from scripts import turso_backend as turso


if not turso.configured():
    raise RuntimeError("Turso não configurado para a extração do Mercado Farma.")

d1.localizar_database_id = turso.database_id
d1.executar = turso.executar
d1.executar_lotes = turso.executar_lotes

from automacoes.mercadofarma_atualizado import main


if __name__ == "__main__":
    raise SystemExit(main())
