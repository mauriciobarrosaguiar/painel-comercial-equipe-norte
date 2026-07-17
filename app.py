from __future__ import annotations

import importlib
from pathlib import Path
import runpy
import sys

import streamlit as st


APP_RUNTIME_VERSION = "2026-07-17-menu-seguranca-sip"
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


def _preparar_runtime() -> None:
    if st.session_state.get("_painel_runtime_version") == APP_RUNTIME_VERSION:
        return
    for nome in list(sys.modules):
        if nome.startswith("src.") or nome == "bussola_extrator":
            sys.modules.pop(nome, None)
    st.session_state["_painel_runtime_version"] = APP_RUNTIME_VERSION


def _layout():
    return importlib.import_module("src.layout")


def _aplicar_ajustes_mobile() -> None:
    st.markdown(
        """
        <style>
        @media (max-width: 640px) {
            div[data-testid="stHorizontalBlock"] {
                flex-wrap: wrap !important;
                gap: .65rem !important;
            }
            div[data-testid="stHorizontalBlock"] > div[data-testid="stColumn"] {
                min-width: calc(50% - .4rem) !important;
                width: calc(50% - .4rem) !important;
                flex: 1 1 calc(50% - .4rem) !important;
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
        </style>
        """,
        unsafe_allow_html=True,
    )


def main() -> None:
    _preparar_runtime()
    layout = _layout()
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
