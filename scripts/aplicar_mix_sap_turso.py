from __future__ import annotations

from scripts import extrair_bussola_d1 as legacy
from scripts import turso_backend as turso


if not turso.configured():
    raise RuntimeError("Turso não configurado para aplicar o MIX.")

legacy.localizar_database_id = turso.database_id
legacy.executar = turso.executar
legacy.executar_lotes = turso.executar_lotes

from scripts import aplicar_mix_sap_d1 as aplicar


if __name__ == "__main__":
    aplicar.main()
