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


def moeda(frame: pd.DataFrame, coluna: str) -> float:
    return round(float(frame[coluna].fillna(0).sum()), 2)


def calcular(frame: pd.DataFrame, quantidade: str, preco: str) -> float:
    total = frame[quantidade].fillna(0).astype(float) * frame[preco].fillna(0).astype(float)
    return round(float(total.sum()), 2)


def resumo_valores(frame: pd.DataFrame) -> dict[str, float | int]:
    return {
        "pedidos": int(frame["pedido_id"].astype(str).nunique()),
        "linhas": int(len(frame)),
        "solicitado_sem_imposto": moeda(frame, "valor_total_solicitado_sem_imposto"),
        "solicitado_com_imposto": moeda(frame, "valor_total_solicitado_com_imposto"),
        "atendido_sem_imposto": moeda(frame, "total_atendido_sem_imposto"),
        "atendido_com_imposto": moeda(frame, "total_atendido_com_imposto"),
        "faturado_exportado": moeda(frame, "valor_faturado"),
        "faturado_calculado_sem_imposto": calcular(frame, "quantidade_faturada", "preco_unitario_sem_imposto"),
        "faturado_calculado_com_imposto": calcular(frame, "quantidade_faturada", "preco_unitario_com_imposto"),
        "atendido_calculado_sem_imposto": calcular(frame, "quantidade_atendida", "preco_unitario_sem_imposto"),
        "atendido_calculado_com_imposto": calcular(frame, "quantidade_atendida", "preco_unitario_com_imposto"),
        "solicitado_calculado_sem_imposto": calcular(frame, "quantidade_solicitada", "preco_unitario_sem_imposto"),
        "solicitado_calculado_com_imposto": calcular(frame, "quantidade_solicitada", "preco_unitario_com_imposto"),
    }


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
        "geral": resumo_valores(base),
        "mauricio": resumo_valores(mauricio),
        "status_mauricio": {
            normalizado(status): resumo_valores(grupo)
            for status, grupo in mauricio.groupby("status_pedido", dropna=False)
        },
        "colunas_origem": [str(coluna) for coluna in bruto.columns],
    }
    print("COMPARACAO_VALORES_JULHO_BUSSOLA=" + json.dumps(resumo, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
