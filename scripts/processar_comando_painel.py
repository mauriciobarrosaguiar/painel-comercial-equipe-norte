from __future__ import annotations

import json
import os
import subprocess
from typing import Any

import requests

PAINEL_URL = os.environ.get("PAINEL_URL", "https://painel-equipe-norte.pages.dev").rstrip("/")
ADMIN_KEY = os.environ.get("PAINEL_ADMIN_KEY", "").strip()


def chamada_interna(payload: dict[str, Any]) -> dict[str, Any]:
    if not ADMIN_KEY:
        raise RuntimeError("PAINEL_ADMIN_KEY não configurada.")
    resposta = requests.post(
        f"{PAINEL_URL}/api/internal/automacoes",
        headers={"x-admin-key": ADMIN_KEY, "content-type": "application/json"},
        json=payload,
        timeout=60,
    )
    resposta.raise_for_status()
    return resposta.json()


def executar_workflow(nome: str, campos: dict[str, str] | None = None) -> None:
    comando = ["gh", "workflow", "run", nome]
    for chave, valor in (campos or {}).items():
        if valor:
            comando.extend(["-f", f"{chave}={valor}"])
    subprocess.run(comando, check=True)


def executar(comando: dict[str, Any]) -> tuple[str, str]:
    tipo = str(comando.get("tipo", "")).upper()
    parametros = comando.get("parametros") if isinstance(comando.get("parametros"), dict) else {}
    identificador = str(comando.get("id", ""))

    if tipo == "BUSSOLA":
        executar_workflow("bussola-d1.yml")
        return "despachado", "Extração do Bússola enviada ao GitHub Actions."
    if tipo == "MERCADO_FARMA":
        executar_workflow(
            "mercadofarma.yml",
            {
                "acao": "atualizar_mercadofarma_paralelo",
                "ufs": str(parametros.get("ufs", "MA,MT,PA,PI,TO")),
                "command_id": identificador,
            },
        )
        return "despachado", "Extração do Mercado Farma enviada ao GitHub Actions."
    if tipo == "MIGRAR_BASES":
        executar_workflow("migrar-bases-legadas-d1.yml", {"ano_mes": str(parametros.get("ano_mes", ""))})
        return "despachado", "Migração das bases enviada ao GitHub Actions."
    if tipo == "FECHAMENTO_MENSAL":
        executar_workflow("fechamento-mensal.yml", {"ano_mes": str(parametros.get("ano_mes", ""))})
        return "despachado", "Fechamento mensal enviado ao GitHub Actions."
    if tipo == "AUDITORIA":
        resposta = requests.post(
            f"{PAINEL_URL}/api/admin/auditoria",
            headers={"x-admin-key": ADMIN_KEY},
            timeout=120,
        )
        resposta.raise_for_status()
        return "concluido", "Auditoria dos cálculos concluída."
    raise RuntimeError(f"Tipo de automação não reconhecido: {tipo}")


def main() -> None:
    dados = chamada_interna({"acao": "proxima"})
    comando = dados.get("comando")
    if not comando:
        print("Nenhum comando aguardando processamento.")
        return

    identificador = str(comando.get("id", ""))
    try:
        status, mensagem = executar(comando)
        chamada_interna({"acao": "finalizar", "id": identificador, "status": status, "mensagem": mensagem})
        print(mensagem)
    except Exception as exc:
        chamada_interna({"acao": "finalizar", "id": identificador, "status": "erro", "erro": str(exc)[:1000]})
        raise


if __name__ == "__main__":
    main()
