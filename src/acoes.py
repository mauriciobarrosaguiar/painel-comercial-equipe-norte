from __future__ import annotations

import json

import numpy as np
import pandas as pd

from src.tratamento import STATUS_FATURADOS, TIPO_SEM_CLASSIFICACAO


COLUNAS_ANALISE_ACOES = [
    "campanha",
    "produto",
    "ean",
    "tipo_mix",
    "distribuidora",
    "desconto",
    "data_inicio",
    "data_fim",
    "consultor",
    "status",
    "meta_unidades",
    "meta_cnpjs",
    "tipo_meta_unidades",
    "escopo_meta",
    "quantidade_meta_base",
    "quantidade_vendida",
    "cnpjs_positivados",
    "clientes_compradores",
    "falta_unidades",
    "falta_cnpjs",
    "atingimento_unidades",
    "atingimento_cnpjs",
    "atingimento_geral",
    "status_meta",
    "produtos_batidos",
    "produtos_meta",
    "ol_antes_acao",
    "ol_durante_acao",
    "crescimento_percentual",
    "consultor_destaque",
    "distribuidora_destaque",
]

COLUNAS_VENDAS_FOCO = [
    "status_normalizado",
    "ean_limpo",
    "data_base",
    "valor_vendido_sem_imposto",
    "quantidade_base",
    "cnpj_limpo",
    "consultor",
    "distribuidora",
    "tipo_mix",
]


def _texto(valor: object) -> str:
    if valor is None or pd.isna(valor):
        return ""
    return str(valor).strip()


def _numero(valor: object) -> float:
    try:
        numero = float(valor or 0)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if pd.isna(numero) or not np.isfinite(numero) else numero


def _data_chave(valor: object) -> str:
    data = pd.to_datetime(valor, errors="coerce")
    return "" if pd.isna(data) else data.strftime("%Y-%m-%d")


def _unicos_texto(valores: pd.Series) -> list[str]:
    vistos: set[str] = set()
    saida: list[str] = []
    for valor in valores.fillna("").astype(str):
        texto = valor.strip()
        if texto and texto not in vistos:
            vistos.add(texto)
            saida.append(texto)
    return saida


def _juntar(valores: pd.Series, limite: int = 4) -> str:
    itens = _unicos_texto(valores)
    if len(itens) > limite:
        return ", ".join(itens[:limite]) + f" +{len(itens) - limite}"
    return ", ".join(itens)


def _consultores_base(vendas: pd.DataFrame, consultores: list[str] | None) -> list[str]:
    if consultores:
        return sorted({str(nome).strip() for nome in consultores if str(nome).strip()})
    if vendas is None or vendas.empty or "consultor" not in vendas.columns:
        return []
    return sorted({str(nome).strip() for nome in vendas["consultor"].dropna() if str(nome).strip()})


def _parse_meta_consultores(valor: object) -> list[dict[str, object]]:
    texto = _texto(valor)
    if not texto:
        return []
    try:
        dados = json.loads(texto)
    except Exception:
        return []

    itens: list[dict[str, object]] = []
    if isinstance(dados, dict):
        for consultor, meta in dados.items():
            if isinstance(meta, dict):
                item = dict(meta)
            else:
                item = {"meta_unidades": meta}
            item["consultor"] = consultor
            itens.append(item)
    elif isinstance(dados, list):
        itens = [dict(item) for item in dados if isinstance(item, dict)]
    return itens


