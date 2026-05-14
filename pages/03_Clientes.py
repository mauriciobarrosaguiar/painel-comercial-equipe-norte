from __future__ import annotations

import math
from html import escape

import streamlit as st

from src.calculos import formatar_tabela_metricas, gerar_resultado_cliente
from src.filtros import aplicar_filtros_globais, filtrar_busca
from src.layout import botao_download_excel, dataframe_com_download, titulo_pagina
from src.loader import carregar_dados_tratados
from src.tratamento import formatar_moeda, formatar_percentual, formatar_data


PAGE_SIZE = 20


def _texto(valor, padrao: str = "-") -> str:
    texto = "" if valor is None else str(valor).strip()
    if texto.lower() in {"nan", "nat", "none"}:
        texto = ""
    return texto or padrao


def _html(valor, padrao: str = "-") -> str:
    return escape(_texto(valor, padrao))


def contato_card_html(cliente) -> str:
    return f"""
    <div class="contact-card">
        <div class="contact-content">
            <div class="contact-title" title="{_html(cliente.get('nome_pdv'))}">{_html(cliente.get('nome_pdv'))}</div>
            <div class="contact-line" title="{_html(cliente.get('cnpj_limpo'))}"><b>CNPJ:</b> {_html(cliente.get('cnpj_limpo'))}</div>
            <div class="contact-line" title="{_html(cliente.get('grupo_sip'))}"><b>Rede:</b> {_html(cliente.get('grupo_sip'))}</div>
            <div class="contact-line" title="{_html(cliente.get('consultor'))}"><b>Consultor:</b> {_html(cliente.get('consultor'))}</div>
            <div class="contact-line" title="{_html(cliente.get('cidade'))} / {_html(cliente.get('uf'))}"><b>Cidade/UF:</b> {_html(cliente.get('cidade'))} / {_html(cliente.get('uf'))}</div>
            <div class="mini-grid">
                <div class="mini-metric"><div class="mini-label">OL</div><div class="mini-value">{formatar_moeda(cliente.get('ol_sem_combate', 0))}</div></div>
                <div class="mini-metric"><div class="mini-label">OL Prio</div><div class="mini-value">{formatar_moeda(cliente.get('ol_prioritarios', 0))}</div></div>
                <div class="mini-metric"><div class="mini-label">OL Lanç.</div><div class="mini-value">{formatar_moeda(cliente.get('ol_lancamentos', 0))}</div></div>
                <div class="mini-metric"><div class="mini-label">% Prio</div><div class="mini-value">{formatar_percentual(cliente.get('percentual_prioritarios', 0))}</div></div>
                <div class="mini-metric"><div class="mini-label">% Lanç.</div><div class="mini-value">{formatar_percentual(cliente.get('percentual_lancamentos', 0))}</div></div>
                <div class="mini-metric"><div class="mini-label">Últ. compra</div><div class="mini-value">{formatar_data(cliente.get('ultima_compra'))}</div></div>
            </div>
            <div class="contact-line" title="{_html(cliente.get('proprietario_diretor'))}"><b>Proprietário/Diretor:</b> {_html(cliente.get('proprietario_diretor'))}</div>
            <div class="contact-line" title="{_html(cliente.get('comprador_gerente_de_compras'))}"><b>Comprador:</b> {_html(cliente.get('comprador_gerente_de_compras'))}</div>
            <div class="contact-line" title="{_html(cliente.get('cargo'))}"><b>Cargo:</b> {_html(cliente.get('cargo'))}</div>
            <div class="contact-line" title="{_html(cliente.get('celular'))}"><b>Celular:</b> {_html(cliente.get('celular'))}</div>
            <div class="contact-line" title="{_html(cliente.get('email'))}"><b>Email:</b> {_html(cliente.get('email'))}</div>
        </div>
        <div class="contact-status"><span class="pill-note">{_html(cliente.get('status_comercial'))}</span></div>
    </div>
    """


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
    cards = "\n".join(contato_card_html(cliente) for _, cliente in previews.iterrows())
    st.markdown(f'<div class="client-card-grid">{cards}</div>', unsafe_allow_html=True)

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
