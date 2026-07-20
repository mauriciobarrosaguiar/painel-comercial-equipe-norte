from __future__ import annotations

import json
import os

from scripts.migrar_bases_legadas_d1 import main as migrar_bases
from src.persistencia import carregar_bytes


BASES_OBRIGATORIAS = {
    "painel": "Painel Equipe Norte",
    "metas": "Metas Comerciais",
    "produtos_mix": "Produtos / Mix",
    "produtos_mercado_farma": "Produtos do Mercado Farma",
}


def validar_bases() -> dict[str, int]:
    if not str(os.environ.get("PERSISTENCE_KEY", "") or "").strip():
        raise RuntimeError(
            "PERSISTENCE_KEY não foi recebida. Execute a migração pelo painel antigo, "
            "que envia a chave criptográfica automaticamente."
        )

    encontrados: dict[str, int] = {}
    ausentes: list[str] = []
    for chave, titulo in BASES_OBRIGATORIAS.items():
        conteudo = carregar_bytes(chave)
        if not conteudo:
            ausentes.append(titulo)
            continue
        encontrados[chave] = len(conteudo)

    if ausentes:
        raise RuntimeError(
            "Não foi possível abrir as seguintes bases do painel antigo: " + ", ".join(ausentes)
        )

    print("Bases antigas localizadas e descriptografadas:")
    print(json.dumps(encontrados, ensure_ascii=False, indent=2))
    return encontrados


def main() -> None:
    validar_bases()
    migrar_bases()


if __name__ == "__main__":
    main()