def _metas_consultores(
    grupo: pd.DataFrame,
    vendas: pd.DataFrame,
    consultores: list[str] | None,
) -> list[dict[str, object]]:
    primeira = grupo.iloc[0]
    meta_unidades = _numero(primeira.get("meta_unidades", 0))
    meta_cnpjs = _numero(primeira.get("meta_cnpjs", 0))
    escopo = _texto(primeira.get("escopo_meta", "PADRAO")).upper() or "PADRAO"
    permitidos = _consultores_base(vendas, consultores)
    permitidos_set = set(permitidos)

    if escopo == "POR_CONSULTOR":
        metas_json = _parse_meta_consultores(primeira.get("meta_consultores", ""))
        metas: list[dict[str, object]] = []
        for item in metas_json:
            nome = _texto(item.get("consultor"))
            if not nome:
                continue
            if permitidos_set and nome not in permitidos_set:
                continue
            ativo = bool(item.get("ativo", True))
            if not ativo:
                continue
            metas.append(
                {
                    "consultor": nome,
                    "meta_unidades": _numero(item.get("meta_unidades", meta_unidades)),
                    "meta_cnpjs": _numero(item.get("meta_cnpjs", meta_cnpjs)),
                    "agregado": False,
                }
            )
        return metas

    consultores_linha = _unicos_texto(grupo.get("consultor", pd.Series(dtype=str)))
    if consultores_linha:
        return [
            {
                "consultor": nome,
                "meta_unidades": meta_unidades,
                "meta_cnpjs": meta_cnpjs,
                "agregado": False,
            }
            for nome in consultores_linha
            if not permitidos_set or nome in permitidos_set
        ]

    if meta_unidades > 0 or meta_cnpjs > 0:
        return [
            {
                "consultor": nome,
                "meta_unidades": meta_unidades,
                "meta_cnpjs": meta_cnpjs,
                "agregado": False,
            }
            for nome in permitidos
        ]

    return [{"consultor": "Todos", "meta_unidades": meta_unidades, "meta_cnpjs": meta_cnpjs, "agregado": True}]


def _chave_grupo(linha: pd.Series) -> str:
    nome = _texto(linha.get("campanha")) or _texto(linha.get("produto")) or _texto(linha.get("ean"))
    partes = [
        nome.upper(),
        _data_chave(linha.get("data_inicio")),
        _data_chave(linha.get("data_fim")),
        _texto(linha.get("escopo_meta")).upper(),
        _texto(linha.get("meta_consultores")),
        _texto(linha.get("consultor")).upper(),
    ]
    return "|".join(partes)


def _vendas_periodo(vendas_produto: pd.DataFrame, data_inicio: pd.Timestamp, data_fim: pd.Timestamp) -> tuple[pd.DataFrame, pd.DataFrame]:
    dias = max((data_fim.normalize() - data_inicio.normalize()).days + 1, 1)
    antes_inicio = data_inicio - pd.Timedelta(days=dias)
    antes_fim = data_inicio - pd.Timedelta(days=1)
    limite_fim = data_fim + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
    antes = vendas_produto[(vendas_produto["data_base"] >= antes_inicio) & (vendas_produto["data_base"] <= antes_fim)]
    durante = vendas_produto[(vendas_produto["data_base"] >= data_inicio) & (vendas_produto["data_base"] <= limite_fim)]
    return antes, durante


def _metricas_unidades(durante: pd.DataFrame, eans: list[str], meta_unidades: float, tipo_meta: str) -> dict[str, object]:
    quantidade_total = float(durante["quantidade_base"].sum()) if not durante.empty else 0.0
    if meta_unidades <= 0:
        return {
            "quantidade_meta_base": quantidade_total,
            "quantidade_vendida": quantidade_total,
            "falta_unidades": 0.0,
            "atingimento_unidades": 0.0,
            "produtos_batidos": 0,
            "produtos_meta": len(eans),
            "unidades_ok": True,
        }

    if tipo_meta == "POR_PRODUTO" and eans:
        qtd_por_ean = durante.groupby("ean_limpo")["quantidade_base"].sum() if not durante.empty else pd.Series(dtype=float)
        quantidades = [float(qtd_por_ean.get(ean, 0) or 0) for ean in eans]
        produtos_batidos = sum(1 for qtd in quantidades if qtd >= meta_unidades)
        falta = sum(max(meta_unidades - qtd, 0) for qtd in quantidades)
        atingimento = min((qtd / meta_unidades for qtd in quantidades), default=0.0)
        return {
            "quantidade_meta_base": min(quantidades) if quantidades else 0.0,
            "quantidade_vendida": quantidade_total,
            "falta_unidades": float(falta),
            "atingimento_unidades": float(atingimento),
            "produtos_batidos": produtos_batidos,
            "produtos_meta": len(eans),
            "unidades_ok": produtos_batidos == len(eans),
        }

    atingimento = quantidade_total / meta_unidades
    return {
        "quantidade_meta_base": quantidade_total,
        "quantidade_vendida": quantidade_total,
        "falta_unidades": float(max(meta_unidades - quantidade_total, 0)),
        "atingimento_unidades": float(atingimento),
        "produtos_batidos": int(quantidade_total >= meta_unidades),
        "produtos_meta": 1,
        "unidades_ok": quantidade_total >= meta_unidades,
    }


