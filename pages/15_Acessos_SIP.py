from __future__ import annotations

from datetime import date, timedelta
import os

import streamlit as st

from src.datas import hoje_brasilia
from src.layout import titulo_pagina
from src.sip_store import atualizar_acesso_publico_sip, carregar_sips, normalizar_grupo_sip


def _url_publica_sip() -> str:
    try:
        configurada = str(st.secrets.get("PUBLIC_SIP_URL", "") or "").strip()
    except Exception:
        configurada = ""
    configurada = configurada or str(os.environ.get("PUBLIC_SIP_URL", "") or "").strip()
    return (configurada or "https://painelequipeale-sip.streamlit.app/").rstrip("/") + "/"


titulo_pagina("Acessos SIP", "Controle os links externos compartilhados com cada cliente.")

grupos = [normalizar_grupo_sip(grupo) for grupo in carregar_sips()]
if not grupos:
    st.info("Cadastre uma SIP antes de gerar um acesso externo.")
    st.stop()

nomes = [grupo["nome"] for grupo in grupos]
nome = st.selectbox("SIP", nomes, key="acesso_sip_nome")
grupo = next(item for item in grupos if item["nome"] == nome)

st.warning(
    "Ao regenerar o link, o endereço anterior deixa de funcionar imediatamente. "
    "Use essa opção quando um link for enviado para a pessoa errada."
)

ativo = st.toggle(
    "Acesso externo ativo",
    value=bool(grupo.get("acesso_publico_ativo", True)),
    key=f"acesso_ativo_{grupo['id']}",
)

expiracao_atual = str(grupo.get("acesso_publico_expira_em") or "").strip()
tem_expiracao = st.checkbox(
    "Definir data de expiração",
    value=bool(expiracao_atual),
    key=f"acesso_tem_expiracao_{grupo['id']}",
)

expiracao = None
if tem_expiracao:
    valor_padrao = hoje_brasilia() + timedelta(days=30)
    if expiracao_atual:
        try:
            valor_padrao = date.fromisoformat(expiracao_atual[:10])
        except ValueError:
            pass
    expiracao = st.date_input(
        "Link válido até",
        value=valor_padrao,
        min_value=hoje_brasilia(),
        format="DD/MM/YYYY",
        key=f"acesso_expira_{grupo['id']}",
    )

link_completo = f"{_url_publica_sip()}?sip={grupo['id']}"
st.markdown("#### Link atual")
st.code(link_completo, language="text")
st.caption("O link usa o aplicativo público separado. O painel interno pode permanecer privado.")

c1, c2 = st.columns(2)
if c1.button("Salvar regras de acesso", width="stretch", key=f"salvar_acesso_{grupo['id']}"):
    atualizar_acesso_publico_sip(
        grupo["id"],
        ativo=ativo,
        expira_em=expiracao,
        regenerar_link=False,
    )
    st.success("Regras de acesso salvas.")
    st.session_state["acesso_sip_nome"] = nome
    st.rerun()

confirmar = c2.checkbox("Confirmar novo link", key=f"confirmar_regenerar_{grupo['id']}")
if c2.button(
    "Revogar e gerar novo link",
    width="stretch",
    disabled=not confirmar,
    key=f"regenerar_acesso_{grupo['id']}",
):
    atualizar_acesso_publico_sip(
        grupo["id"],
        ativo=ativo,
        expira_em=expiracao,
        regenerar_link=True,
    )
    st.success("O link anterior foi revogado e um novo link foi criado.")
    st.session_state["acesso_sip_nome"] = nome
    st.rerun()

if ativo:
    st.link_button("Abrir visão externa da SIP", link_completo, width="stretch")
else:
    st.info("O acesso está desativado. Ative e salve para liberar o link.")
