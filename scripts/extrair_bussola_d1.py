from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
from pathlib import Path
from typing import Any, Iterable, Iterator
from uuid import uuid4

import pandas as pd
import requests

from bussola_extrator import executar as executar_extracao
from src.bussola_web import _preparar_exportacao_para_painel
from src.tratamento import normalizar_data_iso

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = ROOT / ".runtime_bussola"
OUTPUT_DIR = RUNTIME_DIR / "saida"
DOWNLOAD_DIR = RUNTIME_DIR / "downloads"
DATABASE_NAME = os.environ.get("CLOUDFLARE_D1_DATABASE", "painel-equipe-norte-db")
PAINEL_BASE_URL = os.environ.get("PAINEL_BASE_URL", "https://painel-equipe-norte.pages.dev").rstrip("/")
API_BASE = "https://api.cloudflare.com/client/v4"
D1_MAX_BOUND_PARAMS = 100
API_BATCH_STATEMENTS = 5


def env_obrigatoria(nome: str) -> str:
    valor = str(os.environ.get(nome, "") or "").strip()
    if not valor:
        raise RuntimeError(f"Variável obrigatória ausente: {nome}")
    return valor


ACCOUNT_ID = env_obrigatoria("CLOUDFLARE_ACCOUNT_ID")
API_TOKEN = env_obrigatoria("CLOUDFLARE_API_TOKEN")
ADMIN_KEY = env_obrigatoria("PAINEL_ADMIN_KEY")
CF_HEADERS = {
    "authorization": f"Bearer {API_TOKEN}",
    "content-type": "application/json",
}


def texto(valor: Any) -> str:
    if valor is None or pd.isna(valor):
        return ""
    return str(valor).strip()


def somente_digitos(valor: Any) -> str:
    return "".join(ch for ch in texto(valor) if ch.isdigit())


def numero(valor: Any) -> float:
    if valor is None or pd.isna(valor):
        return 0.0
    if isinstance(valor, (int, float)):
        return float(valor)
    entrada = texto(valor).replace("R$", "").replace("%", "").replace(" ", "")
    if not entrada:
        return 0.0
    if "," in entrada and "." in entrada:
        entrada = entrada.replace(".", "").replace(",", ".")
    elif "," in entrada:
        entrada = entrada.replace(",", ".")
    try:
        return float(entrada)
    except ValueError:
        return 0.0


def data_iso(valor: Any) -> str | None:
    return normalizar_data_iso(valor)


def id_estavel(prefixo: str, *partes: str) -> str:
    chave = "|".join(texto(parte) for parte in partes).encode("utf-8")
    return f"{prefixo}-{hashlib.sha1(chave).hexdigest()[:28]}"


def obter_credenciais() -> tuple[str, str]:
    url = f"{PAINEL_BASE_URL}/api/internal/bussola"
    ultimo_erro = ""
    for tentativa in range(1, 7):
        resposta = requests.get(
            url,
            headers={"x-admin-key": ADMIN_KEY, "accept": "application/json"},
            timeout=45,
        )
        if resposta.status_code >= 500:
            ultimo_erro = f"HTTP {resposta.status_code}: {resposta.text[:300]}"
            time.sleep(min(tentativa * 10, 30))
            continue
        try:
            dados = resposta.json()
        except ValueError as exc:
            raise RuntimeError(f"Resposta inválida da API interna: HTTP {resposta.status_code}") from exc
        if not resposta.ok:
            raise RuntimeError(dados.get("erro") or f"Falha ao buscar credenciais: HTTP {resposta.status_code}")
        usuario = texto(dados.get("usuario"))
        segredo = texto(dados.get("segredo"))
        if not usuario or not segredo:
            raise RuntimeError("A API interna retornou credenciais incompletas.")
        return usuario, segredo
    raise RuntimeError(f"A API interna não ficou disponível: {ultimo_erro}")