def _linha_analise(
    grupo: pd.DataFrame,
    vendas_produto: pd.DataFrame,
    data_inicio: pd.Timestamp,
    data_fim: pd.Timestamp,
    meta: dict[str, object],
) -> dict[str, object]:
    primeira = grupo.iloc[0]
    consultor = _texto(meta.get("consultor")) or "Todos"
    agregado = bool(meta.get("agregado", False))
    meta_unidades = _numero(meta.get("meta_unidades", primeira.get("meta_unidades", 0)))
    meta_cnpjs = _numero(meta.get("meta_cnpjs", primeira.get("meta_cnpjs", 0)))
    tipo_meta = _texto(primeira.get("tipo_meta_unidades", "SOMANDO")).upper() or "SOMANDO"
    vendas_consultor = vendas_produto if agregado else vendas_produto[vendas_produto["consultor"].astype(str).eq(consultor)].copy()
    antes, durante = _vendas_periodo(vendas_consultor, data_inicio, data_fim)
    eans = _unicos_texto(grupo.get("ean_limpo", pd.Series(dtype=str)))

    ol_antes = float(antes["valor_vendido_sem_imposto"].sum()) if not antes.empty else 0.0
    ol_durante = float(durante["valor_vendido_sem_imposto"].sum()) if not durante.empty else 0.0
    crescimento = (ol_durante - ol_antes) / ol_antes if ol_antes > 0 else np.nan
    comprou = durante[(durante["quantidade_base"].fillna(0) > 0) | (durante["valor_vendido_sem_imposto"].fillna(0) > 0)].copy()
    cnpjs = int(comprou["cnpj_limpo"].nunique()) if not comprou.empty else 0

    unidades = _metricas_unidades(durante, eans, meta_unidades, tipo_meta)
    falta_cnpjs = int(max(meta_cnpjs - cnpjs, 0)) if meta_cnpjs > 0 else 0
    ating_cnpjs = (cnpjs / meta_cnpjs) if meta_cnpjs > 0 else 0.0
    cnpjs_ok = cnpjs >= meta_cnpjs if meta_cnpjs > 0 else True
    metas_ativas = meta_unidades > 0 or meta_cnpjs > 0
    atingimentos = []
    if meta_unidades > 0:
        atingimentos.append(float(unidades["atingimento_unidades"]))
    if meta_cnpjs > 0:
        atingimentos.append(float(ating_cnpjs))
    ating_geral = min(atingimentos) if atingimentos else 0.0
    status_meta = "SEM META"
    if metas_ativas:
        status_meta = "BATIDA" if bool(unidades["unidades_ok"]) and cnpjs_ok else "EM ANDAMENTO"

    consultor_destaque = ""
    distribuidora_destaque = ""
    if not durante.empty:
        consultor_destaque = durante.groupby("consultor")["valor_vendido_sem_imposto"].sum().sort_values(ascending=False).index[0]
        distribuidora_destaque = durante.groupby("distribuidora")["valor_vendido_sem_imposto"].sum().sort_values(ascending=False).index[0]

    tipo_mix = _texto(primeira.get("tipo_mix", TIPO_SEM_CLASSIFICACAO)) or TIPO_SEM_CLASSIFICACAO
    if tipo_mix == TIPO_SEM_CLASSIFICACAO and not durante.empty:
        tipo_mix = durante["tipo_mix"].mode().iloc[0]

    return {
        "campanha": _texto(primeira.get("campanha")) or _texto(primeira.get("produto")),
        "produto": _juntar(grupo.get("produto", pd.Series(dtype=str)), limite=3),
        "ean": _juntar(grupo.get("ean", pd.Series(dtype=str)), limite=5),
        "tipo_mix": tipo_mix,
        "distribuidora": _juntar(grupo.get("distribuidora", pd.Series(dtype=str)), limite=3),
        "desconto": _numero(primeira.get("desconto", 0)),
        "data_inicio": data_inicio,
        "data_fim": data_fim,
        "consultor": consultor,
        "status": _texto(primeira.get("status")),
        "meta_unidades": meta_unidades,
        "meta_cnpjs": meta_cnpjs,
        "tipo_meta_unidades": tipo_meta,
        "escopo_meta": _texto(primeira.get("escopo_meta", "PADRAO")) or "PADRAO",
        "quantidade_meta_base": unidades["quantidade_meta_base"],
        "quantidade_vendida": unidades["quantidade_vendida"],
        "cnpjs_positivados": cnpjs,
        "clientes_compradores": cnpjs,
        "falta_unidades": unidades["falta_unidades"],
        "falta_cnpjs": falta_cnpjs,
        "atingimento_unidades": unidades["atingimento_unidades"],
        "atingimento_cnpjs": ating_cnpjs,
        "atingimento_geral": ating_geral,
        "status_meta": status_meta,
        "produtos_batidos": unidades["produtos_batidos"],
        "produtos_meta": unidades["produtos_meta"],
        "ol_antes_acao": ol_antes,
        "ol_durante_acao": ol_durante,
        "crescimento_percentual": crescimento,
        "consultor_destaque": consultor_destaque,
        "distribuidora_destaque": distribuidora_destaque,
    }


