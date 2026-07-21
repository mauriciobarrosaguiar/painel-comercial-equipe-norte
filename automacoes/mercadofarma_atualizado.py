from __future__ import annotations

from src import mercado_farma as mercado_farma_core
from src.mercadofarma_parser_atual import processar_ean_catalogo_atualizado

mercado_farma_core.processar_ean_catalogo = processar_ean_catalogo_atualizado

from automacoes.mercadofarma import main


if __name__ == '__main__':
    raise SystemExit(main())
