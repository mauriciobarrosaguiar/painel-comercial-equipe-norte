from __future__ import annotations

from datetime import datetime

import streamlit as st

from src.calculos import calcular_indicadores, calcular_resumo_operacional
from src.configuracoes import carregar_metas
from src.filtros import aplicar_filtros_globais, filtrar_vendas_operacionais
from src.layout import mostrar_status_periodo, titulo_pagina
from src.loader import ARQUIVOS_PADRAO, carregar_dados_tratados
from src.tratamento import formatar_moeda, formatar_percentual


def falta_para_meta(valor: float, meta: float, regra: float) -> float:
    return max((float(meta or 0) * regra) - float(valor or 0), 0)


def painel_meta(titulo: str, valor: float, meta: float) -> None:
    atingimento = (valor / meta) if meta else 0
    st.markdown(
        f"""
        <div class="metric-card period-indicator">
            <div class="metric-label">{titulo}</div>
            <div class="metric-value">{formatar_moeda(valor) if 'Clientes' not in titulo else int(valor)}</div>
            <div class="metric-note">Meta: {formatar_moeda(meta) if 'Clientes' not in titulo else int(meta or 0)} | Atingimento: {formatar_percentual(atingimento)}</div>
            <div class="pill-note">Falta 80%: {formatar_moeda(falta_para_meta(valor, meta, .8)) if 'Clientes' not in titulo else int(falta_para_meta(valor, meta, .8))}</div>
            <div class="pill-note">Falta 90%: {formatar_moeda(falta_para_meta(valor, meta, .9)) if 'Clientes' not in titulo else int(falta_para_meta(valor, meta, .9))}</div>
            <div class="pill-note">Falta 100%: {formatar_moeda(falta_para_meta(valor, meta, 1)) if 'Clientes' not in titulo else int(falta_para_meta(valor, meta, 1))}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]
metas = carregar_metas()

titulo_pagina("")

vendas_f, clientes_f, filtros = aplicar_filtros_globais(vendas, clientes, chave="visao_geral")
indicadores = calcular_indicadores(vendas_f, clientes_f)
vendas_operacionais = filtrar_vendas_operacionais(vendas, clientes_f, filtros)
resumo_operacional = calcular_resumo_operacional(vendas_operacionais, clientes_f)
meta_gt = metas.get("gerente_territorial", {})

periodo = f"{filtros['inicio'].strftime('%d/%m/%Y')} ate {filtros['fim'].strftime('%d/%m/%Y')}"
st.markdown(f"<div class='periodo-compacto'>Periodo: <b>{periodo}</b></div>", unsafe_allow_html=True)

with st.expander("Ultimas atualizacoes", expanded=False):
    cols = st.columns(3)
    fontes = [
        ("Bussola", ARQUIVOS_PADRAO["bussola"]),
        ("Painel clientes", ARQUIVOS_PADRAO["painel"]),
        ("Produtos / mix", ARQUIVOS_PADRAO["produtos_mix"]),
    ]
    for idx, (nome, caminho) in enumerate(fontes):
        with cols[idx]:
            if caminho.exists():
                atualizado = datetime.fromtimestamp(caminho.stat().st_mtime).strftime("%d/%m/%Y %H:%M:%S")
                st.markdown(
                    f"<div class='small-update'><div class='small-update-title'>{nome}</div><div class='small-update-value'>{atualizado}</div><div class='metric-note'>ok</div></div>",
                    unsafe_allow_html=True,
                )
            else:
                st.markdown(
                    f"<div class='small-update'><div class='small-update-title'>{nome}</div><div class='small-update-value'>-</div><div class='metric-note'>arquivo nao encontrado</div></div>",
                    unsafe_allow_html=True,
                )

st.markdown("### Indicadores do periodo")
c1, c2, c3, c4 = st.columns(4)
with c1:
    painel_meta("OL sem combate", indicadores["ol_sem_combate"], meta_gt.get("ol_sem_combate", 0))
with c2:
    painel_meta("OL prioritarios", indicadores["ol_prioritarios"], meta_gt.get("ol_prioritarios", 0))
with c3:
    painel_meta("OL lancamentos", indicadores["ol_lancamentos"], meta_gt.get("ol_lancamentos", 0))
with c4:
    painel_meta("Clientes com venda", indicadores["clientes_positivados"], meta_gt.get("clientes_positivados", 0))

mostrar_status_periodo(resumo_operacional, titulo=True)
