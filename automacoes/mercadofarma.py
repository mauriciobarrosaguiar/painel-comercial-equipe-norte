from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.configuracoes import carregar_login_bussola, consultores_unicos
from src.datas import agora_brasilia
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


def _rodando_no_actions_sem_persistencia() -> bool:
    return os.environ.get("GITHUB_ACTIONS", "").lower() == "true" and not os.environ.get("PERSISTENCE_KEY")


def main() -> int:
    parser = argparse.ArgumentParser(description="Extrai Mercado Farma para uma UF.")
    parser.add_argument("--uf", required=True, help="UF que sera extraida, ex.: MA")
    parser.add_argument("--saida", default="data/mercadofarma/parciais", help="Pasta dos arquivos parciais")
    parser.add_argument("--limite-eans", type=int, default=0, help="Limite para teste. 0 consulta todos.")
    parser.add_argument("--visivel", action="store_true", help="Executa navegador visivel.")
    args = parser.parse_args()

    uf = args.uf.strip().upper()
    saida_dir = ROOT / args.saida
    status_dir = ROOT / "data" / "mercadofarma" / "status"
    debug_dir = ROOT / "data" / "mercadofarma" / "debug" / uf
    csv_path = saida_dir / f"mercadofarma_{uf}.csv"
    status_path = status_dir / f"mercadofarma_{uf}.json"
    status = {
        "uf": uf,
        "status": "erro",
        "consultor_usado": "",
        "cnpj_referencia": "",
        "total_produtos": 0,
        "erro": "",
        "etapa": "inicio",
        "traceback": "",
        "iniciado_em": agora_brasilia().isoformat(),
        "finalizado_em": "",
    }

    try:
        _log(f"Iniciando extracao Mercado Farma para UF {uf}")
        if _rodando_no_actions_sem_persistencia():
            raise RuntimeError(
                "PERSISTENCE_KEY nao esta configurado nos Secrets do GitHub Actions. "
                "Sem essa chave o robo nao consegue ler os logins salvos no painel."
            )

        status["etapa"] = "carregar_bases"
        dados = carregar_dados_tratados()
        clientes = dados["clientes"]
        produtos_mercado = dados["produtos_mercado_farma"]
        login = carregar_login_bussola()
        credenciais = _credenciais_por_consultor(login, consultores_unicos(clientes))
        alvos = [alvo for alvo in alvos_unicos_por_uf(clientes, credenciais, exigir_login=True) if alvo.get("uf") == uf]
        if not alvos:
            raise RuntimeError(f"Nao encontrei consultor com login e CNPJ referencia para UF {uf}.")
        alvo = alvos[0]
        status["consultor_usado"] = alvo.get("consultor", "")
        status["cnpj_referencia"] = alvo.get("cnpj", "")
        _log(f"Consultor usado: {status['consultor_usado']}")
        _log(f"CNPJ referencia: {status['cnpj_referencia']}")

        status["etapa"] = "carregar_eans"
        eans = obter_eans_para_consulta(produtos_mercado)
        if args.limite_eans:
            eans = eans[: args.limite_eans]
        if not eans:
            raise RuntimeError("Nenhum EAN encontrado na planilha produtos.xlsx.")

        resultados: list[dict] = []
        status["etapa"] = "extracao_mercado_farma"
        _extrair_alvo(alvo, eans, headless=not args.visivel, resultados=resultados, log_fn=_log, debug_dir=debug_dir)
        status["etapa"] = "salvar_arquivo"
        df = _csv_saida(pd.DataFrame(resultados))
        saida_dir.mkdir(parents=True, exist_ok=True)
        df.to_csv(csv_path, index=False, encoding="utf-8-sig")
        total = int(df["EAN"].dropna().astype(str).nunique()) if "EAN" in df.columns else len(df)
        status.update({"status": "sucesso", "total_produtos": total, "arquivo": str(csv_path.relative_to(ROOT)), "etapa": "concluido"})
        _log(f"Total de produtos extraidos: {total}")
        _log("Arquivo parcial salvo com sucesso")
        status["finalizado_em"] = agora_brasilia().isoformat()
        _salvar_status(status_path, status)
        return 0
    except Exception as exc:
        status["erro"] = str(exc)
        status["traceback"] = traceback.format_exc(limit=8)
        status["finalizado_em"] = agora_brasilia().isoformat()
        _log(f"Erro na extracao Mercado Farma UF {uf}: {exc}")
        _log(status["traceback"])
        _salvar_status(status_path, status)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
