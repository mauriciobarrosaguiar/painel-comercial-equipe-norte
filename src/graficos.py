from __future__ import annotations

import pandas as pd

try:
    import plotly.express as px
    import plotly.graph_objects as go
except ModuleNotFoundError:
    px = None
    go = None


CORES = ["#175cd3", "#067647", "#b54708", "#6941c6", "#c11574", "#475467"]


def plotly_disponivel() -> bool:
    return px is not None and go is not None


def _layout(fig):
    if fig is None:
        return None
    fig.update_layout(
        template="plotly_white",
        margin=dict(l=10, r=10, t=48, b=20),
        colorway=CORES,
        legend_title_text="",
        font=dict(family="Arial", size=13, color="#182230"),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
    )
    return fig


def grafico_evolucao_diaria(vendas: pd.DataFrame):
    if not plotly_disponivel():
        return None
    base = vendas[vendas["tipo_mix"].ne("COMBATE")].copy()
    if base.empty:
        return _layout(go.Figure())
    serie = base.groupby(base["data_base"].dt.date, dropna=True)["valor_vendido_sem_imposto"].sum().reset_index()
    serie.columns = ["data", "ol_sem_combate"]
    fig = px.line(serie, x="data", y="ol_sem_combate", markers=True, title="Evolucao diaria de OL Sem Combate")
    fig.update_yaxes(title="OL Sem Combate")
    fig.update_xaxes(title="")
    return _layout(fig)


def grafico_ranking_consultores(vendas: pd.DataFrame):
    if not plotly_disponivel():
        return None
    base = vendas[vendas["tipo_mix"].ne("COMBATE")].copy()
    ranking = base.groupby("consultor", dropna=False)["valor_vendido_sem_imposto"].sum().sort_values(ascending=False).head(10).reset_index()
    fig = px.bar(ranking, x="valor_vendido_sem_imposto", y="consultor", orientation="h", title="Ranking de consultores por OL Sem Combate")
    fig.update_layout(yaxis=dict(autorange="reversed"))
    fig.update_xaxes(title="OL Sem Combate")
    fig.update_yaxes(title="")
    return _layout(fig)


def grafico_participacao_mix(vendas: pd.DataFrame):
    if not plotly_disponivel():
        return None
    base = vendas[vendas["tipo_mix"].isin(["PRIORITARIO", "LANCAMENTO", "LINHA", "COMBATE", "SEM CLASSIFICACAO"])].copy()
    resumo = base.groupby("tipo_mix", dropna=False)["valor_vendido_sem_imposto"].sum().reset_index()
    fig = px.pie(resumo, names="tipo_mix", values="valor_vendido_sem_imposto", hole=0.48, title="Participacao por tipo de mix")
    return _layout(fig)


def grafico_vendas_distribuidora(vendas: pd.DataFrame):
    if not plotly_disponivel():
        return None
    base = vendas[vendas["tipo_mix"].ne("COMBATE")].copy()
    resumo = base.groupby("distribuidora", dropna=False)["valor_vendido_sem_imposto"].sum().sort_values(ascending=False).head(12).reset_index()
    fig = px.bar(resumo, x="distribuidora", y="valor_vendido_sem_imposto", title="Vendas por distribuidora")
    fig.update_xaxes(title="", tickangle=-20)
    fig.update_yaxes(title="OL Sem Combate")
    return _layout(fig)


def grafico_vendas_uf(vendas: pd.DataFrame):
    if not plotly_disponivel():
        return None
    base = vendas[vendas["tipo_mix"].ne("COMBATE")].copy()
    resumo = base.groupby("uf", dropna=False)["valor_vendido_sem_imposto"].sum().sort_values(ascending=False).reset_index()
    fig = px.bar(resumo, x="uf", y="valor_vendido_sem_imposto", title="Vendas por UF")
    fig.update_xaxes(title="")
    fig.update_yaxes(title="OL Sem Combate")
    return _layout(fig)
