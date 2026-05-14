from __future__ import annotations

import re
from typing import Any

from src.persistencia import carregar_json, salvar_json
from src.tratamento import normalizar_texto_alto


FOCO_PADRAO = {"acoes": []}

REGRAS_MOLECULAS = [
    ("AMOXICILINA+CLAVULANATO", ("AMOXICILINA", "CLAVULANATO")),
    ("CLORIDRATO DE DULOXETINA", ("DULOXETINA",)),
]

ABREVIACOES_MOLECULAS = {
    "AMOXICILINA+CLAVULANATO": "AMOX+CLAV",
    "CLORIDRATO DE DULOXETINA": "DULOXETINA",
}

MARCADORES_APRESENTACAO = (
    " CPR ",
    " CAPS ",
    " CAP ",
    " COM ",
    " CAIXA ",
    " FRASCO ",
    " PO ",
    " PÓ ",
    " SUS ",
    " ORAL ",
    " MG ",
    " ML ",
    " X ",
    " C/ ",
    " REVESTIDO ",
    " LIB RET ",
)


def carregar_foco_semanal() -> dict[str, Any]:
    dados = carregar_json("foco_semanal", FOCO_PADRAO)
    if not isinstance(dados, dict):
        dados = FOCO_PADRAO.copy()
    acoes = dados.get("acoes", [])
    if not isinstance(acoes, list):
        acoes = []
    dados["acoes"] = [acao for acao in acoes if isinstance(acao, dict)]
    return dados


def salvar_foco_semanal(dados: dict[str, Any]) -> None:
    dados.setdefault("acoes", [])
    salvar_json("foco_semanal", dados, "Atualiza Foco Semanal pelo painel")


def identificar_molecula(produto: object) -> str:
    texto = normalizar_texto_alto(produto)
    if not texto:
        return "PRODUTO SEM DESCRIÇÃO"

    for nome, termos in REGRAS_MOLECULAS:
        if all(termo in texto for termo in termos):
            return nome

    texto_padrao = f" {texto} "
    cortes = [texto_padrao.find(marcador) for marcador in MARCADORES_APRESENTACAO if texto_padrao.find(marcador) > 0]
    if cortes:
        texto = texto_padrao[: min(cortes)].strip()
    texto = re.sub(r"\b\d+([,.]\d+)?\s*(MG|ML|G|MCG|UI)\b.*", "", texto).strip()
    texto = re.sub(r"\s+", " ", texto).strip(" -+/")
    return texto or normalizar_texto_alto(produto)[:45]


def abreviar_molecula(molecula: object) -> str:
    nome = normalizar_texto_alto(molecula)
    if nome in ABREVIACOES_MOLECULAS:
        return ABREVIACOES_MOLECULAS[nome]
    return nome[:22] if len(nome) > 22 else nome
