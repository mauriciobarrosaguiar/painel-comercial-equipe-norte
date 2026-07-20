from __future__ import annotations

from datetime import date

import streamlit as st

from src.layout import titulo_pagina
from src.migracao_saas import configuracao_migracao, disparar_migracao_bases, mes_atual
from src.persistencia import existe_persistido, formatar_ultima_atualizacao, status_persistencia


BASES = [
    ("Painel Equipe Norte", "painel", "Carteira oficial por CNPJ, consultor, GD, cidade e UF."),
    ("Metas Comerciais", "metas", "Metas de OL e clientes positivados por consultor e GD."),
    ("Produtos / Mix", "produtos_mix", "Classificação por EAN: Linha, Combate, Prioritário e Lançamento."),
    ("Produtos do Mercado Farma", "produtos_mercado_farma", "Lista oficial de EANs usada nas extrações de preços e estoques."),
]


titulo_pagina("Migrar bases para o novo painel")
st.caption("Transfere as bases oficiais deste painel antigo para o banco D1 do novo Painel Comercial.")

config = configuracao_migracao()
persistencia = status_persistencia()

col1, col2 = st.columns(2)
with col1:
    st.metric("Persistência antiga", "Pronta" if persistencia.get("ok") in {"sim", "parcial"} else "Incompleta")
    st.caption(str(persistencia.get("detalhe", "")))
with col2:
    st.metric("Envio ao GitHub", "Pronto" if config.get("pronto") else "Configuração pendente")
    st.caption("A chave criptográfica é enviada somente para esta execução da migração.")

st.subheader("Bases encontradas")
status_bases: list[bool] = []
for titulo, chave, descricao in BASES:
    encontrada = existe_persistido(chave)
    status_bases.append(encontrada)
    with st.container(border=True):
        c1, c2 = st.columns([4, 1])
        with c1:
            st.markdown(f"**{titulo}**")
            st.caption(descricao)
            atualizacao = formatar_ultima_atualizacao(chave)
            if atualizacao:
                st.caption(f"Última atualização: {atualizacao}")
        with c2:
            if encontrada:
                st.success("Encontrada")
            else:
                st.error("Ausente")

st.divider()
st.subheader("Executar transferência")
mes_selecionado = st.date_input(
    "Mês de referência das metas",
    value=date.fromisoformat(f"{mes_atual()}-01"),
    format="DD/MM/YYYY",
    help="Somente o ano e o mês serão utilizados.",
)
ano_mes = mes_selecionado.strftime("%Y-%m")

pronto = bool(config.get("pronto")) and all(status_bases)
if not all(status_bases):
    st.error("A migração foi bloqueada porque uma ou mais bases antigas não foram encontradas.")
elif not config.get("pronto"):
    st.error("A migração foi bloqueada porque GITHUB_TOKEN ou PERSISTENCE_KEY não estão disponíveis no painel antigo.")
else:
    st.info(
        "Serão migrados clientes e responsáveis, metas, classificação do mix e a lista de produtos do Mercado Farma. "
        "Os pedidos do Bússola já existentes serão vinculados novamente aos clientes corretos."
    )

if st.button(
    "Migrar todas as bases agora",
    type="primary",
    use_container_width=True,
    disabled=not pronto,
):
    try:
        url = disparar_migracao_bases(ano_mes)
        st.session_state["migracao_saas_url"] = url
        st.success("Migração enviada ao GitHub Actions. Aguarde a execução ficar verde.")
    except Exception as exc:
        st.error(str(exc))

url_execucao = st.session_state.get("migracao_saas_url", "")
if url_execucao:
    st.link_button("Acompanhar migração no GitHub", url_execucao, use_container_width=True)
    st.caption("Depois que a execução ficar verde, atualize a página do novo painel com Ctrl + F5.")
