from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any, Iterable, Iterator
from uuid import uuid4

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "mercadofarma" / "mercadofarma_consolidado.csv"
DATABASE_NAME = os.environ.get("CLOUDFLARE_D1_DATABASE", "painel-equipe-norte-db")
API_BASE = "https://api.cloudflare.com/client/v4"

# O D1 aceita no máximo 100 parâmetros vinculados em cada instrução SQL.
D1_MAX_BOUND_PARAMS = 100
API_BATCH_STATEMENTS = 5


def env_obrigatoria(nome: str) -> str:
    valor = str(os.environ.get(nome, "") or "").strip()
    if not valor:
        raise RuntimeError(f"Variável obrigatória ausente: {nome}")
    return valor


ACCOUNT_ID = env_obrigatoria("CLOUDFLARE_ACCOUNT_ID")
API_TOKEN = env_obrigatoria("CLOUDFLARE_API_TOKEN")
HEADERS = {
    "authorization": f"Bearer {API_TOKEN}",
    "content-type": "application/json",
}


def requisicao(
    method: str,
    url: str,
    *,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ultimo_erro = ""
    for tentativa in range(1, 6):
        resposta = requests.request(
            method,
            url,
            headers=HEADERS,
            json=payload,
            timeout=90,
        )
        if resposta.status_code == 429 or resposta.status_code >= 500:
            ultimo_erro = f"HTTP {resposta.status_code}: {resposta.text[:500]}"
            time.sleep(min(2**tentativa, 20))
            continue

        try:
            dados = resposta.json()
        except ValueError as exc:
            raise RuntimeError(
                f"Resposta inválida da Cloudflare: HTTP {resposta.status_code}"
            ) from exc

        if not resposta.ok or not dados.get("success", False):
            erros = dados.get("errors") or []
            raise RuntimeError(
                f"Falha na API Cloudflare: HTTP {resposta.status_code} - "
                f"{erros or dados}"
            )
        return dados

    raise RuntimeError(
        f"Falha temporária repetida na API Cloudflare: {ultimo_erro}"
    )


def localizar_database_id() -> str:
    url = f"{API_BASE}/accounts/{ACCOUNT_ID}/d1/database?per_page=100"
    dados = requisicao("GET", url)
    bancos = dados.get("result") or []
    banco = next(
        (item for item in bancos if str(item.get("name", "")) == DATABASE_NAME),
        None,
    )
    database_id = str((banco or {}).get("uuid", "") or "").strip()
    if not database_id:
        raise RuntimeError(f"Banco D1 não encontrado: {DATABASE_NAME}")
    return database_id


def normalizar_params(params: Iterable[Any] | None) -> list[str]:
    return ["" if valor is None else str(valor) for valor in (params or [])]


def validar_limite_params(params: Iterable[Any] | None, contexto: str) -> list[str]:
    normalizados = normalizar_params(params)
    if len(normalizados) > D1_MAX_BOUND_PARAMS:
        raise RuntimeError(
            f"{contexto}: {len(normalizados)} parâmetros excedem o limite "
            f"de {D1_MAX_BOUND_PARAMS} do Cloudflare D1."
        )
    return normalizados


def executar(
    database_id: str,
    sql: str,
    params: Iterable[Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "sql": sql,
        "params": validar_limite_params(params, "Consulta D1"),
    }
    url = f"{API_BASE}/accounts/{ACCOUNT_ID}/d1/database/{database_id}/query"
    dados = requisicao("POST", url, payload=payload)
    resultados = dados.get("result") or []
    if any(not item.get("success", False) for item in resultados):
        raise RuntimeError(f"Consulta D1 não concluída: {resultados}")
    return dados


def executar_lotes(
    database_id: str,
    consultas: list[dict[str, Any]],
    tamanho: int = API_BATCH_STATEMENTS,
) -> None:
    url = f"{API_BASE}/accounts/{ACCOUNT_ID}/d1/database/{database_id}/query"
    for inicio in range(0, len(consultas), tamanho):
        bloco = consultas[inicio : inicio + tamanho]
        batch = []
        for indice, item in enumerate(bloco, start=inicio + 1):
            batch.append(
                {
                    "sql": item["sql"],
                    "params": validar_limite_params(
                        item.get("params", []),
                        f"Instrução {indice} do lote D1",
                    ),
                }
            )

        dados = requisicao("POST", url, payload={"batch": batch})
        resultados = dados.get("result") or []
        if any(not item.get("success", False) for item in resultados):
            raise RuntimeError(f"Lote D1 não concluído: {resultados}")


def texto(valor: Any) -> str:
    if valor is None or pd.isna(valor):
        return ""
    return str(valor).strip()


def numero(valor: Any) -> float:
    texto_valor = texto(valor).replace("%", "").replace(" ", "")
    if not texto_valor:
        return 0.0
    if "," in texto_valor and "." in texto_valor:
        texto_valor = texto_valor.replace(".", "").replace(",", ".")
    elif "," in texto_valor:
        texto_valor = texto_valor.replace(",", ".")
    try:
        return float(texto_valor)
    except ValueError:
        return 0.0


def id_estavel(prefixo: str, *partes: str) -> str:
    chave = "|".join(partes).encode("utf-8")
    return f"{prefixo}-{hashlib.sha1(chave).hexdigest()[:28]}"


def carregar_base() -> pd.DataFrame:
    if not CSV_PATH.exists():
        raise RuntimeError(f"Arquivo não encontrado: {CSV_PATH.relative_to(ROOT)}")

    base = pd.read_csv(
        CSV_PATH,
        encoding="utf-8-sig",
        dtype=str,
        keep_default_na=False,
    )
    base.columns = [str(coluna).strip().upper() for coluna in base.columns]

    obrigatorias = {"UF", "EAN", "DISTRIBUIDORA"}
    faltantes = sorted(obrigatorias - set(base.columns))
    if faltantes:
        raise RuntimeError(
            "Colunas obrigatórias ausentes: " + ", ".join(faltantes)
        )

    for coluna in [
        "CONSULTOR_USADO",
        "CNPJ_REFERENCIA",
        "PRODUTO",
        "ESTOQUE",
        "DESCONTO",
        "PF_DIST",
        "PF_FABRICA",
        "PRECO_COM_IMPOSTO",
        "PRECO_SEM_IMPOSTO",
        "DATA_ATUALIZACAO",
        "STATUS",
        "ERRO",
    ]:
        if coluna not in base.columns:
            base[coluna] = ""

    base["UF"] = base["UF"].map(texto).str.upper()
    base["EAN"] = base["EAN"].map(texto).str.replace(r"\D", "", regex=True)
    base["DISTRIBUIDORA"] = base["DISTRIBUIDORA"].map(texto)
    base = base[
        (base["UF"] != "")
        & (base["EAN"] != "")
        & (base["DISTRIBUIDORA"] != "")
    ].copy()
    base = base.drop_duplicates(
        subset=["UF", "EAN", "DISTRIBUIDORA"],
        keep="last",
    ).reset_index(drop=True)

    if base.empty:
        raise RuntimeError(
            "O consolidado do Mercado Farma não contém registros válidos."
        )
    return base


def dividir_linhas(
    linhas: list[list[Any]],
    quantidade_colunas: int,
) -> Iterator[list[list[Any]]]:
    if quantidade_colunas <= 0:
        raise ValueError("A quantidade de colunas deve ser maior que zero.")

    linhas_por_consulta = max(
        1,
        D1_MAX_BOUND_PARAMS // quantidade_colunas,
    )
    for inicio in range(0, len(linhas), linhas_por_consulta):
        yield linhas[inicio : inicio + linhas_por_consulta]


def consultas_multiplos_valores(
    tabela: str,
    colunas: list[str],
    linhas: list[list[Any]],
    conflito: str,
) -> list[dict[str, Any]]:
    if not linhas:
        return []

    placeholders = "(" + ",".join("?" for _ in colunas) + ")"
    consultas: list[dict[str, Any]] = []

    for bloco in dividir_linhas(linhas, len(colunas)):
        sql = (
            f"INSERT INTO {tabela} ({','.join(colunas)}) VALUES "
            + ",".join(placeholders for _ in bloco)
        )
        if conflito:
            sql += " " + conflito

        params = [valor for linha in bloco for valor in linha]
        consultas.append({"sql": sql, "params": params})

    return consultas


def sincronizar() -> None:
    base = carregar_base()
    database_id = localizar_database_id()
    run_uuid = uuid4().hex
    extracao_id = f"mf-{run_uuid}"
    timestamp = pd.Timestamp.now(tz="America/Sao_Paulo").isoformat()
    ufs = sorted(base["UF"].unique().tolist())

    executar(
        database_id,
        (
            "INSERT INTO extracoes "
            "(id,tipo,status,solicitado_por,github_run_id,iniciado_em,criado_em) "
            "VALUES (?,?,?,?,?,?,?)"
        ),
        [
            extracao_id,
            "MERCADO_FARMA",
            "executando",
            "github-actions",
            os.environ.get("GITHUB_RUN_ID", ""),
            timestamp,
            timestamp,
        ],
    )

    try:
        executar(
            database_id,
            """
            CREATE TABLE IF NOT EXISTS mercado_farma_precos_staging (
              run_id TEXT NOT NULL,
              id TEXT NOT NULL,
              uf TEXT NOT NULL,
              cnpj_referencia TEXT,
              produto_id TEXT,
              ean TEXT NOT NULL,
              produto TEXT,
              distribuidora TEXT NOT NULL,
              estoque REAL NOT NULL DEFAULT 0,
              desconto REAL NOT NULL DEFAULT 0,
              pf_distribuidora REAL NOT NULL DEFAULT 0,
              pf_fabrica REAL NOT NULL DEFAULT 0,
              preco_com_imposto REAL NOT NULL DEFAULT 0,
              preco_sem_imposto REAL NOT NULL DEFAULT 0,
              status TEXT,
              erro TEXT,
              atualizado_em TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_mf_staging_run
              ON mercado_farma_precos_staging(run_id);
            """,
        )
        executar(
            database_id,
            (
                "DELETE FROM mercado_farma_precos_staging "
                "WHERE atualizado_em < datetime('now','-2 days')"
            ),
        )

        colunas_produtos = [
            "id",
            "ean",
            "descricao",
            "laboratorio",
            "tipo_mix",
            "ativo",
            "atualizado_em",
        ]
        linhas_produtos: list[list[Any]] = []
        produtos = base[["EAN", "PRODUTO"]].drop_duplicates(
            subset=["EAN"],
            keep="last",
        )
        for item in produtos.itertuples(index=False):
            ean = texto(item.EAN)
            linhas_produtos.append(
                [
                    id_estavel("prod", ean),
                    ean,
                    texto(item.PRODUTO),
                    "EMS Genéricos",
                    "SEM CLASSIFICACAO",
                    1,
                    timestamp,
                ]
            )

        consultas_produtos = consultas_multiplos_valores(
            "produtos",
            colunas_produtos,
            linhas_produtos,
            (
                "ON CONFLICT(ean) DO UPDATE SET "
                "descricao=excluded.descricao,"
                "laboratorio=excluded.laboratorio,"
                "ativo=1,"
                "atualizado_em=excluded.atualizado_em"
            ),
        )
        executar_lotes(database_id, consultas_produtos)

        colunas_staging = [
            "run_id",
            "id",
            "uf",
            "cnpj_referencia",
            "produto_id",
            "ean",
            "produto",
            "distribuidora",
            "estoque",
            "desconto",
            "pf_distribuidora",
            "pf_fabrica",
            "preco_com_imposto",
            "preco_sem_imposto",
            "status",
            "erro",
            "atualizado_em",
        ]
        linhas_staging: list[list[Any]] = []
        for item in base.itertuples(index=False):
            uf = texto(item.UF)
            ean = texto(item.EAN)
            distribuidora = texto(item.DISTRIBUIDORA)
            atualizado = texto(item.DATA_ATUALIZACAO) or timestamp
            linhas_staging.append(
                [
                    run_uuid,
                    id_estavel("mf", uf, ean, distribuidora),
                    uf,
                    texto(item.CNPJ_REFERENCIA),
                    id_estavel("prod", ean),
                    ean,
                    texto(item.PRODUTO),
                    distribuidora,
                    numero(item.ESTOQUE),
                    numero(item.DESCONTO),
                    numero(item.PF_DIST),
                    numero(item.PF_FABRICA),
                    numero(item.PRECO_COM_IMPOSTO),
                    numero(item.PRECO_SEM_IMPOSTO),
                    texto(item.STATUS),
                    texto(item.ERRO),
                    atualizado,
                ]
            )

        consultas_staging = consultas_multiplos_valores(
            "mercado_farma_precos_staging",
            colunas_staging,
            linhas_staging,
            "",
        )
        executar_lotes(database_id, consultas_staging)

        executar(
            database_id,
            """
            INSERT INTO mercado_farma_precos (
              id,uf,cnpj_referencia,produto_id,ean,produto,distribuidora,
              estoque,desconto,pf_distribuidora,pf_fabrica,
              preco_com_imposto,preco_sem_imposto,status,erro,atualizado_em
            )
            SELECT
              id,uf,cnpj_referencia,produto_id,ean,produto,distribuidora,
              estoque,desconto,pf_distribuidora,pf_fabrica,
              preco_com_imposto,preco_sem_imposto,status,erro,atualizado_em
            FROM mercado_farma_precos_staging
            WHERE run_id = ?
            ON CONFLICT(uf,ean,distribuidora) DO UPDATE SET
              id=excluded.id,
              cnpj_referencia=excluded.cnpj_referencia,
              produto_id=excluded.produto_id,
              produto=excluded.produto,
              estoque=excluded.estoque,
              desconto=excluded.desconto,
              pf_distribuidora=excluded.pf_distribuidora,
              pf_fabrica=excluded.pf_fabrica,
              preco_com_imposto=excluded.preco_com_imposto,
              preco_sem_imposto=excluded.preco_sem_imposto,
              status=excluded.status,
              erro=excluded.erro,
              atualizado_em=excluded.atualizado_em
            """,
            [run_uuid],
        )

        marcadores_uf = ",".join("?" for _ in ufs)
        executar(
            database_id,
            f"""
            DELETE FROM mercado_farma_precos
            WHERE uf IN ({marcadores_uf})
              AND NOT EXISTS (
                SELECT 1
                FROM mercado_farma_precos_staging s
                WHERE s.run_id = ?
                  AND s.uf = mercado_farma_precos.uf
                  AND s.ean = mercado_farma_precos.ean
                  AND s.distribuidora = mercado_farma_precos.distribuidora
              )
            """,
            [*ufs, run_uuid],
        )
        executar(
            database_id,
            "DELETE FROM mercado_farma_precos_staging WHERE run_id = ?",
            [run_uuid],
        )

        resumo = json.dumps(
            {
                "registros": int(len(base)),
                "ufs": ufs,
                "sincronizado_em": timestamp,
            },
            ensure_ascii=False,
        )
        executar(
            database_id,
            """
            INSERT INTO configuracoes (chave,valor_json,atualizado_em)
            VALUES (?,?,?)
            ON CONFLICT(chave) DO UPDATE SET
              valor_json=excluded.valor_json,
              atualizado_em=excluded.atualizado_em
            """,
            ["mercado_farma_ultima_sincronizacao", resumo, timestamp],
        )
        executar(
            database_id,
            (
                "UPDATE extracoes "
                "SET status='concluido',total_registros=?,mensagem=?,"
                "finalizado_em=? WHERE id=?"
            ),
            [
                len(base),
                f"Mercado Farma sincronizado para {', '.join(ufs)}",
                timestamp,
                extracao_id,
            ],
        )
        print(
            "Mercado Farma sincronizado com sucesso: "
            f"{len(base)} registros, UFs {', '.join(ufs)}."
        )
    except Exception as exc:
        try:
            executar(
                database_id,
                (
                    "UPDATE extracoes "
                    "SET status='erro',erro=?,finalizado_em=? WHERE id=?"
                ),
                [
                    str(exc)[:2000],
                    pd.Timestamp.now(
                        tz="America/Sao_Paulo"
                    ).isoformat(),
                    extracao_id,
                ],
            )
        except Exception:
            pass
        raise


if __name__ == "__main__":
    sincronizar()
