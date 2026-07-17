from __future__ import annotations

from pathlib import Path
import runpy

import streamlit as st
import src.layout as layout


ROOT = Path(__file__).resolve().parent

PAGINAS_POR_AREA = {
    "Dashboard": [
        ("Visão Geral", "pages/01_Visao_Geral.py"),
        ("Consultores", "pages/02_Consultores.py"),
    ],
    "Comercial": [
        ("Clientes", "pages/03_Clientes.py"),
        ("Foco Semanal", "pages/12_Foco_Semanal.py"),
        ("Oportunidades", "pages/07_Oportunidades.py"),
        ("Desafio de Gigantes", "pages/09_Desafio_Gigantes.py"),
    ],
    "Campanhas e SIP": [
        ("SIP / Redes", "pages/04_SIP_Redes.py"),
        ("Acessos SIP", "pages/15_Acessos_SIP.py"),
        ("Ações Promocionais", "pages/05_Acoes_Promocionais.py"),
    ],
    "Produtos e Mercado": [
        ("Produtos / Mix", "pages/06_Produtos_Mix.py"),
        ("Mercado Farma / UF", "pages/10_Mercado_Farma_UF.py"),
    ],
    "Relatórios e Administração": [
        ("Histórico", "pages/13_Historico.py"),
        ("Importação", "pages/08_Importar_Bases.py"),
        ("Templates de Bases", "pages/14_Templates_Bases.py"),
    ],
}


def _neutralizar_css_markdown_problematico() -> None:
    """Evita que o CSS complementar antigo seja renderizado como texto."""
    if hasattr(layout, "_aplicar_css_responsivo"):
        layout._aplicar_css_responsivo = lambda: None


def _aplicar_ajustes_mobile() -> None:
    st.markdown(
        """<style>
@media (max-width: 992px) {
    .block-container {
        padding-top: 1.4rem !important;
        padding-left: 1rem !important;
        padding-right: 1rem !important;
    }
    .page-title { font-size: 1.5rem !important; }
}
@media (max-width: 640px) {
    .block-container {
        padding-top: 1rem !important;
        padding-left: .65rem !important;
        padding-right: .65rem !important;
    }
    .page-title { font-size: 1.25rem !important; line-height: 1.25 !important; }
    .norte-subtitle { font-size: .85rem !important; }
    div[data-testid="stHorizontalBlock"] {
        flex-wrap: wrap !important;
        gap: .65rem !important;
    }
    div[data-testid="stHorizontalBlock"] > div[data-testid="stColumn"] {
        min-width: calc(50% - .4rem) !important;
        width: calc(50% - .4rem) !important;
        flex: 1 1 calc(50% - .4rem) !important;
    }
    [data-testid="stDataFrame"], [data-testid="stTable"] {
        overflow-x: auto !important;
    }
    .stButton > button, .stDownloadButton > button {
        width: 100% !important;
        min-height: 44px !important;
    }
    [data-testid="stSidebar"] .stSelectbox,
    [data-testid="stSidebar"] .stRadio {
        margin-bottom: .35rem !important;
    }
}
@media (max-width: 430px) {
    div[data-testid="stHorizontalBlock"] > div[data-testid="stColumn"] {
        min-width: 100% !important;
        width: 100% !important;
        flex-basis: 100% !important;
    }
}
@media print {
    [data-testid="stSidebar"], [data-testid="stToolbar"], header[data-testid="stHeader"] {
        display: none !important;
    }
    .stApp { background: #fff !important; }
}
</style>""",
        unsafe_allow_html=True,
    )


def main() -> None:
    _neutralizar_css_markdown_problematico()
    layout.configurar_pagina()
    _aplicar_ajustes_mobile()

    sip_publico = str(st.query_params.get("sip", "") or "").strip()
    if sip_publico:
        layout.ocultar_sidebar_publica()
        runpy.run_path(str(ROOT / "pages/11_Acesso_SIP.py"), run_name="__main__")
        return

    st.sidebar.markdown("## Painel Comercial")
    st.sidebar.caption("Equipe Norte")
    st.sidebar.markdown('<div class="sidebar-spacer"></div>', unsafe_allow_html=True)

    areas = list(PAGINAS_POR_AREA)
    area = st.sidebar.selectbox("Área", areas, key="menu_area")
    paginas = PAGINAS_POR_AREA[area]
    escolha = st.sidebar.radio(
        "Página",
        [titulo for titulo, _ in paginas],
        label_visibility="collapsed",
        key=f"menu_pagina_{area}",
    )
    caminho = dict(paginas)[escolha]
    runpy.run_path(str(ROOT / caminho), run_name="__main__")


if __name__ == "__main__":
    main()
