from __future__ import annotations

from pathlib import Path

import pandas as pd
import streamlit as st

from src.desafio import (
    TIPOS_FOCO_PADRAO,
    carregar_config_desafio,
    formatar_ranking,
    gerar_ranking_desafio,
    produtos_para_meta,
    salvar_metas_sku,
)
from src.filtros import aplicar_filtros_globais
from src.layout import card_metrica, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.tratamento import formatar_percentual


ROOT = Path(__file__).resolve().parents[1]
IMAGEM_CAMPANHA = ROOT / "assets" / "desafio_gigantes.jpeg"


def card_regra(titulo: str, texto: str) -> None:
    st.markdown(
        f"""
        <div class="consultor-card">
            <div class="consultor-name">{titulo}</div>
            <div class="contact-line">{texto}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]
produtos_mix = dados["produtos_mix"]

titulo_pagina("Desafio de Gigantes", "Campanha EMS Território")

vendas_f, clientes_f, _ = aplicar_filtros_globais(vendas, clientes, chave="desafio", mostrar_tipo_mix=False)
config = carregar_config_desafio()
ranking = gerar_ranking_desafio(vendas_f, produtos_mix, config)
resumo = ranking["resumo"]

if IMAGEM_CAMPANHA.exists():
    with st.expander("Premissas da campanha EMS Território", expanded=False):
        st.image(str(IMAGEM_CAMPANHA), width="stretch")

st.subheader("Mecânica do ranking")
c1, c2, c3, c4 = st.columns(4)
with c1:
    card_regra("Positivação Mix Foco", "O percentual de atingimento da meta vira ponto. O SKU destrava a partir de 80% da meta de positivação.")
with c2:
    card_regra("Giro Médio Mix Foco", "O giro pontua somente quando atingir 100% da meta. A pontuação é limitada a 120 pontos.")
with c3:
    card_regra("Ranking", "Soma dos pontos de positivação, giro médio e desafios pontuais por SKU.")
with c4:
    card_regra("Premiação", "Para premiação individual mensal, meio e final, a regra importante é atingir 100% da meta demandada.")

st.subheader("Resultado do período")
m1, m2, m3, m4 = st.columns(4)
with m1:
    card_metrica("Pontos totais", f"{float(resumo.get('pontos', 0)):,.1f}".replace(",", "X").replace(".", ",").replace("X", "."))
with m2:
    card_metrica("SKUs destravados", str(int(resumo.get("skus", 0))))
with m3:
    card_metrica("PDVs positivados", str(int(resumo.get("pdvs", 0))))
with m4:
    card_metrica("Giro médio", f"{float(resumo.get('giro', 0)):,.1f}".replace(",", "X").replace(".", ",").replace("X", "."))

with st.expander("Configurar metas por SKU", expanded=False):
    tipos_disponiveis = ["PRIORITARIO", "LANCAMENTO", "LINHA", "COMBATE"]
    tipos_foco = st.multiselect(
        "Tipos de mix que entram no desafio",
        tipos_disponiveis,
        default=[tipo for tipo in config.get("tipos_mix_foco", TIPOS_FOCO_PADRAO) if tipo in tipos_disponiveis],
    )
    metas = produtos_para_meta(produtos_mix, vendas, {**config, "tipos_mix_foco": tipos_foco})
    st.caption("A meta de positivação é em PDVs por SKU. A meta de giro é quantidade média por PDV positivado.")
    editado = st.data_editor(
        metas,
        width="stretch",
        height=360,
        disabled=["ean", "produto", "tipo_mix"],
        column_config={
            "ean": "EAN",
            "produto": "Produto",
            "tipo_mix": "Tipo mix",
            "meta_positivacao": st.column_config.NumberColumn("Meta positivação", min_value=0, step=1),
            "meta_giro": st.column_config.NumberColumn("Meta giro", min_value=0.0, step=1.0),
            "desafio_extra": st.column_config.NumberColumn("Desafio pontual", min_value=0.0, step=1.0),
        },
        key="desafio_metas_sku",
    )
    if st.button("Salvar metas do desafio", width="stretch"):
        salvar_metas_sku(pd.DataFrame(editado), tipos_foco)
        st.success("Metas do Desafio de Gigantes salvas.")
        st.rerun()

st.subheader("Ranking por consultor")
ranking_consultor = ranking["consultor"]
if ranking_consultor.empty:
    st.info("Sem vendas de mix foco no período selecionado ou metas ainda não cadastradas.")
else:
    tabela_consultor = formatar_ranking(ranking_consultor).rename(
        columns={
            "consultor": "Consultor",
            "pontos_total": "Pontos",
            "pontos_positivacao": "Pontos positivação",
            "pontos_giro": "Pontos giro",
            "skus_destravados": "SKUs destravados",
            "pdvs_positivados": "PDVs positivados",
            "quantidade_vendida": "Quantidade",
            "ol_sem_imposto": "OL sem imposto",
        }
    )
    dataframe_com_download(tabela_consultor, "desafio_ranking_consultor", altura=320)

st.subheader("Ranking por SKU")
ranking_sku = ranking["sku"]
if ranking_sku.empty:
    st.info("Sem SKUs elegíveis para o período selecionado.")
else:
    tabela_sku = formatar_ranking(ranking_sku).rename(
        columns={
            "produto": "Produto",
            "tipo_mix": "Tipo mix",
            "ean": "EAN",
            "pdvs_positivados": "PDVs positivados",
            "meta_positivacao": "Meta positivação",
            "ating_pos": "% positivação",
            "giro_medio": "Giro médio",
            "meta_giro": "Meta giro",
            "ating_giro": "% giro",
            "pontos_positivacao": "Pontos positivação",
            "pontos_giro": "Pontos giro",
            "desafio_extra": "Desafio pontual",
            "pontos_total": "Pontos",
            "destrava_sku": "Destravou",
            "ol_sem_imposto": "OL sem imposto",
        }
    )
    if "Destravou" in tabela_sku.columns:
        tabela_sku["Destravou"] = tabela_sku["Destravou"].map(lambda valor: "Sim" if bool(valor) else "Não")
    dataframe_com_download(
        tabela_sku[
            [
                "Produto",
                "Tipo mix",
                "EAN",
                "PDVs positivados",
                "Meta positivação",
                "% positivação",
                "Giro médio",
                "Meta giro",
                "% giro",
                "Pontos positivação",
                "Pontos giro",
                "Desafio pontual",
                "Pontos",
                "Destravou",
                "OL sem imposto",
            ]
        ],
        "desafio_ranking_sku",
        altura=420,
    )

st.caption(
    "Regra: se o SKU não bater 80% da positivação, ele não destrava pontuação. "
    f"Quando destrava, a positivação vale até {formatar_percentual(1.2)} em pontos e o giro pontua a partir de 100%."
)
