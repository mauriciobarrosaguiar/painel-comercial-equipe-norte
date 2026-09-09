from __future__ import annotations

from scripts import extrair_bussola_d1 as legacy
from scripts import turso_backend as turso


if not turso.configured():
    raise RuntimeError("Turso não configurado para a extração do Bússola.")

legacy.localizar_database_id = turso.database_id
legacy.executar = turso.executar
legacy.executar_lotes = turso.executar_lotes

from scripts import extrair_bussola_d1_corrigido as corrigido


if __name__ == "__main__":
    corrigido.sincronizar()
