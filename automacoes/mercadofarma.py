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

from scripts import importar_mercadofarma_d1 as d1
from src.configuracoes import carregar_login_bussola
from src.datas import agora_brasilia
from src.mercado_farma import (
    _extrair_alvo,
    alvos_mercadofarma_por_uf,
    carregar_credenciais_mercadofarma,
    mascarar_usuario,
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


def _linhas_consulta(dados: dict) -> list[dict]:
    resultados = dados.get("result") or []
    if not resultados:
        return []
    primeiro = resultados[0] if isinstance(resultados[0], dict) else {}
    linhas = primeiro.get("results") or []
    return linhas if isinstance(linhas, list) else []


def _carregar_bases_d1() -> tuple[pd.DataFrame, pd.DataFrame]:
    database_id = d1.localizar_database_id()
    clientes_dados = d1.executar(
        database_id,
        """
        SELECT
          c.cnpj AS cnpj_limpo,
          c.cnpj,
          COALESCE(c.nome_fantasia,c.razao_social,'') AS nome_pdv,
          COALESCE(c.cidade,'') AS cidade,
          UPPER(TRIM(COALESCE(c.uf,''))) AS uf,
          COALESCE(c.situacao,'') AS situacao,
          COALESCE(c.grupo_economico,'') AS grupo_economico,
          COALESCE(c.rede_associacao,'') AS rede_associacao,
          COALESCE(c.bandeira,'') AS bandeira,
          COALESCE(c.nome_gd,'') AS nome_gd,
          COALESCE(co.nome,'') AS nome_rep,
          COALESCE(c.setor_rep,'') AS setor_rep,
          COALESCE(c.foco_pex,'') AS foco_pex,
          COALESCE(c.positivacao,'') AS positivacao,
          COALESCE(c.grupo_sip,'') AS grupo_sip,
          c.ativo AS cliente_ativo
        FROM clientes c
        LEFT JOIN consultores co ON co.id=c.consultor_id
        WHERE c.carteira_importada=1
          AND c.ativo=1
          AND LENGTH(TRIM(COALESCE(c.cnpj,'')))=14
        ORDER BY c.uf,c.nome_fantasia,c.cnpj
        """,
    )
    produtos_dados = d1.executar(
        database_id,
        """
        SELECT ean,descricao AS produto
          FROM produtos
         WHERE mercado_farma_ativo=1
           AND ativo=1
           AND TRIM(COALESCE(ean,''))<>''
         ORDER BY descricao,ean
        """,
    )
    clientes = pd.DataFrame(_linhas_consulta(clientes_dados))
    produtos = pd.DataFrame(_linhas_consulta(produtos_dados))
    return clientes, produtos


def _validar_bases_carregadas(clientes: pd.DataFrame, produtos_mercado: pd.DataFrame) -> None:
    faltantes = []
    if clientes is None or clientes.empty:
        faltantes.append("PAINEL EQUIPE NORTE no D1")
    if produtos_mercado is None or produtos_mercado.empty:
        faltantes.append("Produtos do Mercado Farma no D1")
    if faltantes:
        raise RuntimeError(
            "Bases obrigatórias ausentes: " + ", ".join(faltantes) + ". "
            "Importe-as em Administração > Bases oficiais."
        )


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
    debug_dir = ROOT / "data" / "mercadofarma" / "debug" / uf
    csv_path = saida_dir / f"mercadofarma_{uf}.csv"
    status_path = status_dir / f"mercadofarma_{uf}.json"
    status = {
        "uf": uf,
        "status": "erro",
        "consultor_usado": "GD",
        "cnpj_referencia": "",
        "usuario_mascarado": "",
        "total_eans": 0,
        "total_produtos": 0,
        "erro": "",
        "etapa": "inicio",
        "traceback": "",
        "iniciado_em": agora_brasilia().isoformat(),
        "finalizado_em": "",
        "fonte_clientes": "D1 / PAINEL EQUIPE NORTE",
        "fonte_produtos": "D1 / PRODUTOS MERCADO FARMA",
    }

    try:
        _log(f"Iniciando extração Mercado Farma para UF {uf}")
        if csv_path.exists():
            csv_path.unlink()

        status["etapa"] = "carregar_acesso_gd"
        login = carregar_login_bussola()
        credencial_gd = carregar_credenciais_mercadofarma(login, exigir=True)
        usuario_gd = str(credencial_gd.get("usuario", ""))
        senha_gd = str(credencial_gd.get("senha", ""))
        status["usuario_mascarado"] = mascarar_usuario(usuario_gd)
        _log(f"UF: {uf}")
        _log(f"Usuário Mercado Farma: {status['usuario_mascarado'] or 'não informado'}")

        status["etapa"] = "carregar_bases_d1"
        clientes, produtos_mercado = _carregar_bases_d1()
        _validar_bases_carregadas(clientes, produtos_mercado)
        _log(f"Clientes ativos carregados do D1: {len(clientes)}")
        _log(f"Produtos autorizados carregados do D1: {len(produtos_mercado)}")

        status["etapa"] = "montar_alvos"
        alvos = [alvo for alvo in alvos_mercadofarma_por_uf(clientes, usuario_gd, senha_gd) if alvo.get("uf") == uf]
        if not alvos:
            raise RuntimeError(f"Não encontrei CNPJ de cliente ativo no Painel Equipe Norte para a UF {uf}.")
        alvo = alvos[0]
        status["consultor_usado"] = alvo.get("consultor", "")
        status["cnpj_referencia"] = alvo.get("cnpj", "")
        candidatos = alvo.get("cnpjs_candidatos", [])
        if isinstance(candidatos, list):
            status["cnpjs_candidatos"] = candidatos
        _log(f"CNPJ referência: {status['cnpj_referencia']}")
        if isinstance(candidatos, list) and len(candidatos) > 1:
            _log(f"CNPJs candidatos na UF {uf}: {len(candidatos)}")

        status["etapa"] = "carregar_eans_d1"
        eans = obter_eans_para_consulta(produtos_mercado)
        if args.limite_eans:
            eans = eans[: args.limite_eans]
        if not eans:
            raise RuntimeError("Nenhum EAN autorizado foi encontrado no D1.")
        status["total_eans"] = len(eans)
        _log(f"Total de EANs autorizados: {len(eans)}")

        resultados: list[dict] = []
        status["etapa"] = "extracao_mercado_farma"
        _extrair_alvo(alvo, eans, headless=not args.visivel, resultados=resultados, log_fn=_log, debug_dir=debug_dir)
        status["cnpj_referencia"] = alvo.get("cnpj", status["cnpj_referencia"])
        status["etapa"] = "salvar_arquivo"
        df = _csv_saida(pd.DataFrame(resultados))
        saida_dir.mkdir(parents=True, exist_ok=True)
        df.to_csv(csv_path, index=False, encoding="utf-8-sig")
        total = int(df["EAN"].dropna().astype(str).nunique()) if "EAN" in df.columns else len(df)
        status.update({"status": "sucesso", "total_produtos": total, "arquivo": str(csv_path.relative_to(ROOT)), "etapa": "concluido"})
        _log(f"Total de produtos extraídos: {total}")
        status["finalizado_em"] = agora_brasilia().isoformat()
        _salvar_status(status_path, status)
        return 0
    except Exception as exc:
        status["erro"] = str(exc)
        status["traceback"] = traceback.format_exc(limit=8)
        status["finalizado_em"] = agora_brasilia().isoformat()
        _log(f"Erro na extração Mercado Farma UF {uf}: {exc}")
        _log(status["traceback"])
        _salvar_status(status_path, status)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
