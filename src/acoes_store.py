from __future__ import annotations

from typing import Any
from uuid import uuid4

import pandas as pd

from src.persistencia import carregar_json, salvar_json
from src.tratamento import preparar_acoes


ACOES_PADRAO = {"acoes": []}


def carregar_acoes_extra_raw() -> list[dict[str, Any]]:
    dados = carregar_json("acoes_promocionais_extra", ACOES_PADRAO)
    if not isinstance(dados, dict):
        return []
    acoes = dados.get("acoes", [])
    return [acao for acao in acoes if isinstance(acao, dict)] if isinstance(acoes, list) else []


def salvar_acoes_extra_raw(acoes: list[dict[str, Any]]) -> None:
    salvar_json("acoes_promocionais_extra", {"acoes": acoes}, "Atualiza ações promocionais pelo painel")


def carregar_acoes_extra() -> pd.DataFrame:
    acoes = carregar_acoes_extra_raw()
    if not acoes:
        return preparar_acoes(pd.DataFrame())
    base = preparar_acoes(pd.DataFrame(acoes))
    ids = [acao.get("id", "") for acao in acoes]
    base["id_acao"] = ids[: len(base)] if len(ids) >= len(base) else ""
    base["origem_acao"] = "Cadastro painel"
    return base


def adicionar_acoes_extra(df: pd.DataFrame) -> int:
    base = preparar_acoes(df)
    if base.empty:
        return 0
    atuais = carregar_acoes_extra_raw()
    for _, linha in base.iterrows():
        item = linha.to_dict()
        item["id"] = str(uuid4())
        item["data_inicio"] = linha.get("data_inicio").isoformat() if pd.notna(linha.get("data_inicio")) else ""
        item["data_fim"] = linha.get("data_fim").isoformat() if pd.notna(linha.get("data_fim")) else ""
        atuais.append(item)
    salvar_acoes_extra_raw(atuais)
    return len(base)


def excluir_acao_extra(acao_id: str) -> None:
    atuais = carregar_acoes_extra_raw()
    salvar_acoes_extra_raw([acao for acao in atuais if str(acao.get("id", "")) != str(acao_id)])
