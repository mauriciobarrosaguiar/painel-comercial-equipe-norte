from __future__ import annotations

import importlib
from pathlib import Path
import runpy

import streamlit as st


ROOT = Path(__file__).resolve().parent


def _neutralizar_css_markdown_problematico(layout) -> None:
    if hasattr(layout, "_aplicar_css_responsivo"):
        layout._aplicar_css_responsivo = lambda: None


def _aplicar_css_publico_mobile() -> None:
    st.markdown(
        """<style>
@media (max-width: 992px) {
    .block-container {
        padding-top: 1.2rem !important;
        padding-left: 1rem !important;
        padding-right: 1rem !important;
    }
}
@media (max-width: 640px) {
    .block-container {
        padding-top: .8rem !important;
        padding-left: .65rem !important;
        padding-right: .65rem !important;
    }
    div[data-testid="stHorizontalBlock"] {
        flex-wrap: wrap !important;
        gap: .65rem !important;
    }
    div[data-testid="stHorizontalBlock"] > div[data-testid="stColumn"] {
        min-width: 100% !important;
        width: 100% !important;
        flex-basis: 100% !important;
    }
    [data-testid="stDataFrame"], [data-testid="stTable"] {
        overflow-x: auto !important;
    }
    .stButton > button, .stDownloadButton > button {
        width: 100% !important;
        min-height: 44px !important;
    }
}
</style>""",
        unsafe_allow_html=True,
    )


def main() -> None:
    layout = importlib.import_module("src.layout")
    _neutralizar_css_markdown_problematico(layout)
    layout.configurar_pagina()
    _aplicar_css_publico_mobile()
    layout.ocultar_sidebar_publica()

    token_sip = str(st.query_params.get("sip", "") or "").strip()
    if not token_sip:
        layout.titulo_pagina("Painel SIP")
        st.info("Abra o link completo fornecido pelo responsável comercial para acessar os resultados da sua SIP.")
        return

    runpy.run_path(str(ROOT / "pages/11_Acesso_SIP.py"), run_name="__main__")


if __name__ == "__main__":
    main()
