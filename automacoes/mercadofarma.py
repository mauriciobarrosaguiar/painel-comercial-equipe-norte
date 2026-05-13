from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.configuracoes import carregar_login_bussola, consultores_unicos
from src.loader import carregar_dados_tratados
from src.mercado_farma import (
    _extrair_alvo,
    alvos_unicos_por_uf,
    obter_eans_para_consulta,
    preparar_mercado_farma,
)


COLUNAS_CSV = {
    "uf": "UF",
    "consultor": "CONSULTOR_USADO",
    "cnpj_referencia": "CNPJ_REFERENCIA",
    "ean": "EAN",
    "produto": "PRODUTO",
    "distribuidora": "DISTRIBUIDORA",
    "estoque": "ESTOQUE",
    "desconto": "DESCONTO",
    "pf_dist": "PF_DIST",
    "pf_fabrica": "PF_FABRICA",
    "preco_com_imposto": "PRECO_COM_IMPOSTO",
    "preco_sem_imposto": "PRECO_SEM_IMPOSTO",
    "data_atualizacao": "DATA_ATUALIZACAO",
    "status": "STATUS",
    "erro": "ERRO",
}


def _log(msg: str) -> None:
    print(msg, flush=True)


def _credenciais_por_consultor(login: dict, consultores: list[str]) -> list[dict[str, str]]:
    salvos = login.get("consultores", {}) if isinstance(login, dict) else {}
    credenciais = []
    for consultor in consultores:
        item = salvos.get(consultor, {})
        if item.get("usuario") and item.get("senha") and item.get("extrair", True):
            credenciais.append({"consultor": consultor, "usuario": item["usuario"], "senha": item["senha"]})
    return credenciais


def _salvar_status(path: Path, status: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")


def _csv_saida(df: pd.DataFrame) -> pd.DataFrame:
    base = preparar_mercado_farma(df)
    saida = base.rename(columns=COLUNAS_CSV)
    for coluna in COLUNAS_CSV.values():
        if coluna not in saida.columns:
            saida[coluna] = ""
    return saida[list(COLUNAS_CSV.values())]


def main() -> int:
    parser = argparse.ArgumentParser(description="Extrai Mercado Farma para uma UF.")
    parser.add_argument("--uf", required=True, help="UF que será extraída, ex.: MA")
    parser.add_argument("--saida", default="data/mercadofarma/parciais", help="Pasta dos arquivos parciais")
    parser.add_argument("--limite-eans", type=int, default=0, help="Limite para teste. 0 consulta todos.")
    parser.add_argument("--visivel", action="store_true", help="Executa navegador visível.")
    args = parser.parse_args()

    uf = args.uf.strip().upper()
    saida_dir = ROOT / args.saida
    status_dir = ROOT / "data" / "mercadofarma" / "status"
    csv_path = saida_dir / f"mercadofarma_{uf}.csv"
    status_path = status_dir / f"mercadofarma_{uf}.json"
    status = {"uf": uf, "status": "erro", "consultor_usado": "", "cnpj_referencia": "", "total_produtos": 0, "erro": ""}

    try:
        _log(f"Iniciando extração Mercado Farma para UF {uf}")
        dados = carregar_dados_tratados()
        clientes = dados["clientes"]
        produtos_mercado = dados["produtos_mercado_farma"]
        login = carregar_login_bussola()
        credenciais = _credenciais_por_consultor(login, consultores_unicos(clientes))
        alvos = [alvo for alvo in alvos_unicos_por_uf(clientes, credenciais, exigir_login=True) if alvo.get("uf") == uf]
        if not alvos:
            raise RuntimeError(f"Não encontrei consultor com login e CNPJ referência para UF {uf}.")
        alvo = alvos[0]
        status["consultor_usado"] = alvo.get("consultor", "")
        status["cnpj_referencia"] = alvo.get("cnpj", "")
        _log(f"Consultor usado: {status['consultor_usado']}")
        _log(f"CNPJ referência: {status['cnpj_referencia']}")

        eans = obter_eans_para_consulta(produtos_mercado)
        if args.limite_eans:
            eans = eans[: args.limite_eans]
        if not eans:
            raise RuntimeError("Nenhum EAN encontrado na planilha produtos.xlsx.")

        resultados: list[dict] = []
        _extrair_alvo(alvo, eans, headless=not args.visivel, resultados=resultados, log_fn=_log)
        df = _csv_saida(pd.DataFrame(resultados))
        saida_dir.mkdir(parents=True, exist_ok=True)
        df.to_csv(csv_path, index=False, encoding="utf-8-sig")
        total = int(df["EAN"].dropna().astype(str).nunique()) if "EAN" in df.columns else len(df)
        status.update({"status": "sucesso", "total_produtos": total, "arquivo": str(csv_path.relative_to(ROOT))})
        _log(f"Total de produtos extraídos: {total}")
        _log("Arquivo parcial salvo com sucesso")
        _salvar_status(status_path, status)
        return 0
    except Exception as exc:
        status["erro"] = str(exc)
        _log(f"Erro na extração Mercado Farma UF {uf}: {exc}")
        _salvar_status(status_path, status)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
