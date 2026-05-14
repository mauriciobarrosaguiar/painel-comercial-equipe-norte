from __future__ import annotations

from datetime import date, timedelta

import pandas as pd

from src.tratamento import formatar_moeda, formatar_percentual


def _pascoa(ano: int) -> date:
    a = ano % 19
    b = ano // 100
    c = ano % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = ((h + l - 7 * m + 114) % 31) + 1
    return date(ano, mes, dia)


def feriados_nacionais(ano: int) -> set[date]:
    pascoa = _pascoa(ano)
    return {
        date(ano, 1, 1),
        pascoa - timedelta(days=48),
        pascoa - timedelta(days=47),
        pascoa - timedelta(days=2),
        date(ano, 4, 21),
        date(ano, 5, 1),
        pascoa + timedelta(days=60),
        date(ano, 9, 7),
        date(ano, 10, 12),
        date(ano, 11, 2),
        date(ano, 11, 15),
        date(ano, 11, 20),
        date(ano, 12, 25),
    }


def dias_uteis(inicio: object, fim: object, feriados_extra: set[date] | None = None) -> int:
    data_inicio = pd.Timestamp(inicio).date()
    data_fim = pd.Timestamp(fim).date()
    if data_fim < data_inicio:
        return 0
    feriados: set[date] = set(feriados_extra or set())
    for ano in range(data_inicio.year, data_fim.year + 1):
        feriados.update(feriados_nacionais(ano))
    total = 0
    dia = data_inicio
    while dia <= data_fim:
        if dia.weekday() < 5 and dia not in feriados:
            total += 1
        dia += timedelta(days=1)
    return total


def calcular_projecao(valor: float, meta: float, inicio: object, fim: object) -> dict[str, float]:
    data_ref = pd.Timestamp(fim).date()
    inicio_mes = date(data_ref.year, data_ref.month, 1)
    fim_mes = (pd.Timestamp(inicio_mes) + pd.offsets.MonthEnd(0)).date()
    data_realizado = min(max(data_ref, inicio_mes), fim_mes)
    uteis_decorridos = dias_uteis(inicio_mes, data_realizado)
    uteis_periodo = dias_uteis(inicio_mes, fim_mes)
    valor_float = float(valor or 0)
    meta_float = float(meta or 0)
    projetado = (valor_float / uteis_decorridos * uteis_periodo) if uteis_decorridos and uteis_periodo else valor_float
    percentual = (projetado / meta_float) if meta_float else 0.0
    return {
        "projetado": projetado,
        "percentual": percentual,
        "dias_uteis_decorridos": float(uteis_decorridos),
        "dias_uteis_periodo": float(uteis_periodo),
    }


def classe_projecao(percentual: float) -> tuple[str, str]:
    if percentual >= 1.2:
        return "projection-green", "★"
    if percentual >= 1.0:
        return "projection-blue", ""
    if percentual >= 0.9:
        return "projection-orange", ""
    if percentual >= 0.8:
        return "projection-dark-red", ""
    return "projection-red", ""


def projecao_html(valor: float, meta: float, inicio: object, fim: object, moeda: bool = True) -> str:
    dados = calcular_projecao(valor, meta, inicio, fim)
    classe, estrela = classe_projecao(dados["percentual"])
    marcador = '<span class="projection-star">★</span>' if estrela else f'<span class="projection-dot {classe}"></span>'
    projetado = formatar_moeda(dados["projetado"]) if moeda else f"{int(round(dados['projetado']))}"
    percentual = formatar_percentual(dados["percentual"])
    return (
        f'<div class="pill-note projection-note" title="Atingimento projetado: {formatar_percentual(dados["percentual"])}">'
        f'Projeção mês: {projetado} | {percentual} {marcador}'
        f'</div>'
    )
