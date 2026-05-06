from __future__ import annotations

import streamlit as st

from src.layout import titulo_pagina


titulo_pagina("Desafio de Gigantes")

st.markdown(
    """
    <div class="soft-panel">
        <div class="contact-line">Esta área ficará reservada para configurarmos a campanha depois.</div>
    </div>
    """,
    unsafe_allow_html=True,
)