def requisicao_cloudflare(
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
            headers=CF_HEADERS,
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
            raise RuntimeError(f"Resposta inválida da Cloudflare: HTTP {resposta.status_code}") from exc
        if not resposta.ok or not dados.get("success", False):
            raise RuntimeError(
                f"Falha na API Cloudflare: HTTP {resposta.status_code} - "
                f"{dados.get('errors') or dados}"
            )
        return dados
    raise RuntimeError(f"Falha temporária repetida na API Cloudflare: {ultimo_erro}")


def localizar_database_id() -> str:
    dados = requisicao_cloudflare(
        "GET",
        f"{API_BASE}/accounts/{ACCOUNT_ID}/d1/database?per_page=100",
    )
    banco = next(
        (item for item in (dados.get("result") or []) if texto(item.get("name")) == DATABASE_NAME),
        None,
    )
    database_id = texto((banco or {}).get("uuid"))
    if not database_id:
        raise RuntimeError(f"Banco D1 não encontrado: {DATABASE_NAME}")
    return database_id


def normalizar_params(params: Iterable[Any] | None) -> list[Any]:
    saida: list[Any] = []
    for valor in params or []:
        if valor is None or (isinstance(valor, float) and pd.isna(valor)):
            saida.append(None)
        elif isinstance(valor, bool):
            saida.append(1 if valor else 0)
        elif isinstance(valor, (int, float)):
            saida.append(valor)
        else:
            saida.append(str(valor))
    return saida


def validar_params(params: Iterable[Any] | None, contexto: str) -> list[Any]:
    normalizados = normalizar_params(params)
    if len(normalizados) > D1_MAX_BOUND_PARAMS:
        raise RuntimeError(
            f"{contexto}: {len(normalizados)} parâmetros excedem o limite de {D1_MAX_BOUND_PARAMS}."
        )
    return normalizados


def executar(database_id: str, sql: str, params: Iterable[Any] | None = None) -> dict[str, Any]:
    dados = requisicao_cloudflare(
        "POST",
        f"{API_BASE}/accounts/{ACCOUNT_ID}/d1/database/{database_id}/query",
        payload={"sql": sql, "params": validar_params(params, "Consulta D1")},
    )
    resultados = dados.get("result") or []
    if any(not item.get("success", False) for item in resultados):
        raise RuntimeError(f"Consulta D1 não concluída: {resultados}")
    return dados


def executar_lotes(database_id: str, consultas: list[dict[str, Any]]) -> None:
    url = f"{API_BASE}/accounts/{ACCOUNT_ID}/d1/database/{database_id}/query"
    for inicio in range(0, len(consultas), API_BATCH_STATEMENTS):
        bloco = consultas[inicio : inicio + API_BATCH_STATEMENTS]
        batch = [
            {
                "sql": item["sql"],
                "params": validar_params(item.get("params", []), f"Instrução {inicio + indice + 1}"),
            }
            for indice, item in enumerate(bloco)
        ]
        dados = requisicao_cloudflare("POST", url, payload={"batch": batch})
        resultados = dados.get("result") or []
        if any(not item.get("success", False) for item in resultados):
            raise RuntimeError(f"Lote D1 não concluído: {resultados}")


def dividir_linhas(linhas: list[list[Any]], colunas: int) -> Iterator[list[list[Any]]]:
    por_consulta = max(1, D1_MAX_BOUND_PARAMS // colunas)
    for inicio in range(0, len(linhas), por_consulta):
        yield linhas[inicio : inicio + por_consulta]


def consultas_insert(
    tabela: str,
    colunas: list[str],
    linhas: list[list[Any]],
    conflito: str = "",
) -> list[dict[str, Any]]:
    if not linhas:
        return []
    placeholder = "(" + ",".join("?" for _ in colunas) + ")"
    saida: list[dict[str, Any]] = []
    for bloco in dividir_linhas(linhas, len(colunas)):
        sql = (
            f"INSERT INTO {tabela} ({','.join(colunas)}) VALUES "
            + ",".join(placeholder for _ in bloco)
        )
        if conflito:
            sql += " " + conflito
        saida.append({"sql": sql, "params": [valor for linha in bloco for valor in linha]})
    return saida


def extrair_base(usuario: str, segredo: str) -> pd.DataFrame:
    if RUNTIME_DIR.exists():
        shutil.rmtree(RUNTIME_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    executar_extracao(
        usuario=usuario,
        senha=segredo,
        saida=str(OUTPUT_DIR),
        downloads=str(DOWNLOAD_DIR),
        headless=True,
    )

    csv_path = OUTPUT_DIR / "Pedidos_bussola.csv"
    xlsx_path = OUTPUT_DIR / "Pedidos.xlsx"
    if csv_path.exists():
        bruto = pd.read_csv(csv_path, sep=";", dtype=str, encoding="utf-8-sig")
    elif xlsx_path.exists():
        bruto = pd.read_excel(xlsx_path, dtype=str)
    else:
        raise RuntimeError("A extração terminou sem gerar Pedidos_bussola.csv ou Pedidos.xlsx.")

    base = _preparar_exportacao_para_painel(bruto, "Bússola")
    if base.empty:
        raise RuntimeError("A base tratada do Bússola ficou vazia.")
    return base


def sincronizar() -> None:
    usuario, segredo = obter_credenciais()
    database_id = localizar_database_id()
    run_uuid = uuid4().hex
    extracao_id = f"bussola-{run_uuid}"
    timestamp = pd.Timestamp.now(tz="America/Sao_Paulo").isoformat()

    executar(
        database_id,
        """
        INSERT INTO extracoes
          (id,tipo,status,solicitado_por,github_run_id,iniciado_em,criado_em)
        VALUES (?,?,?,?,?,?,?)
        """,
        [
            extracao_id,
            "BUSSOLA",
            "executando",
            "github-actions",
            os.environ.get("GITHUB_RUN_ID", ""),
            timestamp,
            timestamp,
        ],
    )

    try:
        base = extrair_base(usuario, segredo)

        executar(
            database_id,
            """
            DROP TABLE IF EXISTS bussola_pedidos_staging;
            DROP TABLE IF EXISTS bussola_itens_staging;

            CREATE TABLE IF NOT EXISTS bussola_pedidos_staging (
              run_id TEXT NOT NULL,
              id TEXT NOT NULL,
              pedido_origem TEXT NOT NULL,
              nota_fiscal TEXT,
              cliente_id TEXT,
              consultor_id TEXT,
              centro_distribuicao TEXT,
              uf_centro_distribuicao TEXT,
              data_pedido TEXT,
              data_faturamento TEXT,
              status TEXT,
              valor_faturado REAL NOT NULL DEFAULT 0,
              atualizado_em TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_bussola_pedidos_staging_run
              ON bussola_pedidos_staging(run_id);
            CREATE TABLE IF NOT EXISTS bussola_itens_staging (
              run_id TEXT NOT NULL,
              id TEXT NOT NULL,
              pedido_id TEXT NOT NULL,
              produto_id TEXT,
              ean TEXT,
              descricao TEXT,
              quantidade_solicitada REAL NOT NULL DEFAULT 0,
              quantidade_atendida REAL NOT NULL DEFAULT 0,
              quantidade_faturada REAL NOT NULL DEFAULT 0,
              quantidade_cancelada REAL NOT NULL DEFAULT 0,
              preco_unitario_sem_imposto REAL NOT NULL DEFAULT 0,
              preco_unitario_com_imposto REAL NOT NULL DEFAULT 0,
              valor_total_solicitado_sem_imposto REAL NOT NULL DEFAULT 0,
              total_atendido_sem_imposto REAL NOT NULL DEFAULT 0,
              valor_faturado REAL NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_bussola_itens_staging_run
              ON bussola_itens_staging(run_id);
            """,
        )

        linhas_consultores: dict[str, list[Any]] = {}
        linhas_clientes: dict[str, list[Any]] = {}
        linhas_produtos: dict[str, list[Any]] = {}

        for _, linha in base.iterrows():
            representante = texto(linha.get("representante")) or "Gerência Distrital"
            consultor_id = id_estavel("cons", representante)
            linhas_consultores[consultor_id] = [
                consultor_id,
                representante,
                texto(linha.get("uf_centro_distribuicao")),
                1,
                timestamp,
            ]

            cnpj = somente_digitos(linha.get("cnpj_pdv"))
            if cnpj:
                cliente_id = id_estavel("cli", cnpj)
                linhas_clientes[cliente_id] = [
                    cliente_id,
                    cnpj,
                    cnpj,
                    consultor_id,
                    1,
                    timestamp,
                ]

            ean = somente_digitos(linha.get("ean"))
            if ean:
                produto_id = id_estavel("prod", ean)
                linhas_produtos[produto_id] = [
                    produto_id,
                    ean,
                    texto(linha.get("sku_produto")),
                    texto(linha.get("produto")) or f"Produto {ean}",
                    "EMS Genéricos",
                    "SEM CLASSIFICACAO",
                    1,
                    timestamp,
                ]

        executar_lotes(
            database_id,
            consultas_insert(
                "consultores",
                ["id", "nome", "uf", "ativo", "atualizado_em"],
                list(linhas_consultores.values()),
                "ON CONFLICT(id) DO UPDATE SET nome=excluded.nome,uf=excluded.uf,ativo=1,atualizado_em=excluded.atualizado_em",
            ),
        )
        executar_lotes(
            database_id,
            consultas_insert(
                "clientes",
                ["id", "cnpj", "razao_social", "consultor_id", "ativo", "atualizado_em"],
                list(linhas_clientes.values()),
                "ON CONFLICT(cnpj) DO UPDATE SET consultor_id=excluded.consultor_id,ativo=1,atualizado_em=excluded.atualizado_em",
            ),
        )
        executar_lotes(
            database_id,
            consultas_insert(
                "produtos",
                ["id", "ean", "sku", "descricao", "laboratorio", "tipo_mix", "ativo", "atualizado_em"],
                list(linhas_produtos.values()),
                "ON CONFLICT(ean) DO UPDATE SET sku=excluded.sku,descricao=excluded.descricao,laboratorio=excluded.laboratorio,ativo=1,atualizado_em=excluded.atualizado_em",
            ),
        )

        base = base.copy()
        base["_pedido"] = base["pedido_id"].map(texto)
        base["_nota"] = base["nota_fiscal"].map(texto)
        base = base[base["_pedido"] != ""].reset_index(drop=True)
        if base.empty:
            raise RuntimeError("Nenhum pedido válido permaneceu após o tratamento.")

        linhas_pedidos: list[list[Any]] = []
        linhas_itens: list[list[Any]] = []

        for (pedido_origem, nota_fiscal), grupo in base.groupby(["_pedido", "_nota"], dropna=False):
            primeira = grupo.iloc[0]
            representante = texto(primeira.get("representante")) or "Gerência Distrital"
            consultor_id = id_estavel("cons", representante)
            cnpj = somente_digitos(primeira.get("cnpj_pdv"))
            cliente_id = id_estavel("cli", cnpj) if cnpj else None
            pedido_id = id_estavel("ped", pedido_origem, nota_fiscal)
            valor_total = float(grupo["valor_faturado"].map(numero).sum())

            linhas_pedidos.append(
                [
                    run_uuid,
                    pedido_id,
                    pedido_origem,
                    nota_fiscal,
                    cliente_id,
                    consultor_id,
                    texto(primeira.get("centro_distribuicao")),
                    texto(primeira.get("uf_centro_distribuicao")),
                    data_iso(primeira.get("data_do_pedido")),
                    data_iso(primeira.get("data_de_faturamento")),
                    texto(primeira.get("status_pedido")),
                    valor_total,
                    timestamp,
                ]
            )

            for indice, (_, item) in enumerate(grupo.iterrows(), start=1):
                ean = somente_digitos(item.get("ean"))
                produto_id = id_estavel("prod", ean) if ean else None
                item_id = id_estavel("item", pedido_id, ean, str(indice))
                linhas_itens.append(
                    [
                        run_uuid,
                        item_id,
                        pedido_id,
                        produto_id,
                        ean or None,
                        texto(item.get("produto")),
                        numero(item.get("quantidade_solicitada")),
                        numero(item.get("quantidade_atendida")),
                        numero(item.get("quantidade_faturada")),
                        numero(item.get("quantidade_cancelada")),
                        numero(item.get("preco_unitario_sem_imposto")),
                        numero(item.get("preco_unitario_com_imposto")),
                        numero(item.get("valor_total_solicitado_sem_imposto")),
                        numero(item.get("total_atendido_sem_imposto")),
                        numero(item.get("valor_faturado")),
                    ]
                )

        executar_lotes(
            database_id,
            consultas_insert(
                "bussola_pedidos_staging",
                [
                    "run_id", "id", "pedido_origem", "nota_fiscal", "cliente_id",
                    "consultor_id", "centro_distribuicao", "uf_centro_distribuicao",
                    "data_pedido", "data_faturamento", "status", "valor_faturado",
                    "atualizado_em",
                ],
                linhas_pedidos,
            ),
        )
        executar_lotes(
            database_id,
            consultas_insert(
                "bussola_itens_staging",
                [
                    "run_id", "id", "pedido_id", "produto_id", "ean", "descricao",
                    "quantidade_solicitada", "quantidade_atendida", "quantidade_faturada",
                    "quantidade_cancelada", "preco_unitario_sem_imposto",
                    "preco_unitario_com_imposto", "valor_total_solicitado_sem_imposto",
                    "total_atendido_sem_imposto", "valor_faturado",
                ],
                linhas_itens,
            ),
        )

        executar_lotes(
            database_id,
            [
                {
                    "sql": "DELETE FROM itens_pedido WHERE pedido_id IN (SELECT id FROM pedidos WHERE origem='BUSSOLA')",
                    "params": [],
                },
                {"sql": "DELETE FROM pedidos WHERE origem='BUSSOLA'", "params": []},
                {
                    "sql": """
                    INSERT INTO pedidos
                      (id,pedido_origem,nota_fiscal,cliente_id,consultor_id,
                       centro_distribuicao,uf_centro_distribuicao,data_pedido,
                       data_faturamento,status,valor_faturado,origem,atualizado_em)
                    SELECT id,pedido_origem,nota_fiscal,cliente_id,consultor_id,
                           centro_distribuicao,uf_centro_distribuicao,data_pedido,
                           data_faturamento,status,valor_faturado,'BUSSOLA',atualizado_em
                      FROM bussola_pedidos_staging WHERE run_id=?
                    """,
                    "params": [run_uuid],
                },
                {
                    "sql": """
                    INSERT INTO itens_pedido
                      (id,pedido_id,produto_id,ean,descricao,quantidade_solicitada,
                       quantidade_atendida,quantidade_faturada,quantidade_cancelada,
                       preco_unitario_sem_imposto,preco_unitario_com_imposto,
                       valor_total_solicitado_sem_imposto,total_atendido_sem_imposto,
                       valor_faturado)
                    SELECT id,pedido_id,produto_id,ean,descricao,quantidade_solicitada,
                           quantidade_atendida,quantidade_faturada,quantidade_cancelada,
                           preco_unitario_sem_imposto,preco_unitario_com_imposto,
                           valor_total_solicitado_sem_imposto,total_atendido_sem_imposto,
                           valor_faturado
                      FROM bussola_itens_staging WHERE run_id=?
                    """,
                    "params": [run_uuid],
                },
            ],
        )

        executar(database_id, "DELETE FROM bussola_pedidos_staging WHERE run_id=?", [run_uuid])
        executar(database_id, "DELETE FROM bussola_itens_staging WHERE run_id=?", [run_uuid])

        resumo = json.dumps(
            {
                "linhas": int(len(base)),
                "pedidos": int(len(linhas_pedidos)),
                "itens": int(len(linhas_itens)),
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
              valor_json=excluded.valor_json,atualizado_em=excluded.atualizado_em
            """,
            ["bussola_ultima_sincronizacao", resumo, timestamp],
        )
        executar(
            database_id,
            "UPDATE integracao_credenciais SET status='conectada',mensagem_status=?,testado_em=? WHERE integracao='BUSSOLA'",
            [f"Conexão validada. {len(linhas_pedidos)} pedidos sincronizados.", timestamp],
        )
        executar(
            database_id,
            "UPDATE extracoes SET status='concluido',total_registros=?,mensagem=?,finalizado_em=? WHERE id=?",
            [len(base), f"{len(linhas_pedidos)} pedidos e {len(linhas_itens)} itens sincronizados.", timestamp, extracao_id],
        )
        print(
            f"Bússola sincronizado: {len(linhas_pedidos)} pedidos, "
            f"{len(linhas_itens)} itens e {len(base)} linhas."
        )
    except Exception as exc:
        finalizado = pd.Timestamp.now(tz="America/Sao_Paulo").isoformat()
        try:
            executar(
                database_id,
                "UPDATE extracoes SET status='erro',erro=?,finalizado_em=? WHERE id=?",
                [str(exc)[:2000], finalizado, extracao_id],
            )
            executar(
                database_id,
                "UPDATE integracao_credenciais SET status='erro',mensagem_status=?,testado_em=? WHERE integracao='BUSSOLA'",
                [str(exc)[:500], finalizado],
            )
        except Exception:
            pass
        raise


if __name__ == "__main__":
    sincronizar()
