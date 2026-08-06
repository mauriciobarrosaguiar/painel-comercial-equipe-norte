from __future__ import annotations

import pandas as pd
import pytest

from scripts.extrair_bussola_contingencia import (
    extrair_com_contingencia,
    tem_dados_mes_atual,
)


AGORA = pd.Timestamp("2026-08-06 10:00:00", tz="America/Sao_Paulo")


def base(data: str, pedido: str) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "pedido_id": [pedido],
            "data_do_pedido": [data],
            "data_de_faturamento": [data],
        }
    )


def test_identifica_dados_do_mes_atual() -> None:
    assert tem_dados_mes_atual(base("05/08/2026", "1"), agora=AGORA)
    assert not tem_dados_mes_atual(base("31/07/2026", "2"), agora=AGORA)


def test_mantem_extracao_da_gd_quando_ela_traz_mes_atual() -> None:
    chamadas: list[str] = []

    def extrair(usuario: str, _segredo: str) -> pd.DataFrame:
        chamadas.append(usuario)
        return base("05/08/2026", "gd-1")

    resultado, modo, detalhes = extrair_com_contingencia(
        {
            "gd": {"usuario": "gd", "segredo": "senha"},
            "consultores": [
                {"consultor_id": "c1", "nome": "Consultor 1", "usuario": "c1", "segredo": "s1"}
            ],
        },
        extrair,
        agora=AGORA,
    )

    assert modo == "gd"
    assert detalhes["consultores_extraidos"] == 0
    assert chamadas == ["gd"]
    assert len(resultado) == 1


def test_usa_todos_consultores_quando_gd_nao_traz_mes_atual() -> None:
    chamadas: list[str] = []

    def extrair(usuario: str, _segredo: str) -> pd.DataFrame:
        chamadas.append(usuario)
        if usuario == "gd":
            return base("31/07/2026", "gd-antigo")
        if usuario == "c1":
            return base("02/08/2026", "c1-atual")
        return base("30/07/2026", "c2-antigo")

    resultado, modo, detalhes = extrair_com_contingencia(
        {
            "gd": {"usuario": "gd", "segredo": "senha"},
            "consultores": [
                {"consultor_id": "c1", "nome": "Consultor 1", "usuario": "c1", "segredo": "s1"},
                {"consultor_id": "c2", "nome": "Consultor 2", "usuario": "c2", "segredo": "s2"},
            ],
            "consultores_esperados": [
                {"id": "c1", "nome": "Consultor 1"},
                {"id": "c2", "nome": "Consultor 2"},
            ],
        },
        extrair,
        agora=AGORA,
    )

    assert modo == "consultores"
    assert detalhes["consultores_extraidos"] == 2
    assert chamadas == ["gd", "c1", "c2"]
    assert len(resultado) == 2
    assert set(resultado["_credencial_origem"]) == {"Consultor 1", "Consultor 2"}


def test_preserva_base_anterior_quando_falta_credencial() -> None:
    def extrair(usuario: str, _segredo: str) -> pd.DataFrame:
        assert usuario == "gd"
        return base("31/07/2026", "gd-antigo")

    with pytest.raises(RuntimeError, match="Faltam os acessos de: Consultor 2"):
        extrair_com_contingencia(
            {
                "gd": {"usuario": "gd", "segredo": "senha"},
                "consultores": [
                    {"consultor_id": "c1", "nome": "Consultor 1", "usuario": "c1", "segredo": "s1"}
                ],
                "consultores_esperados": [
                    {"id": "c1", "nome": "Consultor 1"},
                    {"id": "c2", "nome": "Consultor 2"},
                ],
            },
            extrair,
            agora=AGORA,
        )
