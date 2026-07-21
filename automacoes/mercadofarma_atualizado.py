from __future__ import annotations

import pandas as pd

from src import mercado_farma as mercado_farma_core
from src.mercadofarma_parser_atual import processar_ean_catalogo_atualizado


def _cliente_ativo(valor: object) -> bool:
    if valor is None or pd.isna(valor):
        return True
    if isinstance(valor, bool):
        return valor
    if isinstance(valor, (int, float)):
        return valor != 0
    return str(valor).strip().upper() not in {"0", "FALSE", "F", "NAO", "NÃO", "N", "INATIVO"}


_alvos_mercadofarma_por_uf_original = mercado_farma_core.alvos_mercadofarma_por_uf


def _alvos_mercadofarma_por_uf_seguro(clientes, usuario_gd: str, senha_gd: str):
    base = clientes.copy()
    if "cliente_ativo" in base.columns:
        base["cliente_ativo"] = base["cliente_ativo"].map(_cliente_ativo).astype(bool)
    return _alvos_mercadofarma_por_uf_original(base, usuario_gd, senha_gd)


mercado_farma_core.processar_ean_catalogo = processar_ean_catalogo_atualizado
mercado_farma_core.alvos_mercadofarma_por_uf = _alvos_mercadofarma_por_uf_seguro

from automacoes.mercadofarma import main


if __name__ == '__main__':
    raise SystemExit(main())