def analisar_acoes_promocionais(
    acoes: pd.DataFrame,
    vendas: pd.DataFrame,
    consultores: list[str] | None = None,
) -> pd.DataFrame:
    if acoes is None or acoes.empty:
        return pd.DataFrame(columns=COLUNAS_ANALISE_ACOES)
    if vendas is None or vendas.empty:
        vendas_validas = pd.DataFrame(columns=COLUNAS_VENDAS_FOCO)
    else:
        vendas_validas = vendas.copy()
        for coluna in COLUNAS_VENDAS_FOCO:
            if coluna not in vendas_validas.columns:
                if coluna in {"valor_vendido_sem_imposto", "quantidade_base"}:
                    vendas_validas[coluna] = 0
                elif coluna == "data_base":
                    vendas_validas[coluna] = pd.NaT
                else:
                    vendas_validas[coluna] = ""
        vendas_validas = vendas_validas[vendas_validas["status_normalizado"].isin(STATUS_FATURADOS)].copy()
    linhas: list[dict[str, object]] = []

    base_acoes = acoes.copy()
    base_acoes["_grupo_foco"] = base_acoes.apply(_chave_grupo, axis=1)
    for _, grupo in base_acoes.groupby("_grupo_foco", sort=False, dropna=False):
        primeira = grupo.iloc[0]
        data_inicio = pd.to_datetime(primeira.get("data_inicio"), errors="coerce")
        data_fim = pd.to_datetime(primeira.get("data_fim"), errors="coerce")
        eans = set(_unicos_texto(grupo.get("ean_limpo", pd.Series(dtype=str))))
        if eans and not vendas_validas.empty:
            vendas_produto = vendas_validas[vendas_validas["ean_limpo"].astype(str).isin(eans)].copy()
        else:
            vendas_produto = pd.DataFrame(columns=vendas_validas.columns)

        if pd.isna(data_inicio) or pd.isna(data_fim):
            data_inicio = pd.NaT
            data_fim = pd.NaT
            vendas_produto = pd.DataFrame(columns=vendas_validas.columns)

        metas = _metas_consultores(grupo, vendas_validas, consultores)
        for meta in metas:
            if pd.isna(data_inicio) or pd.isna(data_fim):
                linhas.append(
                    {
                        **{coluna: "" for coluna in COLUNAS_ANALISE_ACOES},
                        "campanha": _texto(primeira.get("campanha")) or _texto(primeira.get("produto")),
                        "produto": _juntar(grupo.get("produto", pd.Series(dtype=str)), limite=3),
                        "ean": _juntar(grupo.get("ean", pd.Series(dtype=str)), limite=5),
                        "data_inicio": data_inicio,
                        "data_fim": data_fim,
                        "consultor": _texto(meta.get("consultor")) or "Todos",
                        "meta_unidades": _numero(meta.get("meta_unidades", primeira.get("meta_unidades", 0))),
                        "meta_cnpjs": _numero(meta.get("meta_cnpjs", primeira.get("meta_cnpjs", 0))),
                        "tipo_meta_unidades": _texto(primeira.get("tipo_meta_unidades", "SOMANDO")) or "SOMANDO",
                        "escopo_meta": _texto(primeira.get("escopo_meta", "PADRAO")) or "PADRAO",
                        "status_meta": "SEM PERIODO",
                    }
                )
                continue
            linhas.append(_linha_analise(grupo, vendas_produto, data_inicio, data_fim, meta))

    if not linhas:
        return pd.DataFrame(columns=COLUNAS_ANALISE_ACOES)
    return pd.DataFrame(linhas, columns=COLUNAS_ANALISE_ACOES)
