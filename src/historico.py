from __future__ import annotations

from copy import deepcopy
import json
from typing import Any

import pandas as pd

from src.calculos import calcular_indicadores, calcular_resumo_operacional, gerar_resultado_consultor
from src.datas import agora_brasilia, hoje_brasilia
from src.persistencia import carregar_json, salvar_json


HISTORICO_PADRAO = {"versao": 1, "meses": {}}

CHAVES_META = [
    "ol_sem_combate",
    "ol_prioritarios",
    "ol_lancamentos",
    "clientes_positivados",
]

CHAVES_META_OPCIONAIS = ["demanda_sem_combate"]

CHAVES_RESULTADO = [
    "ol_sem_combate",
    "ol_prioritarios",
    "ol_lancamentos",
    "clientes_positivados",
    "clientes_sem_compra",
    "clientes_na_base",
    "positivacao_percentual",
    "percentual_prioritarios",
    "percentual_lancamentos",
    "quantidade_pedidos",
    "ticket_medio",
    "faturado_periodo",
]


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


def _normalizar_historico(dados: Any) -> dict[str, Any]:
    if not isinstance(dados, dict):
        return deepcopy(HISTORICO_PADRAO)
    dados.setdefault("versao", 1)
    meses = dados.get("meses")
    if not isinstance(meses, dict):
        dados["meses"] = {}
    return dados


def carregar_historico() -> dict[str, Any]:
    return _normalizar_historico(carregar_json("historico_vendas", HISTORICO_PADRAO))


def salvar_historico(dados: dict[str, Any]) -> None:
    salvar_json("historico_vendas", _normalizar_historico(dados), "Atualiza historico de vendas pelo painel")


def _nome_gd(clientes: pd.DataFrame) -> str:
    if clientes is None or clientes.empty or "nome_gd" not in clientes.columns:
        return "Gerente Distrital"
    nomes = clientes["nome_gd"].dropna().astype(str).str.strip()
    nomes = nomes[nomes.ne("")]
    return nomes.iloc[0] if not nomes.empty else "Gerente Distrital"


def _periodos_fechados(vendas: pd.DataFrame, historico: dict[str, Any]) -> list[str]:
    if vendas is None or vendas.empty or "data_base" not in vendas.columns:
        return []
    datas = pd.to_datetime(vendas["data_base"], errors="coerce").dropna()
    if datas.empty:
        return []
    mes_atual = pd.Timestamp(hoje_brasilia()).to_period("M")
    mes_anterior = mes_atual - 1
    periodos = datas.dt.to_period("M")
    periodos_dados = {str(periodo) for periodo in periodos if periodo < mes_atual}
    meses_historicos = set(historico.get("meses", {}).keys()) if isinstance(historico.get("meses"), dict) else set()
    meses_alvo = {str(mes_anterior)} & periodos_dados
    meses_alvo.update(periodos_dados & meses_historicos)
    return sorted(meses_alvo)


def _vendas_do_mes(vendas: pd.DataFrame, ano_mes: str) -> pd.DataFrame:
    datas = pd.to_datetime(vendas.get("data_base"), errors="coerce")
    return vendas[datas.dt.to_period("M").astype(str).eq(ano_mes)].copy()


def _resultado_gd(vendas_mes: pd.DataFrame, clientes: pd.DataFrame) -> dict[str, float]:
    indicadores = calcular_indicadores(vendas_mes, clientes)
    resumo = calcular_resumo_operacional(vendas_mes, clientes)
    resultado = {chave: _numero(indicadores.get(chave, 0)) for chave in CHAVES_RESULTADO}
    resultado["faturado_periodo"] = _numero(resumo.get("faturado_periodo", 0))
    resultado["clientes_na_base"] = _numero(indicadores.get("clientes_ativos", 0))
    return resultado


def _resultado_consultor(linha: pd.Series) -> dict[str, float]:
    clientes_positivados = _numero(linha.get("clientes_com_compra", 0))
    return {
        "ol_sem_combate": _numero(linha.get("ol_sem_combate", 0)),
        "ol_prioritarios": _numero(linha.get("ol_prioritarios", 0)),
        "ol_lancamentos": _numero(linha.get("ol_lancamentos", 0)),
        "clientes_positivados": clientes_positivados,
        "clientes_sem_compra": _numero(linha.get("clientes_sem_compra", 0)),
        "clientes_na_base": _numero(linha.get("clientes_na_base", 0)),
        "positivacao_percentual": _numero(linha.get("positivacao_percentual", 0)),
        "percentual_prioritarios": _numero(linha.get("percentual_prioritarios", 0)),
        "percentual_lancamentos": _numero(linha.get("percentual_lancamentos", 0)),
        "quantidade_pedidos": _numero(linha.get("quantidade_pedidos", 0)),
        "ticket_medio": _numero(linha.get("ticket_medio", 0)),
        "faturado_periodo": _numero(linha.get("ol_sem_combate", 0)),
    }


def _metas_preservadas(existente: dict[str, Any] | None, meta_atual: dict[str, object] | None) -> dict[str, float]:
    if isinstance(existente, dict) and isinstance(existente.get("metas"), dict):
        return _normalizar_meta(existente.get("metas"))
    return _normalizar_meta(meta_atual)


