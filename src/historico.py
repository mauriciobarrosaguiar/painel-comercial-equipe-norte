from __future__ import annotations

from copy import deepcopy
from typing import Any

import pandas as pd

from src.datas import hoje_brasilia
from src.persistencia import carregar_json, salvar_json
from src.tratamento import CHAVES_DEDUP_PEDIDOS, padronizar_colunas


METAS_HISTORICO_PADRAO = {"meses": {}}
CHAVES_META = ["ol_sem_combate", "ol_prioritarios", "ol_lancamentos", "clientes_positivados"]
CHAVES_META_OPCIONAIS = ["demanda_sem_combate"]


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


def _numero(valor: object) -> float:
    try:
        numero = float(valor or 0)
    except (TypeError, ValueError):
        return 0.0
    return numero if pd.notna(numero) else 0.0


def _normalizar_meta(meta: dict[str, object] | None) -> dict[str, float]:
    meta = meta or {}
    normalizada = {chave: _numero(meta.get(chave, 0)) for chave in CHAVES_META}
    for chave in CHAVES_META_OPCIONAIS:
        if chave in meta:
            normalizada[chave] = _numero(meta.get(chave, 0))
    return normalizada


def _periodos_fechados(vendas: pd.DataFrame, metas_historico: dict[str, Any]) -> list[str]:
    coluna_data = "data_de_faturamento" if vendas is not None and "data_de_faturamento" in vendas.columns else "data_base"
    if vendas is None or vendas.empty or coluna_data not in vendas.columns:
        return []
    datas = pd.to_datetime(vendas[coluna_data], errors="coerce").dropna()
    if datas.empty:
        return []

    mes_atual = pd.Timestamp(hoje_brasilia()).to_period("M")
    mes_anterior = mes_atual - 1
    periodos_dados = {str(periodo) for periodo in datas.dt.to_period("M") if periodo < mes_atual}
    meses_salvos = set(metas_historico.get("meses", {}).keys()) if isinstance(metas_historico.get("meses"), dict) else set()
    meses_alvo = ({str(mes_anterior)} & periodos_dados) | (periodos_dados & meses_salvos)
    return sorted(meses_alvo)


def sincronizar_metas_historico_meses_fechados(
    vendas: pd.DataFrame,
    metas_atuais: dict[str, Any],
    meses: list[str] | None = None,
) -> dict[str, object]:
    metas_historico = carregar_metas_historico()
    meses_alvo = meses or _periodos_fechados(vendas, metas_historico)
    if not meses_alvo:
        return {"meses_atualizados": [], "alterado": False}

    alterado = False
    metas_consultores = metas_atuais.get("consultores", {}) if isinstance(metas_atuais.get("consultores"), dict) else {}
    for mes in sorted(set(meses_alvo)):
        meta_mes = metas_historico.setdefault("meses", {}).setdefault(mes, meta_padrao_mes())
        if not isinstance(meta_mes, dict):
            meta_mes = meta_padrao_mes()
            metas_historico["meses"][mes] = meta_mes

        if not isinstance(meta_mes.get("gerente_territorial"), dict) or not any(
            _numero(meta_mes["gerente_territorial"].get(chave, 0)) for chave in CHAVES_META
        ):
            meta_mes["gerente_territorial"] = _normalizar_meta(metas_atuais.get("gerente_territorial", {}))
            alterado = True

        consultores_mes = meta_mes.setdefault("consultores", {})
        if isinstance(metas_consultores, dict):
            for consultor, meta in metas_consultores.items():
                if consultor not in consultores_mes:
                    consultores_mes[consultor] = _normalizar_meta(meta)
                    alterado = True

    if alterado:
        salvar_metas_historico(metas_historico)
    return {"meses_atualizados": sorted(set(meses_alvo)), "alterado": alterado}


def metas_para_periodo(metas_atuais: dict[str, Any], filtros: dict[str, object]) -> dict[str, Any]:
    if not filtros.get("usar_metas_historicas"):
        return metas_atuais
    ano_mes = str(filtros.get("mes_referencia") or "")
    if not ano_mes:
        return metas_atuais

    meta_mes = carregar_metas_historico().get("meses", {}).get(ano_mes, {})
    if not isinstance(meta_mes, dict):
        return metas_atuais

    metas = deepcopy(metas_atuais)
    if isinstance(meta_mes.get("gerente_territorial"), dict):
        metas["gerente_territorial"] = _normalizar_meta(meta_mes["gerente_territorial"])
    if isinstance(meta_mes.get("consultores"), dict):
        metas.setdefault("consultores", {})
        for consultor, meta in meta_mes["consultores"].items():
            if isinstance(meta, dict):
                metas["consultores"][str(consultor)] = _normalizar_meta(meta)
    return metas


def combinar_bases_bussola_historico(base_importacao: pd.DataFrame, base_historico: pd.DataFrame) -> pd.DataFrame:
    partes = [df for df in [base_historico, base_importacao] if df is not None and not df.empty]
    if not partes:
        return pd.DataFrame()

    combinado = pd.concat(partes, ignore_index=True)
    base = padronizar_colunas(combinado)
    chaves = [coluna for coluna in CHAVES_DEDUP_PEDIDOS if coluna in base.columns]
    if len(chaves) != len(CHAVES_DEDUP_PEDIDOS):
        return combinado

    chave_texto = base[chaves].astype("string").fillna("")
    mascara_chave_vazia = chave_texto.eq("").all(axis=1)
    deduplicado = base.loc[~mascara_chave_vazia].drop_duplicates(chaves, keep="last")
    sem_chave = base.loc[mascara_chave_vazia]
    return pd.concat([deduplicado, sem_chave], ignore_index=True)
