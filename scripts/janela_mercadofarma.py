"""Protecao central para a janela de extracao 07:00-20:00 America/Sao_Paulo."""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Sao_Paulo")
ROOT = Path(__file__).resolve().parents[1]
MENSAGEM = "Mercado Farma bloqueado entre 20h e 07h (horario de Brasilia)."


def horario_permitido(agora: datetime | None = None) -> bool:
    atual = (agora or datetime.now(TZ)).astimezone(TZ)
    return 7 <= atual.hour < 20


def validar_janela(agora: datetime | None = None) -> None:
    if not horario_permitido(agora):
        raise RuntimeError(MENSAGEM)


def segundos_ate_bloqueio(agora: datetime | None = None) -> int:
    atual = (agora or datetime.now(TZ)).astimezone(TZ)
    validar_janela(atual)
    limite = atual.replace(hour=20, minute=0, second=0, microsecond=0)
    # Encerrar o processo antes das 20h, mesmo durante uma chamada Selenium.
    return max(0, int((limite - atual).total_seconds()) - 10)


def registrar_interrupcao(uf: str) -> None:
    codigo = uf.strip().upper()
    if len(codigo) != 2 or not codigo.isalpha():
        raise ValueError("UF invalida")
    agora = datetime.now(TZ).isoformat()
    arquivo = ROOT / "data" / "mercadofarma" / "status" / f"mercadofarma_{codigo}.json"
    arquivo.parent.mkdir(parents=True, exist_ok=True)
    # Um CSV incompleto nunca deve ser interpretado como extração válida.
    parcial = ROOT / "data" / "mercadofarma" / "parciais" / f"mercadofarma_{codigo}.csv"
    if parcial.exists():
        parcial.unlink()
    arquivo.write_text(json.dumps({
        "uf": codigo,
        "status": "erro",
        "etapa": "janela_horaria",
        "erro": "Execucao interrompida automaticamente antes das 20h para evitar bloqueio do Mercado Farma.",
        "finalizado_em": agora,
    }, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--check", action="store_true")
    grupo.add_argument("--seconds", action="store_true")
    grupo.add_argument("--registrar-interrupcao", metavar="UF")
    args = parser.parse_args()
    if args.registrar_interrupcao:
        registrar_interrupcao(args.registrar_interrupcao)
        return 0
    try:
        validar_janela()
        if args.seconds:
            restante = segundos_ate_bloqueio()
            if restante <= 0:
                raise RuntimeError("Janela de extracao encerrando. Aguarde ate 07h.")
            print(restante)
        return 0
    except RuntimeError as erro:
        print(f"::error::{erro}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
