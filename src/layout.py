from __future__ import annotations

from io import BytesIO

import pandas as pd
import streamlit as st

from src.tratamento import formatar_moeda, formatar_percentual


def configurar_pagina() -> None:
    st.set_page_config(
        page_title="Painel Gerencial de Vendas - Equipe Norte",
        layout="wide",
        initial_sidebar_state="expanded",
    )
    aplicar_css()


def aplicar_css() -> None:
    st.markdown(
        """
        <style>
        :root {
            --norte-bg: #F6F5EC;
            --norte-card: #ffffff;
            --norte-border: #B8CBB8;
            --norte-text: #062F22;
            --norte-muted: #5F6F63;
            --norte-blue: #0D3B2A;
            --norte-green: #176A45;
            --norte-red: #D15353;
            --norte-amber: #C7A945;
        }
        * {
            scrollbar-width: auto;
            scrollbar-color: #176A45 #E8EFE4;
        }
        ::-webkit-scrollbar {
            width: 16px;
            height: 14px;
        }
        ::-webkit-scrollbar-track {
            background: #E8EFE4;
            border-radius: 999px;
        }
        ::-webkit-scrollbar-thumb {
            background: #176A45;
            border: 3px solid #E8EFE4;
            border-radius: 999px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: #0D3B2A;
        }
        .stApp {
            background: linear-gradient(110deg, #F8F5E9 0%, #EEF6EF 100%);
            color: var(--norte-text);
        }
        .block-container {
            padding-top: 2.4rem;
            max-width: 1280px;
        }
        header[data-testid="stHeader"] {
            display: block !important;
            visibility: visible !important;
            height: 2.2rem !important;
            background: transparent !important;
            box-shadow: none !important;
        }
        [data-testid="stDecoration"],
        #MainMenu,
        footer {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
        }
        [data-testid="stToolbar"] {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
            background: transparent !important;
        }
        [data-testid="stToolbar"] > div:not(:has([data-testid="stSidebarCollapseButton"])):not(:has([data-testid="stExpandSidebarButton"])):not(:has([data-testid="stSidebarCollapsedControl"])) {
            display: none !important;
        }
        [data-testid="stToolbar"] a,
        [data-testid="stToolbar"] button:not([data-testid="stSidebarCollapseButton"]):not([data-testid="stExpandSidebarButton"]):not([data-testid="stSidebarCollapsedControl"]) {
            display: none !important;
        }
        [data-testid="stSidebarCollapseButton"],
        [data-testid="stExpandSidebarButton"],
        [data-testid="stSidebarCollapsedControl"],
        button[data-testid="stSidebarCollapseButton"],
        button[data-testid="stExpandSidebarButton"],
        button[data-testid="stSidebarCollapsedControl"] {
            display: inline-flex !important;
            visibility: visible !important;
            opacity: 1 !important;
            z-index: 999999 !important;
        }
        header[data-testid="stHeader"] button {
            color: var(--norte-text) !important;
        }
        [data-testid="stSidebar"] {
            background: #062F22;
            border-right: 0;
        }
        [data-testid="stSidebar"] ::-webkit-scrollbar {
            width: 16px;
        }
        [data-testid="stSidebarNav"],
        [data-testid="stSidebarNavItems"],
        [data-testid="stSidebar"] nav {
            display: none !important;
        }
        [data-testid="stSidebar"] * {
            color: #FFFFFF;
        }
        [data-testid="stSidebar"] .stRadio > label,
        [data-testid="stSidebar"] .stDateInput label,
        [data-testid="stSidebar"] .stSelectbox label,
        [data-testid="stSidebar"] .stMultiSelect label,
        [data-testid="stSidebar"] .stToggle label {
            color: #E8FAFF !important;
            font-weight: 800 !important;
        }
        [data-testid="stSidebar"] .stButton > button {
            width: 100%;
            border-radius: 14px !important;
            font-weight: 900;
        }
        [data-testid="stSidebar"] h2 {
            font-size: 1.45rem;
            font-weight: 900;
            margin-top: 1.4rem;
            margin-bottom: .2rem;
        }
        .sidebar-spacer { height: 1rem; }
        [data-testid="stSidebar"] [role="radiogroup"] {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }
        [data-testid="stSidebar"] [role="radiogroup"] label {
            background: rgba(255,255,255,.08);
            border: 1px solid rgba(255,255,255,.18);
            border-radius: 15px;
            min-height: 44px;
            padding: 0 14px;
            width: 100%;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 900;
        }
        [data-testid="stSidebar"] [role="radiogroup"] label:has(input:checked) {
            background: linear-gradient(105deg, #155C3D 0%, #1F7D55 58%, #D0AE3F 100%);
            border-color: #BDA13B;
        }
        [data-testid="stSidebar"] [role="radiogroup"] label > div:first-child {
            display: none;
        }
        h1, h2, h3 {
            letter-spacing: 0;
        }
        .norte-hero {
            padding: 0.1rem 0 0.8rem 0;
            margin-bottom: 1rem;
        }
        .page-title {
            margin: .1rem 0 .35rem 0;
            color: var(--norte-text);
            font-size: 2.1rem;
            font-weight: 900;
            text-align: center;
        }
        .norte-subtitle {
            color: var(--norte-muted);
            font-size: 1rem;
            margin-top: 0.1rem;
            text-align: center;
        }
        .metric-card {
            background: var(--norte-card);
            border: 1px solid var(--norte-border);
            border-radius: 18px;
            padding: 14px 12px;
            min-height: 108px;
            box-shadow: 0 8px 18px rgba(15,23,42,.03);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
        }
        .period-indicator {
            min-height: 214px;
            height: 100%;
        }
        .metric-label {
            color: var(--norte-muted);
            font-size: .84rem;
            font-weight: 800;
        }
        .metric-value {
            color: var(--norte-blue);
            font-size: 1.34rem;
            font-weight: 900;
            line-height: 1.2;
            margin-top: 4px;
            word-break: break-word;
        }
        .metric-note {
            color: #75879A;
            font-size: .78rem;
            margin-top: 4px;
        }
        .status-good {
            color: var(--norte-green);
            font-weight: 700;
        }
        .status-warn {
            color: var(--norte-amber);
            font-weight: 700;
        }
        .status-bad {
            color: var(--norte-red);
            font-weight: 700;
        }
        div[data-testid="stDataFrame"] {
            border: 1px solid var(--norte-border);
            border-radius: 14px;
            overflow: hidden;
        }
        .soft-panel {
            background: rgba(255,255,255,.72);
            border: 1px solid var(--norte-border);
            border-radius: 18px;
            padding: 1rem;
            box-shadow: 0 10px 24px rgba(6,47,34,.04);
            margin-bottom: 1rem;
        }
        .periodo-compacto {
            display: inline-block;
            background: rgba(255,255,255,.78);
            border: 1px solid var(--norte-border);
            border-radius: 999px;
            padding: .35rem .85rem;
            color: var(--norte-text);
            font-size: .82rem;
            font-weight: 700;
            margin-bottom: .8rem;
        }
        .small-update {
            background: rgba(255,255,255,.82);
            border: 1px solid var(--norte-border);
            border-radius: 14px;
            padding: .55rem .7rem;
            text-align: center;
            margin-bottom: .45rem;
        }
        .small-update-title {
            color: var(--norte-muted);
            font-size: .72rem;
            font-weight: 900;
        }
        .small-update-value {
            color: var(--norte-text);
            font-size: .9rem;
            font-weight: 900;
        }
        .consultor-card {
            background: rgba(255,255,255,.84);
            border: 1px solid var(--norte-border);
            border-radius: 18px;
            padding: 1rem;
            box-shadow: 0 10px 24px rgba(6,47,34,.05);
            margin-bottom: 1rem;
        }
        .consultor-name {
            font-size: 1.03rem;
            line-height: 1.2;
            font-weight: 900;
            color: var(--norte-text);
            margin-bottom: .75rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .mini-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: .55rem;
        }
        .indicator-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 1rem;
            margin-bottom: 1rem;
            align-items: stretch;
        }
        .status-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 1rem;
            margin: 1rem 0;
        }
        .status-title {
            color: var(--norte-text);
            font-weight: 900;
            font-size: 1.08rem;
            text-align: center;
            margin: .25rem 0 .15rem 0;
        }
        @media (max-width: 900px) {
            .status-grid {
                grid-template-columns: repeat(1, minmax(0, 1fr));
            }
        }
        @media (max-width: 1050px) {
            .indicator-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }
        .mini-metric {
            background: #F8FAF4;
            border: 1px solid #D7E5D5;
            border-radius: 999px;
            padding: .42rem .55rem;
            text-align: center;
            min-height: 50px;
        }
        .mini-label {
            color: var(--norte-muted);
            font-size: .68rem;
            font-weight: 800;
            line-height: 1.05;
        }
        .mini-value {
            color: var(--norte-text);
            font-size: .82rem;
            font-weight: 900;
            margin-top: .14rem;
            overflow-wrap: anywhere;
        }
        .client-card-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 24px;
            align-items: stretch;
            margin-top: 1rem;
        }
        @media (max-width: 900px) {
            .client-card-grid {
                grid-template-columns: 1fr;
            }
        }
        .contact-card {
            background: rgba(255,255,255,.84);
            border: 1px solid var(--norte-border);
            border-radius: 18px;
            padding: 1rem;
            box-shadow: 0 10px 24px rgba(6,47,34,.05);
            min-height: 420px;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            box-sizing: border-box;
            min-width: 0;
        }
        .contact-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: .34rem;
            min-width: 0;
        }
        .contact-title {
            font-weight: 900;
            color: var(--norte-text);
            font-size: 1rem;
            line-height: 1.25;
            min-height: 2.5rem;
            margin-bottom: .25rem;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
        }
        .contact-line {
            font-size: .8rem;
            color: var(--norte-muted);
            margin: .16rem 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
        }
        .contact-status {
            margin-top: auto;
            padding-top: .65rem;
        }
        .mix-op-card {
            background: rgba(255,255,255,.9);
            border: 1px solid var(--norte-border);
            border-radius: 18px;
            padding: 1rem;
            min-height: 240px;
            box-shadow: 0 10px 24px rgba(6,47,34,.05);
        }
        .mix-op-title {
            color: var(--norte-text);
            font-size: .96rem;
            font-weight: 900;
            margin-bottom: .45rem;
        }
        .mix-product-row {
            border-top: 1px solid #E3E9DD;
            padding: .58rem 0;
        }
        .mix-product-title {
            color: var(--norte-text);
            font-size: .82rem;
            font-weight: 850;
            line-height: 1.25;
        }
        .mix-product-meta {
            color: var(--norte-muted);
            font-size: .72rem;
            line-height: 1.35;
        }
        .mix-product-price {
            color: #00709C;
            font-size: .78rem;
            font-weight: 900;
            margin-top: .18rem;
        }
        .mix-empty {
            color: var(--norte-muted);
            font-size: .82rem;
            padding: .8rem 0;
        }
        .pill-note {
            display: inline-block;
            background: #EEF5EA;
            border: 1px solid #D7E5D5;
            border-radius: 999px;
            padding: .28rem .75rem;
            color: var(--norte-text);
            font-weight: 800;
            font-size: .78rem;
            margin: .16rem;
        }
        .recado-card {
            background: rgba(255,255,255,.9);
            border: 1px solid var(--norte-border);
            border-radius: 18px;
            padding: 1rem;
            box-shadow: 0 10px 24px rgba(6,47,34,.05);
            margin-bottom: 1rem;
        }
        .recado-title {
            color: var(--norte-text);
            font-size: 1.08rem;
            font-weight: 900;
            margin-bottom: .25rem;
        }
        .recado-status {
            display: inline-block;
            border-radius: 999px;
            padding: .2rem .65rem;
            font-size: .76rem;
            font-weight: 900;
            margin-bottom: .5rem;
            background: #EEF5EA;
            color: var(--norte-text);
            border: 1px solid #D7E5D5;
        }
        .recado-status-pendente {
            background: #FFF3D6;
            color: #8A5A00;
            border-color: #E9C977;
        }
        .recado-status-em-andamento {
            background: #E5F1FF;
            color: #00619A;
            border-color: #A8CDEE;
        }
        .recado-status-concluido {
            background: #E6F6EA;
            color: #0F6A35;
            border-color: #ABD7B5;
        }
        .recado-comment {
            color: var(--norte-muted);
            font-size: .9rem;
            margin: .55rem 0 .2rem 0;
            white-space: pre-wrap;
        }
        .projection-pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: .45rem;
            background: #EEF5EA;
            border: 1px solid #D7E5D5;
            border-radius: 999px;
            padding: .28rem .75rem;
            color: var(--norte-text);
            font-weight: 900;
            font-size: .82rem;
            margin-top: .28rem;
        }
        .projection-note {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: .42rem;
            min-width: 92%;
            max-width: 100%;
            font-size: .74rem;
            line-height: 1.25;
            white-space: normal;
        }
        .projection-dot {
            width: 15px;
            height: 15px;
            border-radius: 999px;
            display: inline-block;
            box-shadow: inset 0 0 0 1px rgba(0,0,0,.08);
        }
        .projection-red { background: #F03434; }
        .projection-dark-red { background: #9B1C1C; }
        .projection-orange { background: #F59E0B; }
        .projection-blue { background: #64B5F6; }
        .projection-green { background: #0F7A3B; }
        .projection-star {
            color: #D4A11E;
            font-size: 1.25rem;
            line-height: 1;
        }
        .stTabs [data-baseweb="tab-list"] {
            gap: 0.4rem;
        }
        .stTabs [data-baseweb="tab"] {
            background: #ffffff;
            border: 1px solid var(--norte-border);
            border-radius: 14px;
            padding: 0.5rem 0.8rem;
            font-weight: 800;
        }
        .produto-card {
            background: #FFFFFF;
            border: 1px solid #DDE5DD;
            border-radius: 10px;
            padding: 14px;
            min-height: 270px;
            box-shadow: 0 2px 10px rgba(15, 23, 42, .08);
            margin-bottom: 1rem;
            display: flex;
            flex-direction: column;
            gap: .6rem;
        }
        .produto-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: .5rem;
        }
        .desconto-badge {
            background: #00A43A;
            color: white;
            font-weight: 900;
            border-radius: 5px;
            padding: .18rem .45rem;
            font-size: .82rem;
        }
        .produto-nome {
            color: #061A16;
            font-weight: 800;
            line-height: 1.35;
            min-height: 44px;
        }
        .produto-meta {
            color: #61716B;
            font-size: .78rem;
            overflow-wrap: anywhere;
        }
        .preco-box {
            border: 1px solid #E1E5E2;
            border-radius: 9px;
            padding: .75rem;
            display: grid;
            grid-template-columns: 1fr auto;
            gap: .35rem .75rem;
            align-items: center;
        }
        .preco-dist {
            font-weight: 800;
            color: var(--norte-text);
        }
        .preco-estoque {
            color: #00709C;
            font-size: .78rem;
        }
        .preco-principal {
            color: #00709C;
            font-size: 1.45rem;
            font-weight: 900;
            line-height: 1;
            text-align: right;
        }
        .preco-secundario {
            color: #61716B;
            font-size: .68rem;
            text-align: right;
        }
        .public-shell .block-container {
            max-width: 1180px;
            padding-top: 1.5rem;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def ocultar_sidebar_publica() -> None:
    st.markdown(
        """
        <style>
        [data-testid="stSidebar"] {
            display: none !important;
        }
        [data-testid="stSidebarCollapsedControl"],
        [data-testid="stSidebarCollapseButton"],
        [data-testid="stExpandSidebarButton"] {
            display: none !important;
        }
        .stApp {
            padding-left: 0 !important;
        }
        </style>
        <div class="public-shell"></div>
        """,
        unsafe_allow_html=True,
    )


def titulo_pagina(titulo: str, subtitulo: str = "") -> None:
    if not titulo and not subtitulo:
        return
    st.markdown('<div class="norte-hero">', unsafe_allow_html=True)
    if titulo:
        st.markdown(f'<h2 class="page-title">{titulo}</h2>', unsafe_allow_html=True)
    if subtitulo:
        st.markdown(f'<div class="norte-subtitle">{subtitulo}</div>', unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)


def card_metrica(rotulo: str, valor: str, nota: str = "") -> None:
    nota_html = f'<div class="metric-note">{nota}</div>' if nota else ""
    st.markdown(
        f"""
        <div class="metric-card">
            <div class="metric-label">{rotulo}</div>
            <div class="metric-value">{valor}</div>
            {nota_html}
        </div>
        """,
        unsafe_allow_html=True,
    )


def cards_indicadores(indicadores: dict[str, object]) -> None:
    itens = [
        ("OL Sem Combate", formatar_moeda(indicadores.get("ol_sem_combate", 0))),
        ("OL Prioritários", formatar_moeda(indicadores.get("ol_prioritarios", 0))),
        ("% Prioritários", formatar_percentual(indicadores.get("percentual_prioritarios", 0))),
        ("OL Lançamentos", formatar_moeda(indicadores.get("ol_lancamentos", 0))),
        ("% Lançamentos", formatar_percentual(indicadores.get("percentual_lancamentos", 0))),
        ("Clientes positivados", f"{int(indicadores.get('clientes_positivados', 0)):,}".replace(",", ".")),
        ("Clientes sem compra", f"{int(indicadores.get('clientes_sem_compra', 0)):,}".replace(",", ".")),
        ("Pedidos", f"{int(indicadores.get('quantidade_pedidos', 0)):,}".replace(",", ".")),
        ("Ticket médio", formatar_moeda(indicadores.get("ticket_medio", 0))),
    ]
    colunas = st.columns(3)
    for idx, (rotulo, valor) in enumerate(itens):
        with colunas[idx % 3]:
            card_metrica(rotulo, valor)


def status_periodo_html(resumo: dict[str, object], titulo: bool = True) -> str:
    titulo_html = '<div class="status-title">Pedidos e notas do período</div>' if titulo else ""

    def card(rotulo: str, valor: str, nota: str) -> str:
        return (
            '<div class="metric-card">'
            f'<div class="metric-label">{rotulo}</div>'
            f'<div class="metric-value">{valor}</div>'
            f'<div class="metric-note">{nota}</div>'
            '</div>'
        )

    return (
        '<div class="status-grid">'
        + card("Combate", formatar_moeda(resumo.get("valor_combate", 0)), "Valor de combate no período")
        + card("Faturado do período", formatar_moeda(resumo.get("faturado_periodo", 0)), "Base refletida pelas últimas cargas")
        + card(
            "Sem venda",
            str(int(resumo.get("clientes_sem_venda", 0) or 0)),
            f"{int(resumo.get('clientes_ativos', 0) or 0)} CNPJs - {int(resumo.get('clientes_com_venda', 0) or 0)} com venda",
        )
        + "</div>"
        + titulo_html
        + '<div class="status-grid">'
        + card(
            "Pedidos faturados",
            str(int(resumo.get("pedidos_faturados", 0) or 0)),
            f"{formatar_moeda(resumo.get('valor_pedidos_faturados', 0))} faturado",
        )
        + card(
            "Sem nota",
            str(int(resumo.get("pedidos_sem_nota", 0) or 0)),
            f"{formatar_moeda(resumo.get('valor_sem_nota', 0))} a faturar",
        )
        + card(
            "Cancelados",
            str(int(resumo.get("pedidos_cancelados", 0) or 0)),
            f"{formatar_moeda(resumo.get('valor_cancelado', 0))} cancelado",
        )
        + "</div>"
    )


def mostrar_status_periodo(resumo: dict[str, object], titulo: bool = True) -> None:
    st.markdown(status_periodo_html(resumo, titulo=titulo), unsafe_allow_html=True)


def mostrar_avisos(avisos: list[str]) -> None:
    for aviso in avisos:
        st.warning(aviso)


def dataframe_com_download(df: pd.DataFrame, nome: str, altura: int = 420) -> None:
    st.dataframe(df, width="stretch", height=altura)
    st.download_button(
        "Baixar CSV",
        data=df.to_csv(index=False, sep=";", encoding="utf-8-sig"),
        file_name=f"{nome}.csv",
        mime="text/csv",
        width="stretch",
    )


def dataframe_para_excel_bytes(df: pd.DataFrame, sheet_name: str = "dados") -> bytes:
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name=sheet_name[:31])
    return buffer.getvalue()


def botao_download_excel(df: pd.DataFrame, nome_arquivo: str, rotulo: str = "Baixar Excel") -> None:
    st.download_button(
        rotulo,
        data=dataframe_para_excel_bytes(df),
        file_name=nome_arquivo,
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        width="stretch",
    )
