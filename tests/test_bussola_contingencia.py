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
            "nota_fiscal": ["1"],
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
    assert detalhes["visibilidade"] == "equipe"
    assert chamadas == ["gd"]
    assert len(resultado) == 1


def test_publica_parcialmente_quem_ja_cadastrou() -> None:
    chamadas: list[str] = []

    def extrair(usuario: str, _segredo: str) -> pd.DataFrame:
        chamadas.append(usuario)
        if usuario == "gd":
            return base("31/07/2026", "gd-antigo")
        return base("02/08/2026", "c1-atual")

    resultado, modo, detalhes = extrair_com_contingencia(
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

    assert modo == "consultores_parcial"
    assert detalhes["visibilidade"] == "individual"
    assert detalhes["consultores_ids"] == ["c1"]
    assert detalhes["faltantes"] == ["Consultor 2"]
    assert chamadas == ["gd", "c1"]
    assert len(resultado) == 1
    assert resultado.iloc[0]["_consultor_contingencia_id"] == "c1"


def test_so_consolida_equipe_quando_todos_publicaram_mes_atual() -> None:
    chamadas: list[str] = []

    def extrair(usuario: str, _segredo: str) -> pd.DataFrame:
        chamadas.append(usuario)
        if usuario == "gd":
            return base("31/07/2026", "gd-antigo")
        return base("02/08/2026", f"{usuario}-atual")

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
    assert detalhes["visibilidade"] == "equipe"
    assert detalhes["completa"] is True
    assert set(detalhes["consultores_ids"]) == {"c1", "c2"}
    assert len(resultado) == 2


def test_falha_de_um_consultor_nao_bloqueia_os_demais() -> None:
    def extrair(usuario: str, _segredo: str) -> pd.DataFrame:
        if usuario == "gd":
            return base("31/07/2026", "gd-antigo")
        if usuario == "c2":
            raise RuntimeError("senha inválida")
        return base("02/08/2026", "c1-atual")

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

    assert modo == "consultores_parcial"
    assert len(resultado) == 1
    assert detalhes["consultores_ids"] == ["c1"]
    assert detalhes["falhas"] == ["Consultor 2: senha inválida"]


def test_sem_nenhum_acesso_publicavel_preserva_base() -> None:
    def extrair(usuario: str, _segredo: str) -> pd.DataFrame:
        return base("31/07/2026", usuario)

    with pytest.raises(RuntimeError, match="Nenhum acesso individual trouxe dados válidos"):
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
