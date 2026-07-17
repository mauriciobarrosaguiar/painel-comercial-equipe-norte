from __future__ import annotations

import importlib
from pathlib import Path
import runpy

import streamlit as st


ROOT = Path(__file__).resolve().parent


def main() -> None:
    layout = importlib.import_module("src.layout")
    layout.configurar_pagina()
    layout.ocultar_sidebar_publica()

    token_sip = str(st.query_params.get("sip", "") or "").strip()
    if not token_sip:
        layout.titulo_pagina("Painel SIP")
        st.info("Abra o link completo fornecido pelo responsável comercial para acessar os resultados da sua SIP.")
        return

    runpy.run_path(str(ROOT / "pages/11_Acesso_SIP.py"), run_name="__main__")


if __name__ == "__main__":
    main()
