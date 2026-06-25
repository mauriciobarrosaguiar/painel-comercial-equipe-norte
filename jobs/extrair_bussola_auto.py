from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.bussola_automacao import executar_extracao_bussola_automatica


def imprimir_log(msg: str) -> None:
    print(msg, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Roda a extracao automatica da Bussola sem interface Streamlit.")
    parser.add_argument("--sem-lock", action="store_true", help="Roda sem arquivo de lock local.")
    parser.add_argument("--visivel", action="store_true", help="Tenta rodar o navegador visivel. No GitHub Actions sera headless.")
    args = parser.parse_args()

    headless = not args.visivel
    if os.environ.get("GITHUB_ACTIONS") == "true":
        headless = True

    try:
        executar_extracao_bussola_automatica(headless=headless, usar_lock=not args.sem_lock, log_fn=imprimir_log)
    except Exception as exc:
        print(f"Extracao automatica falhou: {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
