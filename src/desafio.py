from __future__ import annotations

import numpy as np
import pandas as pd

from src.persistencia import carregar_json, salvar_json
from src.tratamento import STATUS_CANCELADO, formatar_moeda, formatar_percentual


TIPOS_FOCO_PADRAO = ["PRIORITARIO", "LANCAMENTO"]


def carregar_config_desafio() -> dict:
    config = carregar_json("desafio", {"tipos_mix_foco": TIPOS_FOCO_PADRAO, "metas_sku": []})
    if not isinstance(config, dict):
        config = {}
    config.setdefault("tipos_mix_foco", TIPOS_FOCO_PADRAO)
    config.setdefault("metas_sku", [])
    return config


def salvar_config_desafio(config: dict) -> None:
    salvar_json("desafio", config, "Atualiza Desafio de Gigantes pelo painel")


def produtos_para_meta(produtos_mix: pd.DataFrame, vendas: pd.DataFrame, config: dict) -> pd.DataFrame:
    tipos_foco = set(config.get("tipos_mix_foco") or TIPOS_FOCO_PADRAO)
    salvas = {
        str(item.get("ean", "")).strip(): item
        for item in config.get("metas_sku", [])
        if str(item.get("ean", "")).strip()
    }

    fontes = []
    if produtos_mix is not None and not produtos_mix.empty:
        base_mix = produtos_mix.copy()
        if "ean_limpo" not in base_mix.columns and "ean" in base_mix.columns:
            base_mix["ean_limpo"] = base_mix["ean"].astype(str)
        fontes.append(base_mix[["ean_limpo", "produto", "tipo_mix"]])
    if vendas is not None and not vendas.empty:
        fontes.append(vendas[["ean_limpo", "produto", "tipo_mix"]])

    if not fontes:
        return pd.DataFrame(columns=["ean", "produto", "tipo_mix", "meta_positivacao", "meta_giro", "desafio_extra"])

    base = pd.concat(fontes, ignore_index=True).dropna(subset=["ean_limpo"]).copy()
    base["ean"] = base["ean_limpo"].astype(str).str.strip()
    base["tipo_mix"] = base["tipo_mix"].fillna("").astype(str).str.upper()
    base = base[base["tipo_mix"].isin(tipos_foco)].copy()
    base = base.drop_duplicates("ean").sort_values(["tipo_mix", "produto"])

    linhas = []
    for _, item in base.iterrows():
        ean = str(item.get("ean", "")).strip()
        salvo = salvas.get(ean, {})
        linhas.append(
            {
                "ean": ean,
                "produto": str(item.get("produto", "") or "").strip(),
                "tipo_mix": str(item.get("tipo_mix", "") or "").strip(),
                "meta_positivacao": float(salvo.get("meta_positivacao", 1) or 1),
                "meta_giro": float(salvo.get("meta_giro", 1) or 1),
                "desafio_extra": float(salvo.get("desafio_extra", 0) or 0),
            }
        )
    return pd.DataFrame(linhas)


def salvar_metas_sku(tabela: pd.DataFrame, tipos_mix_foco: list[str]) -> None:
    base = tabela.copy()
    for coluna in ["meta_positivacao", "meta_giro", "desafio_extra"]:
        base[coluna] = pd.to_numeric(base.get(coluna, 0), errors="coerce").fillna(0)
    config = {
        "tipos_mix_foco": tipos_mix_foco or TIPOS_FOCO_PADRAO,
        "metas_sku": base[["ean", "produto", "tipo_mix", "meta_positivacao", "meta_giro", "desafio_extra"]].to_dict("records"),
    }
    salvar_config_desafio(config)


def _pontuar(base: pd.DataFrame) -> pd.DataFrame:
    if base.empty:
        return base
    base = base.copy()
    base["meta_positivacao"] = pd.to_numeric(base["meta_positivacao"], errors="coerce").fillna(0)
    base["meta_giro"] = pd.to_numeric(base["meta_giro"], errors="coerce").fillna(0)
    base["desafio_extra"] = pd.to_numeric(base["desafio_extra"], errors="coerce").fillna(0)
    base["ating_pos"] = np.where(base["meta_positivacao"] > 0, base["pdvs_positivados"] / base["meta_positivacao"], 0)
    base["destrava_sku"] = base["ating_pos"] >= 0.8
    base["pontos_positivacao"] = np.where(base["destrava_sku"], np.minimum(base["ating_pos"] * 100, 120), 0)
    base["ating_giro"] = np.where(base["meta_giro"] > 0, base["giro_medio"] / base["meta_giro"], 0)
    base["pontos_giro"] = np.where(base["destrava_sku"] & (base["ating_giro"] >= 1), np.minimum(base["ating_giro"] * 100, 120), 0)
    base["pontos_total"] = np.where(
        base["destrava_sku"],
        base["pontos_positivacao"] + base["pontos_giro"] + base["desafio_extra"],
        0,
    )
    return base