def sincronizar_historico_meses_fechados(
    vendas: pd.DataFrame,
    clientes: pd.DataFrame,
    metas: dict[str, Any],
    meses: list[str] | None = None,
) -> dict[str, Any]:
    historico = carregar_historico()
    meses_alvo = meses or _periodos_fechados(vendas, historico)
    if not meses_alvo:
        return {"meses_atualizados": [], "linhas_atualizadas": 0, "alterado": False}

    antes = json.dumps(historico, sort_keys=True, ensure_ascii=False)
    atualizado_em = agora_brasilia().isoformat()
    linhas_atualizadas = 0

    for ano_mes in sorted(set(meses_alvo)):
        vendas_mes = _vendas_do_mes(vendas, ano_mes)
        if vendas_mes.empty:
            continue

        mes_item = historico["meses"].setdefault(ano_mes, {"consultores": {}})
        mes_item.setdefault("consultores", {})
        mes_item["mes"] = ano_mes
        mes_item["atualizado_em"] = atualizado_em

        gd_existente = mes_item.get("gd") if isinstance(mes_item.get("gd"), dict) else {}
        mes_item["gd"] = {
            "nome": _nome_gd(clientes),
            "metas": _metas_preservadas(gd_existente, metas.get("gerente_territorial", {})),
            "resultado": _resultado_gd(vendas_mes, clientes),
        }
        linhas_atualizadas += 1

        resultado_consultores = gerar_resultado_consultor(vendas_mes, clientes)
        metas_consultores = metas.get("consultores", {}) if isinstance(metas.get("consultores"), dict) else {}
        consultores_historico: dict[str, Any] = mes_item["consultores"]
        for _, linha in resultado_consultores.iterrows():
            nome = str(linha.get("consultor", "") or "SEM CONSULTOR")
            existente = consultores_historico.get(nome) if isinstance(consultores_historico.get(nome), dict) else {}
            consultores_historico[nome] = {
                "nome": nome,
                "metas": _metas_preservadas(existente, metas_consultores.get(nome, {})),
                "resultado": _resultado_consultor(linha),
            }
            linhas_atualizadas += 1

    depois = json.dumps(historico, sort_keys=True, ensure_ascii=False)
    alterado = antes != depois
    if alterado:
        salvar_historico(historico)

    return {
        "meses_atualizados": sorted(set(meses_alvo)),
        "linhas_atualizadas": linhas_atualizadas,
        "alterado": alterado,
    }


def metas_para_periodo(metas_atuais: dict[str, Any], filtros: dict[str, object]) -> dict[str, Any]:
    if not filtros.get("usar_metas_historicas"):
        return metas_atuais
    ano_mes = str(filtros.get("mes_referencia") or "")
    if not ano_mes:
        return metas_atuais

    mes_item = carregar_historico().get("meses", {}).get(ano_mes, {})
    if not isinstance(mes_item, dict):
        return metas_atuais

    metas = deepcopy(metas_atuais)
    metas.setdefault("gerente_territorial", {})
    metas.setdefault("consultores", {})

    gd = mes_item.get("gd", {})
    if isinstance(gd, dict) and isinstance(gd.get("metas"), dict):
        metas["gerente_territorial"] = _normalizar_meta(gd.get("metas"))

    consultores = mes_item.get("consultores", {})
    if isinstance(consultores, dict):
        for nome, item in consultores.items():
            if isinstance(item, dict) and isinstance(item.get("metas"), dict):
                metas["consultores"][str(nome)] = _normalizar_meta(item.get("metas"))
    return metas


def historico_dataframe() -> pd.DataFrame:
    historico = carregar_historico()
    linhas: list[dict[str, object]] = []
    for ano_mes, mes_item in sorted(historico.get("meses", {}).items()):
        if not isinstance(mes_item, dict):
            continue
        gd = mes_item.get("gd", {})
        if isinstance(gd, dict):
            linhas.append(_linha_dataframe(ano_mes, "GD", gd.get("nome", "Gerente Distrital"), gd, mes_item.get("atualizado_em")))
        consultores = mes_item.get("consultores", {})
        if isinstance(consultores, dict):
            for nome, item in sorted(consultores.items()):
                if isinstance(item, dict):
                    linhas.append(_linha_dataframe(ano_mes, "Consultor", nome, item, mes_item.get("atualizado_em")))
    return pd.DataFrame(linhas)


def _linha_dataframe(ano_mes: str, escopo: str, nome: object, item: dict[str, Any], atualizado_em: object) -> dict[str, object]:
    metas = _normalizar_meta(item.get("metas") if isinstance(item.get("metas"), dict) else {})
    resultado = item.get("resultado", {}) if isinstance(item.get("resultado"), dict) else {}
    linha = {
        "mes": ano_mes,
        "escopo": escopo,
        "nome": str(nome or ""),
        "atualizado_em": atualizado_em,
    }
    for chave in CHAVES_META:
        linha[f"meta_{chave}"] = metas.get(chave, 0)
    for chave in CHAVES_RESULTADO:
        linha[chave] = _numero(resultado.get(chave, 0))
    return linha
