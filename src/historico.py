from __future__ import annotations

from typing import Any

from src.persistencia import carregar_json, salvar_json


METAS_HISTORICO_PADRAO = {"meses": {}}


def carregar_metas_historico() -> dict[str, Any]:
    dados = carregar_json("metas_historico", METAS_HISTORICO_PADRAO)
    if not isinstance(dados, dict):
        dados = METAS_HISTORICO_PADRAO.copy()
    dados.setdefault("meses", {})
    return dados


def salvar_metas_historico(dados: dict[str, Any]) -> None:
    dados.setdefault("meses", {})
    salvar_json("metas_historico", dados, "Atualiza metas históricas pelo painel")


def meta_padrao_mes() -> dict[str, Any]:
    return {
        "gerente_territorial": {
            "ol_sem_combate": 0.0,
            "ol_prioritarios": 0.0,
            "ol_lancamentos": 0.0,
            "clientes_positivados": 0.0,
        },
        "consultores": {},
    }
