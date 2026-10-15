from __future__ import annotations

from src.mercadofarma_inventory import processar_ean_catalogo


def processar_ean_catalogo_atualizado(driver, ean: str) -> list[dict]:
    """
    Compatibilidade do fluxo atual: toda a leitura do Mercado Farma fica
    centralizada no parser V8 portado para mercadofarma_inventory.
    """
    return processar_ean_catalogo(driver, ean)
