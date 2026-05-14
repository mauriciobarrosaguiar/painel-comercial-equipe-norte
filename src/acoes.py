from __future__ import annotations

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
    "ol_antes_acao",
    "ol_durante_acao",
    "crescimento_percentual",
    "quantidade_vendida",
    "clientes_compradores",
    "consultor_destaque",
    "distribuidora_destaque",
    "id_acao",
    "origem_acao",
]


def analisar_acoes_promocionais(acoes: pd.DataFrame, vendas: pd.DataFrame) -> pd.DataFrame:
    if acoes is None or acoes.empty:
        return pd.DataFrame(columns=COLUNAS_ANALISE_ACOES)
    vendas_validas = vendas[vendas["status_normalizado"].isin(STATUS_FATURADOS)].copy() if not vendas.empty else pd.DataFrame()
    linhas: list[dict[str, object]] = []

    for _, acao in acoes.iterrows():
        ean = str(acao.get("ean_limpo", "")).strip()
        data_inicio = pd.to_datetime(acao.get("data_inicio"), errors="coerce")
        data_fim = pd.to_datetime(acao.get("data_fim"), errors="coerce")
        vendas_produto = vendas_validas[vendas_validas["ean_limpo"].eq(ean)].copy() if ean else pd.DataFrame()

        if pd.isna(data_inicio) or pd.isna(data_fim) or vendas_produto.empty:
            ol_antes = 0.0
            ol_durante = 0.0
            quantidade = 0.0
            clientes = 0
            consultor_destaque = ""
            distribuidora_destaque = ""
            crescimento = np.nan
        else:
            dias = max((data_fim.normalize() - data_inicio.normalize()).days + 1, 1)
            antes_inicio = data_inicio - pd.Timedelta(days=dias)
            antes_fim = data_inicio - pd.Timedelta(days=1)
            antes = vendas_produto[(vendas_produto["data_base"] >= antes_inicio) & (vendas_produto["data_base"] <= antes_fim)]
            durante = vendas_produto[(vendas_produto["data_base"] >= data_inicio) & (vendas_produto["data_base"] <= data_fim + pd.Timedelta(days=1) - pd.Timedelta(seconds=1))]
            ol_antes = float(antes["valor_vendido_sem_imposto"].sum())
            ol_durante = float(durante["valor_vendido_sem_imposto"].sum())
            quantidade = float(durante["quantidade_base"].sum())
            clientes = int(durante["cnpj_limpo"].nunique())
            consultor_destaque = ""
            distribuidora_destaque = ""
            if not durante.empty:
                consultor_destaque = durante.groupby("consultor")["valor_vendido_sem_imposto"].sum().sort_values(ascending=False).index[0]
                distribuidora_destaque = durante.groupby("distribuidora")["valor_vendido_sem_imposto"].sum().sort_values(ascending=False).index[0]
            crescimento = (ol_durante - ol_antes) / ol_antes if ol_antes > 0 else np.nan

        tipo_mix = acao.get("tipo_mix", TIPO_SEM_CLASSIFICACAO)
        if tipo_mix == TIPO_SEM_CLASSIFICACAO and not vendas_produto.empty:
            tipo_mix = vendas_produto["tipo_mix"].mode().iloc[0]

        linhas.append(
            {
                "campanha": acao.get("campanha", ""),
                "produto": acao.get("produto", ""),
                "ean": acao.get("ean", ""),
                "tipo_mix": tipo_mix,
                "distribuidora": acao.get("distribuidora", ""),
                "desconto": acao.get("desconto", 0),
                "data_inicio": data_inicio,
                "data_fim": data_fim,
                "consultor": acao.get("consultor", ""),
                "status": acao.get("status", ""),
                "ol_antes_acao": ol_antes,
                "ol_durante_acao": ol_durante,
                "crescimento_percentual": crescimento,
                "quantidade_vendida": quantidade,
                "clientes_compradores": clientes,
                "consultor_destaque": consultor_destaque,
                "distribuidora_destaque": distribuidora_destaque,
                "id_acao": acao.get("id_acao", ""),
                "origem_acao": acao.get("origem_acao", ""),
            }
        )
    return pd.DataFrame(linhas, columns=COLUNAS_ANALISE_ACOES)
