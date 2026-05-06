from __future__ import annotations

import math

import streamlit as st

from src.calculos import formatar_tabela_metricas, gerar_resultado_cliente
from src.filtros import aplicar_filtros_globais, filtrar_busca
from src.layout import botao_download_excel, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.tratamento import formatar_moeda, formatar_percentual, formatar_data


PAGE_SIZE = 20


def contato_card(cliente) -> None:
    st.markdown(
        f"""
        <div class="contact-card">
            <div class="contact-title">{cliente.get('nome_pdv', '')}</div>
            <div class="contact-line"><b>CNPJ:</b> {cliente.get('cnpj_limpo', '')}</div>
            <div class="contact-line"><b>Rede:</b> {cliente.get('grupo_sip', '')}</div>
            <div class="contact-line"><b>Consultor:</b> {cliente.get('consultor', '')}</div>
            <div class="contact-line"><b>Cidade/UF:</b> {cliente.get('cidade', '')} / {cliente.get('uf', '')}</div>
            <div class="mini-grid">
                <div class="mini-metric"><div class="mini-label">OL</div><div class="mini-value">{formatar_moeda(cliente.get('ol_sem_combate', 0))}</div></div>
                <div class="mini-metric"><div class="mini-label">OL Prio</div><div class="mini-value">{formatar_moeda(cliente.get('ol_prioritarios', 0))}</div></div>
                <div class="mini-metric"><div class="mini-label">OL Lanç</div><div class="mini-value">{formatar_moeda(cliente.get('ol_lancamentos', 0))}</div></div>
                <div class="mini-metric"><div class="mini-label">% Prio</div><div class="mini-value">{formatar_percentual(cliente.get('percentual_prioritarios', 0))}</div></div>
                <div class="mini-metric"><div class="mini-label">% Lanc</div><div class="mini-value">{formatar_percentual(cliente.get('percentual_lancamentos', 0))}</div></div>
                <div class="mini-metric"><div class="mini-label">Ult. compra</div><div class="mini-value">{formatar_data(cliente.get('ultima_compra'))}</div></div>
            </div>
            <div class="contact-line"><b>Proprietário/Diretor:</b> {cliente.get('proprietario_diretor', '') or '-'}</div>
            <div class="contact-line"><b>Comprador:</b> {cliente.get('comprador_gerente_de_compras', '') or '-'}</div>
            <div class="contact-line"><b>Cargo:</b> {cliente.get('cargo', '') or '-'}</div>
            <div class="contact-line"><b>Celular:</b> {cliente.get('celular', '') or '-'}</div>
            <div class="contact-line"><b>Email:</b> {cliente.get('email', '') or '-'}</div>
            <div class="pill-note">{cliente.get('status_comercial', '')}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def base_exportacao_clientes(filtrado):
    contatos_cols = [
        "consultor",
        "cnpj_limpo",
        "nome_pdv",
        "cidade",
        "uf",
        "grupo_sip",
        "situacao",
        "proprietario_diretor",
        "comprador_gerente_de_compras",
        "cargo",
        "celular",
        "email",
        "ol_sem_combate",
        "ol_prioritarios",
        "percentual_prioritarios",
        "ol_lancamentos",
        "percentual_lancamentos",
        "ultima_compra",
        "status_comercial",
    ]
    base = filtrado[contatos_cols].rename(
        columns={
            "consultor": "Consultor",
            "cnpj_limpo": "CNPJ",
            "nome_pdv": "NOME PDV",
            "cidade": "Cidade",
            "uf": "UF",
            "grupo_sip": "Rede",
            "situacao": "Situação",
            "proprietario_diretor": "PROPRIETARIO/DIRETOR",
            "comprador_gerente_de_compras": "COMPRADOR/GERENTE DE COMPRAS",
            "cargo": "CARGO",
            "celular": "CELULAR",
            "email": "EMAIL",
            "ol_sem_combate": "OL Sem Combate",
            "ol_prioritarios": "OL Prioritários",
            "percentual_prioritarios": "% Prioritários",
            "ol_lancamentos": "OL Lançamentos",
            "percentual_lancamentos": "% Lançamentos",
            "ultima_compra": "Última compra",
            "status_comercial": "Status comercial",
        }
    )
    for col in ["OL Sem Combate", "OL Prioritários", "OL Lançamentos"]:
        base[col] = base[col].apply(formatar_moeda)
    for col in ["% Prioritários", "% Lançamentos"]:
        base[col] = base[col].apply(formatar_percentual)
    base["Última compra"] = base["Última compra"].apply(formatar_data)
    return base


dados = carregar_dados_tratados()
vendas = dados["vendas"]
clientes = dados["clientes"]

titulo_pagina("Clientes")

vendas_f, clientes_f, _ = aplicar_filtros_globais(vendas, clientes, chave="clientes")
resultado = gerar_resultado_cliente(vendas_f, clientes_f)

st.markdown('<div class="soft-panel">', unsafe_allow_html=True)
c1, c2, c3 = st.columns([1.4, 1, 1])
busca = c1.text_input("Buscar cliente ou CNPJ")
consultores = ["Todos"] + sorted(resultado["consultor"].dropna().astype(str).unique().tolist())
consultor_sel = c2.selectbox("Consultor", consultores)
redes = ["Todas"] + sorted(resultado["grupo_sip"].dropna().astype(str).unique().tolist())
rede_sel = c3.selectbox("Rede", redes)
st.markdown("</div>", unsafe_allow_html=True)

filtrado = filtrar_busca(resultado, busca, ["nome_pdv", "cnpj_limpo", "cidade", "grupo_sip", "consultor"])
if consultor_sel != "Todos":
    filtrado = filtrado[filtrado["consultor"].eq(consultor_sel)]
if rede_sel != "Todas":
    filtrado = filtrado[filtrado["grupo_sip"].eq(rede_sel)]

st.markdown(
    f"<span class='pill-note'>Clientes visíveis: {len(filtrado)}</span>"
    f"<span class='pill-note'>Com venda: {int((filtrado['ol_sem_combate'] > 0).sum()) if not filtrado.empty else 0}</span>"
    f"<span class='pill-note'>Sem venda: {int((filtrado['ol_sem_combate'] <= 0).sum()) if not filtrado.empty else 0}</span>",
    unsafe_allow_html=True,
)

exportacao = base_exportacao_clientes(filtrado) if not filtrado.empty else filtrado
botao_download_excel(exportacao, "base_de_clientes.xlsx", "Baixar base de clientes")

st.subheader("Cadastro de contatos")
if filtrado.empty:
    st.info("Nenhum cliente encontrado.")
else:
    total_paginas = max(1, math.ceil(len(filtrado) / PAGE_SIZE))
    chave_pagina = "clientes_pagina_atual"
    st.session_state[chave_pagina] = min(max(int(st.session_state.get(chave_pagina, 1)), 1), total_paginas)

    nav1, nav2, nav3 = st.columns([1, 1, 1])
    if nav1.button("Voltar", width="stretch", disabled=st.session_state[chave_pagina] <= 1):
        st.session_state[chave_pagina] -= 1
        st.rerun()
    nav2.markdown(
        f"<div class='pill-note'>Página {st.session_state[chave_pagina]} de {total_paginas}</div>",
        unsafe_allow_html=True,
    )
    if nav3.button("Próxima", width="stretch", disabled=st.session_state[chave_pagina] >= total_paginas):
        st.session_state[chave_pagina] += 1
        st.rerun()

    inicio = (st.session_state[chave_pagina] - 1) * PAGE_SIZE
    previews = filtrado.iloc[inicio : inicio + PAGE_SIZE]
    for fatia in [previews.iloc[i : i + 2] for i in range(0, len(previews), 2)]:
        cols = st.columns(2)
        for col, (_, cliente) in zip(cols, fatia.iterrows()):
            with col:
                contato_card(cliente)

with st.expander("Resultado completo por cliente", expanded=False):
    tabela = formatar_tabela_metricas(
        filtrado[
            [
                "consultor",
                "cnpj_limpo",
                "nome_pdv",
                "cidade",
                "uf",
                "grupo_sip",
                "ol_sem_combate",
                "ol_prioritarios",
                "percentual_prioritarios",
                "ol_lancamentos",
                "percentual_lancamentos",
                "ultima_compra",
                "status_comercial",
            ]
        ]
    ).rename(
        columns={
            "consultor": "Consultor",
            "cnpj_limpo": "CNPJ",
            "nome_pdv": "Nome PDV",
            "cidade": "Cidade",
            "uf": "UF",
            "grupo_sip": "Rede",
            "ol_sem_combate": "OL Sem Combate",
            "ol_prioritarios": "OL Prioritários",
            "percentual_prioritarios": "% Prioritários",
            "ol_lancamentos": "OL Lançamentos",
            "percentual_lancamentos": "% Lançamentos",
            "ultima_compra": "Última compra",
            "status_comercial": "Status comercial",
        }
    )
    dataframe_com_download(tabela, "resultado_clientes", altura=420)