def gerar_ranking_desafio(vendas: pd.DataFrame, produtos_mix: pd.DataFrame, config: dict) -> dict[str, pd.DataFrame | dict[str, float]]:
    metas = produtos_para_meta(produtos_mix, vendas, config)
    if vendas is None or vendas.empty or metas.empty:
        return {"sku": pd.DataFrame(), "consultor": pd.DataFrame(), "resumo": {"pontos": 0, "skus": 0, "pdvs": 0, "giro": 0}}

    tipos_foco = set(config.get("tipos_mix_foco") or TIPOS_FOCO_PADRAO)
    base = vendas[vendas["status_normalizado"].ne(STATUS_CANCELADO)].copy()
    base = base[base["tipo_mix"].isin(tipos_foco)].copy()
    base = base[base["ean_limpo"].astype(str).isin(set(metas["ean"].astype(str)))].copy()
    if base.empty:
        return {"sku": pd.DataFrame(), "consultor": pd.DataFrame(), "resumo": {"pontos": 0, "skus": 0, "pdvs": 0, "giro": 0}}

    comprou = base[(base["quantidade_base"].fillna(0) > 0) | (base["valor_vendido_sem_imposto"].fillna(0) > 0)].copy()
    agrupado = base.groupby(["ean_limpo", "produto", "tipo_mix"], dropna=False).agg(
        quantidade_vendida=("quantidade_base", "sum"),
        ol_sem_imposto=("valor_vendido_sem_imposto", "sum"),
        pedidos=("pedido_id", "nunique"),
    ).reset_index()
    pdvs = comprou.groupby("ean_limpo")["cnpj_limpo"].nunique().rename("pdvs_positivados")
    agrupado = agrupado.merge(pdvs, on="ean_limpo", how="left").fillna({"pdvs_positivados": 0})
    agrupado["giro_medio"] = np.where(agrupado["pdvs_positivados"] > 0, agrupado["quantidade_vendida"] / agrupado["pdvs_positivados"], 0)
    agrupado = agrupado.merge(metas, left_on="ean_limpo", right_on="ean", how="left", suffixes=("", "_meta"))
    sku = _pontuar(agrupado).sort_values("pontos_total", ascending=False).reset_index(drop=True)

    por_consultor = base.groupby(["consultor", "ean_limpo", "produto", "tipo_mix"], dropna=False).agg(
        quantidade_vendida=("quantidade_base", "sum"),
        ol_sem_imposto=("valor_vendido_sem_imposto", "sum"),
        pedidos=("pedido_id", "nunique"),
    ).reset_index()
    pdvs_cons = comprou.groupby(["consultor", "ean_limpo"])["cnpj_limpo"].nunique().rename("pdvs_positivados")
    por_consultor = por_consultor.merge(pdvs_cons, on=["consultor", "ean_limpo"], how="left").fillna({"pdvs_positivados": 0})
    por_consultor["giro_medio"] = np.where(por_consultor["pdvs_positivados"] > 0, por_consultor["quantidade_vendida"] / por_consultor["pdvs_positivados"], 0)
    por_consultor = por_consultor.merge(metas, left_on="ean_limpo", right_on="ean", how="left", suffixes=("", "_meta"))
    por_consultor = _pontuar(por_consultor)
    consultor = por_consultor.groupby("consultor", dropna=False).agg(
        pontos_total=("pontos_total", "sum"),
        pontos_positivacao=("pontos_positivacao", "sum"),
        pontos_giro=("pontos_giro", "sum"),
        skus_destravados=("destrava_sku", "sum"),
        pdvs_positivados=("pdvs_positivados", "sum"),
        quantidade_vendida=("quantidade_vendida", "sum"),
        ol_sem_imposto=("ol_sem_imposto", "sum"),
    ).reset_index().sort_values("pontos_total", ascending=False)

    resumo = {
        "pontos": float(sku["pontos_total"].sum()),
        "skus": int(sku["destrava_sku"].sum()),
        "pdvs": int(sku["pdvs_positivados"].sum()),
        "giro": float(sku["giro_medio"].mean()) if not sku.empty else 0,
    }
    return {"sku": sku, "consultor": consultor, "resumo": resumo}


def formatar_ranking(df: pd.DataFrame) -> pd.DataFrame:
    base = df.copy()
    for coluna in ["ating_pos", "ating_giro"]:
        if coluna in base.columns:
            base[coluna] = base[coluna].apply(formatar_percentual)
    for coluna in ["ol_sem_imposto"]:
        if coluna in base.columns:
            base[coluna] = base[coluna].apply(formatar_moeda)
    for coluna in ["pontos_total", "pontos_positivacao", "pontos_giro", "giro_medio", "quantidade_vendida"]:
        if coluna in base.columns:
            base[coluna] = base[coluna].astype(float).map(lambda valor: f"{valor:,.1f}".replace(",", "X").replace(".", ",").replace("X", "."))
    return base
