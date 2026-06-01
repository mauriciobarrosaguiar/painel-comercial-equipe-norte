from __future__ import annotations

import importlib
from pathlib import Path
import runpy
import sys

import streamlit as st


APP_RUNTIME_VERSION = "2026-06-01-1145"
ROOT = Path(__file__).resolve().parent

PAGINAS = [
    ("Visão Geral", "pages/01_Visao_Geral.py"),
    ("Consultores", "pages/02_Consultores.py"),
    ("Clientes", "pages/03_Clientes.py"),
    ("SIP", "pages/04_SIP_Redes.py"),
    ("Foco Semanal", "pages/12_Foco_Semanal.py"),
    ("Ações Promocionais", "pages/05_Acoes_Promocionais.py"),
    ("Produtos / Mix", "pages/06_Produtos_Mix.py"),
    ("Oportunidades", "pages/07_Oportunidades.py"),
    ("Mercado Farma / UF", "pages/10_Mercado_Farma_UF.py"),
    ("Desafio de Gigantes", "pages/09_Desafio_Gigantes.py"),
    ("Histórico", "pages/13_Historico.py"),
    ("Importação", "pages/08_Importar_Bases.py"),
]


def _preparar_runtime() -> None:
    if st.session_state.get("_painel_runtime_version") == APP_RUNTIME_VERSION:
        return
    for nome in list(sys.modules):
        if nome.startswith("src.") or nome == "bussola_extrator":
            sys.modules.pop(nome, None)
    st.session_state["_painel_runtime_version"] = APP_RUNTIME_VERSION


def _layout():
    return importlib.import_module("src.layout")


def main() -> None:
    _preparar_runtime()
    layout = _layout()
    layout.configurar_pagina()
    sip_publico = str(st.query_params.get("sip", "") or "").strip()
    if sip_publico:
        layout.ocultar_sidebar_publica()
        runpy.run_path(str(ROOT / "pages/11_Acesso_SIP.py"), run_name="__main__")
        return

    st.sidebar.markdown("## Painel Comercial")
    st.sidebar.caption("Equipe Norte")
    st.sidebar.markdown('<div class="sidebar-spacer"></div>', unsafe_allow_html=True)

    escolha = st.sidebar.radio("Menu", [titulo for titulo, _ in PAGINAS], label_visibility="collapsed")
    caminho = dict(PAGINAS)[escolha]
    runpy.run_path(str(ROOT / caminho), run_name="__main__")


if __name__ == "__main__":
    main()
