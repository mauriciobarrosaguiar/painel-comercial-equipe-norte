from __future__ import annotations

import pandas as pd

from src.calculos import calcular_indicadores, calcular_resumo_operacional
from src.tratamento import normalizar_data_iso, normalizar_tipo_mix


def _vendas_conhecidas() -> pd.DataFrame:
    vendas = pd.DataFrame(
        [
            {"status_normalizado": "FATURADO", "tipo_mix": "LINHA", "valor_vendido_sem_imposto": 100.0, "cnpj_limpo": "1", "pedido_id": "p1"},
            {"status_normalizado": "FATURADO", "tipo_mix": "PRIORITARIO", "valor_vendido_sem_imposto": 50.0, "cnpj_limpo": "1", "pedido_id": "p1"},
            {"status_normalizado": "FATURADO", "tipo_mix": "LANCAMENTO", "valor_vendido_sem_imposto": 25.0, "cnpj_limpo": "2", "pedido_id": "p2"},
            {"status_normalizado": "FATURADO", "tipo_mix": "COMBATE", "valor_vendido_sem_imposto": 40.0, "cnpj_limpo": "3", "pedido_id": "p3"},
            {"status_normalizado": "FATURADO", "tipo_mix": "SEM CLASSIFICACAO", "valor_vendido_sem_imposto": 10.0, "cnpj_limpo": "4", "pedido_id": "p4"},
            {"status_normalizado": "CANCELADO", "tipo_mix": "LINHA", "valor_vendido_sem_imposto": 999.0, "cnpj_limpo": "5", "pedido_id": "p5"},
        ]
    )
    vendas["nota_fiscal"] = "NF"
    return vendas


def test_data_iso_nao_inverte_mes_e_dia() -> None:
    assert normalizar_data_iso("2026-07-12") == "2026-07-12"
    assert normalizar_data_iso("12/07/2026") == "2026-07-12"
    assert normalizar_data_iso("2026-07-20T08:30:00") == "2026-07-20"


def test_sem_combate_nao_e_classificado_como_combate() -> None:
    assert normalizar_tipo_mix("SEM COMBATE") == "LINHA"
    assert normalizar_tipo_mix("não combate") == "LINHA"
    assert normalizar_tipo_mix("sem combate prioritários") == "PRIORITARIO"
    assert normalizar_tipo_mix("COMBATE") == "COMBATE"


def test_indicadores_excluem_cancelado_e_nao_inventam_classificacao() -> None:
    vendas = _vendas_conhecidas()
    indicadores = calcular_indicadores(vendas)
    operacional = calcular_resumo_operacional(vendas)

    assert indicadores["ol_sem_combate"] == 175.0
    assert indicadores["ol_prioritarios"] == 50.0
    assert indicadores["ol_lancamentos"] == 25.0
    assert indicadores["clientes_positivados"] == 4
    assert operacional["valor_combate"] == 40.0
    assert operacional["faturado_periodo"] == 225.0
