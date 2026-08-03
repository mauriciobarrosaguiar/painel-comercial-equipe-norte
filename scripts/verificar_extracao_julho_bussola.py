from __future__ import annotations

import json
import shutil
from pathlib import Path

import pandas as pd

import bussola_extrator
from scripts import extrair_bussola_d1 as legacy
from src.bussola_web import _preparar_exportacao_para_painel


INICIO = "01/07/2026"
FIM = "31/07/2026"
RUNTIME = Path("/tmp/verificacao-bussola-julho")
SAIDA = RUNTIME / "saida"
DOWNLOADS = RUNTIME / "downloads"


def normalizado(value) -> str:
    return str(value or "").strip().upper()


def main() -> None:
    if RUNTIME.exists():
        shutil.rmtree(RUNTIME)
    SAIDA.mkdir(parents=True, exist_ok=True)
    DOWNLOADS.mkdir(parents=True, exist_ok=True)

    usuario, segredo = legacy.obter_credenciais()
    bussola_extrator.executar(
        usuario=usuario,
        senha=segredo,
        saida=str(SAIDA),
        downloads=str(DOWNLOADS),
        headless=True,
        data_inicial=INICIO,
        data_final=FIM,
        log_fn=lambda mensagem: print(f"BUSSOLA_JULHO_ETAPA={mensagem}"),
    )

    csv_path = SAIDA / "Pedidos_bussola.csv"
    xlsx_path = SAIDA / "Pedidos.xlsx"
    if csv_path.exists():
        bruto = pd.read_csv(csv_path, sep=";", dtype=str, encoding="utf-8-sig")
    elif xlsx_path.exists():
        bruto = pd.read_excel(xlsx_path, dtype=str)
    else:
        raise RuntimeError("A extração mensal não gerou arquivo de pedidos.")

    base = _preparar_exportacao_para_painel(bruto, "Verificação julho")
    representante = base["representante"].fillna("").astype(str).str.upper()
    mauricio = base[representante.str.contains("MAURICIO BARROS DE AGUIAR", regex=False)].copy()

    resumo = {
        "linhas_brutas": int(len(bruto)),
        "linhas_tratadas": int(len(base)),
        "pedidos_gerais": int(base["pedido_id"].astype(str).nunique()),
        "solicitado_geral": round(float(base["valor_total_solicitado_sem_imposto"].sum()), 2),
        "atendido_geral": round(float(base["total_atendido_sem_imposto"].sum()), 2),
        "faturado_geral": round(float(base["valor_faturado"].sum()), 2),
        "pedidos_mauricio": int(mauricio["pedido_id"].astype(str).nunique()),
        "linhas_mauricio": int(len(mauricio)),
        "solicitado_mauricio": round(float(mauricio["valor_total_solicitado_sem_imposto"].sum()), 2),
        "atendido_mauricio": round(float(mauricio["total_atendido_sem_imposto"].sum()), 2),
        "faturado_mauricio": round(float(mauricio["valor_faturado"].sum()), 2),
        "status_mauricio": {
            normalizado(status): {
                "pedidos": int(grupo["pedido_id"].astype(str).nunique()),
                "solicitado": round(float(grupo["valor_total_solicitado_sem_imposto"].sum()), 2),
                "atendido": round(float(grupo["total_atendido_sem_imposto"].sum()), 2),
                "faturado": round(float(grupo["valor_faturado"].sum()), 2),
            }
            for status, grupo in mauricio.groupby("status_pedido", dropna=False)
        },
        "colunas_origem": [str(coluna) for coluna in bruto.columns],
    }
    print("EXTRACAO_MENSAL_JULHO_BUSSOLA=" + json.dumps(resumo, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
