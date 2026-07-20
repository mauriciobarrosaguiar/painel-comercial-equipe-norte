from __future__ import annotations

from scripts import importar_mercadofarma_d1 as legacy


def eans_ativos(database_id: str) -> set[str]:
    dados = legacy.executar(
        database_id,
        """
        SELECT ean
          FROM produtos
         WHERE mercado_farma_ativo = 1
           AND ativo = 1
           AND TRIM(COALESCE(ean, '')) <> ''
        """,
    )
    resultados = dados.get("result") or []
    linhas = (resultados[0] or {}).get("results") if resultados else []
    return {
        legacy.texto(item.get("ean"))
        for item in (linhas or [])
        if legacy.texto(item.get("ean"))
    }


def sincronizar() -> None:
    database_id = legacy.localizar_database_id()
    permitidos = eans_ativos(database_id)
    if not permitidos:
        raise RuntimeError(
            "A base Produtos do Mercado Farma está vazia. "
            "Importe os EANs pela Administração antes de sincronizar."
        )

    base = legacy.carregar_base()
    base = base[base["EAN"].isin(permitidos)].copy()
    if base.empty:
        raise RuntimeError(
            "O consolidado do Mercado Farma não contém nenhum EAN "
            "presente na lista oficial de produtos."
        )

    legacy.carregar_base = lambda: base.copy()
    legacy.localizar_database_id = lambda: database_id
    legacy.sincronizar()


if __name__ == "__main__":
    sincronizar()
