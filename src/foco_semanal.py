from __future__ import annotations

from typing import Any

from src.persistencia import carregar_json, salvar_json


FOCO_PADRAO = {"acoes": []}


def carregar_foco_semanal() -> dict[str, Any]:
    dados = carregar_json("foco_semanal", FOCO_PADRAO)
    if not isinstance(dados, dict):
        dados = FOCO_PADRAO.copy()
    acoes = dados.get("acoes", [])
    if not isinstance(acoes, list):
        acoes = []
    dados["acoes"] = [acao for acao in acoes if isinstance(acao, dict)]
    return dados


def salvar_foco_semanal(dados: dict[str, Any]) -> None:
    dados.setdefault("acoes", [])
    salvar_json("foco_semanal", dados, "Atualiza Foco Semanal pelo painel")
