"""Carrega a triagem regulatória documentada por EAN no Turso principal.

Não adivinha categorias: preserva revisões manuais e deixa EANs novos sem
classificação. Dados farmacêuticos NÃO substituem bula nem registro Anvisa.
"""
from __future__ import annotations

import csv
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import turso_backend as turso  # noqa: E402

ARQUIVO = ROOT / "data/classificacao/classificacoes_anvisa_2026-11-13.csv"
VALIDAS = {"OTC", "PRESCRICAO", "CONTROLADO", "ANTIMICROBIANO", "NAO_CLASSIFICADO"}
FONTES_OFICIAIS = {
    "CONTROLADO": {"ANVISA_RDC_1036_2026"},
    "ANTIMICROBIANO": {"ANVISA_IN_360_2025"},
    "OTC": {"ANVISA_IN_285_2024", "ANVISA_LMN_BAIXO_RISCO"},
}
AMOSTRAS = {
    "7896004718811": "CONTROLADO",     # alprazolam
    "7896004792293": "CONTROLADO",     # lisdexanfetamina
    "7896004756417": "CONTROLADO",     # paracetamol + codeina
    "7896004703404": "ANTIMICROBIANO", # amoxicilina + clavulanato
    "7896004703596": "OTC",            # paracetamol 750mg
    "7896004701820": "PRESCRICAO",     # diclofenaco oral
}


def carregar_planilha() -> list[dict[str, str]]:
    with ARQUIVO.open(encoding="utf-8-sig", newline="") as arquivo:
        linhas = list(csv.DictReader(arquivo, delimiter=";"))
    mapa = {}
    for row in linhas:
        ean = str(row.get("EAN") or "").strip()
        categoria = str(row.get("CATEGORIA") or "").strip()
        fonte = str(row.get("FONTE") or "").strip()
        produto = str(row.get("PRODUTO") or "").strip()
        if not re.fullmatch(r"\d{8,14}", ean) or ean in mapa:
            raise ValueError("EAN vazio, inválido ou duplicado na classificação.")
        if categoria not in VALIDAS or not fonte or not produto:
            raise ValueError(f"Classificação inválida para EAN {ean}.")
        if categoria in FONTES_OFICIAIS and fonte not in FONTES_OFICIAIS[categoria]:
            raise ValueError(f"Falta referência regulatória para EAN {ean}.")
        if categoria == "PRESCRICAO" and fonte not in {
            "TRIAGEM_PRESCRICAO_CONFERIR_BULA", "ANVISA_EXCECAO_TOPICA"
        }:
            raise ValueError(f"Origem da prescrição não documentada: {ean}.")
        mapa[ean] = row
    if len(mapa) != 427:
        raise ValueError(f"Esperados 427 EANs auditados; encontrados {len(mapa)}.")
    for ean, categoria in AMOSTRAS.items():
        if mapa.get(ean, {}).get("CATEGORIA") != categoria:
            raise ValueError(f"Revisar medicamento sentinela EAN {ean}.")
    return list(mapa.values())


def main() -> None:
    if not turso.configured():
        raise RuntimeError("Turso não configurado: não executar importação.")
    linhas = carregar_planilha()
    banco = turso.database_id()

    turso.executar(banco, """
        CREATE TABLE IF NOT EXISTS produto_classificacao_farmaceutica (
          ean TEXT PRIMARY KEY,
          categoria TEXT NOT NULL CHECK (categoria IN
            ('OTC','PRESCRICAO','CONTROLADO','ANTIMICROBIANO','NAO_CLASSIFICADO')),
          fonte TEXT NOT NULL DEFAULT 'CONFERENCIA_MANUAL',
          atualizado_por TEXT NOT NULL DEFAULT '',
          atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    turso.executar(banco, """
        CREATE INDEX IF NOT EXISTS idx_produto_classificacao_categoria
        ON produto_classificacao_farmaceutica(categoria, ean)
    """)

    atual = turso.linhas(turso.executar(
        banco,
        "SELECT DISTINCT TRIM(ean) AS ean FROM mercado_farma_precos WHERE TRIM(COALESCE(ean,''))<>''"
    ))
    ativos = {str(row["ean"]).strip() for row in atual if row.get("ean")}
    encontrados = {row["EAN"] for row in linhas}
    comuns = ativos & encontrados
    if not comuns:
        raise RuntimeError("Nenhum EAN do catálogo coincide com o Turso; importação abortada.")
    if len(comuns) < min(50, len(ativos)):
        raise RuntimeError(
            f"Apenas {len(comuns)} de {len(ativos)} EANs ativos coincidem; "
            "importação abortada para evitar base incorreta."
        )

    sql = """
        INSERT INTO produto_classificacao_farmaceutica
          (ean, categoria, fonte, atualizado_por, atualizado_em)
        VALUES (?, ?, ?, 'IMPORTACAO_REGULATORIA_2026_11_13', CURRENT_TIMESTAMP)
        ON CONFLICT(ean) DO NOTHING
    """
    consultas = [
        {"sql": sql, "params": [row["EAN"], row["CATEGORIA"], row["FONTE"]]}
        for row in linhas
    ]
    turso.executar_lotes(banco, consultas, tamanho=20)

    totais = turso.linhas(turso.executar(
        banco,
        """SELECT categoria, COUNT(*) AS total FROM produto_classificacao_farmaceutica
           GROUP BY categoria ORDER BY categoria"""
    ))
    falta = turso.linhas(turso.executar(
        banco,
        """SELECT COUNT(DISTINCT mf.ean) AS total FROM mercado_farma_precos mf
           LEFT JOIN produto_classificacao_farmaceutica cf ON cf.ean=mf.ean
           WHERE cf.ean IS NULL"""
    ))
    qtd = Counter({row["CATEGORIA"]: 0 for row in linhas})
    qtd.update(row["CATEGORIA"] for row in linhas)
    print(f"EANs auditados na planilha: {len(linhas)}")
    print(f"EANs distintos na extração ativa: {len(ativos)}")
    print(f"EANs da extração cobertos pela base: {len(comuns)}")
    print(f"EANs da extração sem classificação importada: {falta[0]['total'] if falta else 'indisponivel'}")
    print("Categorias da base auditada:", dict(sorted(qtd.items())))
    print("Categorias atuais no Turso:", {
        str(r["categoria"]): int(r["total"]) for r in totais
    })
    print("Concluído. Classificações manuais preexistentes preservadas.")


if __name__ == "__main__":
    main()
