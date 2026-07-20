from __future__ import annotations

import json
import os
from io import BytesIO
from typing import Any
from uuid import uuid4

import pandas as pd

from scripts import importar_mercadofarma_d1 as d1
from src.configuracoes import aplicar_ajustes_vendedores, carregar_metas
from src.persistencia import carregar_bytes
from src.tratamento import (
    normalizar_ean,
    normalizar_texto,
    normalizar_texto_alto,
    padronizar_colunas,
    preparar_painel_equipe,
    preparar_produtos_mix,
)


def agora() -> str:
    return pd.Timestamp.now(tz="America/Sao_Paulo").isoformat()


def ano_mes_padrao() -> str:
    informado = str(os.environ.get("MIGRACAO_ANO_MES", "") or "").strip()
    if len(informado) == 7 and informado[4] == "-":
        return informado
    return pd.Timestamp.now(tz="America/Sao_Paulo").strftime("%Y-%m")


def ler_excel_persistido(chave: str, aba: str | int = 0) -> pd.DataFrame:
    conteudo = carregar_bytes(chave)
    if not conteudo:
        return pd.DataFrame()
    try:
        return pd.read_excel(BytesIO(conteudo), sheet_name=aba, dtype=object, engine="openpyxl")
    except (ValueError, KeyError):
        return pd.read_excel(BytesIO(conteudo), sheet_name=0, dtype=object, engine="openpyxl")


def registrar_importacao(
    database_id: str,
    tipo: str,
    arquivo: str,
    total: int,
    status: str = "concluido",
    erro: str = "",
) -> None:
    d1.executar(
        database_id,
        """
        INSERT INTO importacoes
          (id,tipo,nome_arquivo,total_registros,status,erro,criado_em)
        VALUES (?,?,?,?,?,?,?)
        """,
        [f"imp-{uuid4().hex}", tipo, arquivo, total, status, erro[:2000], agora()],
    )


def consultas_insert(
    tabela: str,
    colunas: list[str],
    linhas: list[list[Any]],
    conflito: str = "",
) -> list[dict[str, Any]]:
    return d1.consultas_multiplos_valores(tabela, colunas, linhas, conflito)


def normalizar_nome_consultor(valor: Any) -> str:
    return normalizar_texto_alto(valor)


def migrar_painel(database_id: str) -> dict[str, int]:
    bruto = ler_excel_persistido("painel", "Planilha1")
    painel = aplicar_ajustes_vendedores(preparar_painel_equipe(bruto))
    if painel.empty:
        print("PAINEL EQUIPE NORTE legado não possui registros; base D1 preservada.")
        return {"clientes": 0, "consultores": 0}

    painel = painel[painel["cnpj"].astype(str).str.len().eq(14)].copy()
    painel = painel[painel["cnpj"].astype(str).ne("0" * 14)].copy()
    if painel.empty:
        print("PAINEL EQUIPE NORTE não possui CNPJs válidos; base D1 preservada.")
        return {"clientes": 0, "consultores": 0}

    timestamp = agora()
    token = uuid4().hex
    consultores: dict[str, list[Any]] = {}
    clientes: list[list[Any]] = []

    for item in painel.to_dict(orient="records"):
        cnpj = str(item.get("cnpj") or "").strip()
        nome_rep = normalizar_nome_consultor(item.get("nome_rep"))
        consultor_id = d1.id_estavel("cons", nome_rep) if nome_rep else None
        if consultor_id:
            consultores[consultor_id] = [
                consultor_id,
                nome_rep,
                "PAINEL_EQUIPE",
                1,
                timestamp,
            ]

        clientes.append(
            [
                d1.id_estavel("cli", cnpj),
                cnpj,
                normalizar_texto(item.get("nome_pdv")),
                normalizar_texto(item.get("nome_pdv")),
                normalizar_texto(item.get("cidade")),
                normalizar_texto_alto(item.get("uf"))[:2],
                normalizar_texto(item.get("grupo_sip")),
                consultor_id,
                1 if bool(item.get("cliente_ativo")) else 0,
                normalizar_texto(item.get("nome_gd")),
                normalizar_texto(item.get("situacao")),
                normalizar_texto(item.get("grupo_economico")),
                normalizar_texto(item.get("rede_associacao")),
                normalizar_texto(item.get("bandeira")),
                normalizar_texto(item.get("setor_rep")),
                normalizar_texto(item.get("foco_pex")),
                normalizar_texto(item.get("positivacao")),
                1,
                token,
                timestamp,
            ]
        )

    d1.executar_lotes(
        database_id,
        consultas_insert(
            "consultores",
            ["id", "nome", "origem", "ativo", "atualizado_em"],
            list(consultores.values()),
            """
            ON CONFLICT(id) DO UPDATE SET
              nome=excluded.nome,
              origem='PAINEL_EQUIPE',
              ativo=1,
              atualizado_em=excluded.atualizado_em
            """,
        ),
    )

    d1.executar_lotes(
        database_id,
        consultas_insert(
            "clientes",
            [
                "id",
                "cnpj",
                "razao_social",
                "nome_fantasia",
                "cidade",
                "uf",
                "grupo_sip",
                "consultor_id",
                "ativo",
                "nome_gd",
                "situacao",
                "grupo_economico",
                "rede_associacao",
                "bandeira",
                "setor_rep",
                "foco_pex",
                "positivacao",
                "carteira_importada",
                "carteira_importacao_id",
                "atualizado_em",
            ],
            clientes,
            """
            ON CONFLICT(cnpj) DO UPDATE SET
              razao_social=excluded.razao_social,
              nome_fantasia=excluded.nome_fantasia,
              cidade=excluded.cidade,
              uf=excluded.uf,
              grupo_sip=excluded.grupo_sip,
              consultor_id=excluded.consultor_id,
              ativo=excluded.ativo,
              nome_gd=excluded.nome_gd,
              situacao=excluded.situacao,
              grupo_economico=excluded.grupo_economico,
              rede_associacao=excluded.rede_associacao,
              bandeira=excluded.bandeira,
              setor_rep=excluded.setor_rep,
              foco_pex=excluded.foco_pex,
              positivacao=excluded.positivacao,
              carteira_importada=1,
              carteira_importacao_id=excluded.carteira_importacao_id,
              atualizado_em=excluded.atualizado_em
            """,
        ),
    )

    d1.executar_lotes(
        database_id,
        [
            {
                "sql": """
                UPDATE clientes
                   SET carteira_importada=0,
                       consultor_id=NULL
                 WHERE carteira_importada=1
                   AND COALESCE(carteira_importacao_id,'')<>?
                """,
                "params": [token],
            },
            {
                "sql": """
                UPDATE consultores
                   SET ativo=CASE WHEN EXISTS (
                         SELECT 1
                           FROM clientes c
                          WHERE c.consultor_id=consultores.id
                            AND c.carteira_importada=1
                       ) THEN 1 ELSE 0 END
                 WHERE origem='PAINEL_EQUIPE'
                """,
                "params": [],
            },
            {
                "sql": """
                UPDATE pedidos
                   SET consultor_id=(
                         SELECT c.consultor_id
                           FROM clientes c
                          WHERE c.id=pedidos.cliente_id
                            AND c.carteira_importada=1
                       )
                 WHERE origem='BUSSOLA'
                """,
                "params": [],
            },
        ],
    )

    registrar_importacao(
        database_id,
        "PAINEL_EQUIPE_NORTE",
        "painel_clientes.xlsx (legado)",
        len(clientes),
    )
    return {"clientes": len(clientes), "consultores": len(consultores)}


def migrar_produtos_mix(database_id: str) -> int:
    bruto = ler_excel_persistido("produtos_mix", 0)
    produtos = preparar_produtos_mix(bruto)
    produtos = produtos[produtos["ean"].astype(str).ne("")].copy() if not produtos.empty else produtos
    if produtos.empty:
        print("Produtos/Mix legado vazio; classificação atual do D1 preservada.")
        return 0

    timestamp = agora()
    token = uuid4().hex
    linhas: list[list[Any]] = []
    for item in produtos.to_dict(orient="records"):
        ean = normalizar_ean(item.get("ean"))
        if not ean:
            continue
        linhas.append(
            [
                d1.id_estavel("prod", ean),
                ean,
                normalizar_texto(item.get("produto")) or f"Produto {ean}",
                normalizar_texto_alto(item.get("tipo_mix")) or "SEM CLASSIFICACAO",
                1,
                token,
                timestamp,
            ]
        )
    if not linhas:
        print("Produtos/Mix sem EAN válido; classificação atual do D1 preservada.")
        return 0

    d1.executar_lotes(
        database_id,
        consultas_insert(
            "produtos",
            ["id", "ean", "descricao", "tipo_mix", "ativo", "mix_importacao_id", "atualizado_em"],
            linhas,
            """
            ON CONFLICT(ean) DO UPDATE SET
              descricao=excluded.descricao,
              tipo_mix=excluded.tipo_mix,
              ativo=1,
              mix_importacao_id=excluded.mix_importacao_id,
              atualizado_em=excluded.atualizado_em
            """,
        ),
    )
    d1.executar(
        database_id,
        """
        UPDATE produtos
           SET tipo_mix='SEM CLASSIFICACAO'
         WHERE COALESCE(mix_importacao_id,'')<>?
        """,
        [token],
    )
    registrar_importacao(database_id, "PRODUTOS_MIX", "template_produtos_mix.xlsx (legado)", len(linhas))
    return len(linhas)


def preparar_lista_mercado(df: pd.DataFrame) -> pd.DataFrame:
    base = padronizar_colunas(df) if df is not None else pd.DataFrame()
    if base.empty:
        return pd.DataFrame(columns=["ean", "produto"])
    aliases_produto = ["produto", "descricao", "principio_ativo", "nome_do_produto"]
    if "ean" not in base.columns:
        return pd.DataFrame(columns=["ean", "produto"])
    if "produto" not in base.columns:
        origem = next((coluna for coluna in aliases_produto if coluna in base.columns), None)
        base["produto"] = base[origem] if origem else ""
    base["ean"] = base["ean"].apply(normalizar_ean)
    base["produto"] = base["produto"].apply(normalizar_texto)
    base = base[base["ean"].ne("")][["ean", "produto"]]
    return base.drop_duplicates("ean", keep="last").reset_index(drop=True)


def migrar_produtos_mercado(database_id: str) -> int:
    bruto = ler_excel_persistido("produtos_mercado_farma", 0)
    produtos = preparar_lista_mercado(bruto)
    if produtos.empty:
        print("Lista de produtos do Mercado Farma legada vazia; lista atual do D1 preservada.")
        return 0

    timestamp = agora()
    token = uuid4().hex
    linhas = [
        [
            d1.id_estavel("prod", item["ean"]),
            item["ean"],
            item["produto"] or f"Produto {item['ean']}",
            1,
            1,
            token,
            timestamp,
        ]
        for item in produtos.to_dict(orient="records")
    ]
    d1.executar_lotes(
        database_id,
        consultas_insert(
            "produtos",
            [
                "id",
                "ean",
                "descricao",
                "ativo",
                "mercado_farma_ativo",
                "mercado_farma_importacao_id",
                "atualizado_em",
            ],
            linhas,
            """
            ON CONFLICT(ean) DO UPDATE SET
              descricao=CASE
                WHEN TRIM(COALESCE(excluded.descricao,''))<>'' THEN excluded.descricao
                ELSE produtos.descricao END,
              ativo=1,
              mercado_farma_ativo=1,
              mercado_farma_importacao_id=excluded.mercado_farma_importacao_id,
              atualizado_em=excluded.atualizado_em
            """,
        ),
    )
    d1.executar(
        database_id,
        """
        UPDATE produtos
           SET mercado_farma_ativo=0
         WHERE mercado_farma_ativo=1
           AND COALESCE(mercado_farma_importacao_id,'')<>?
        """,
        [token],
    )
    registrar_importacao(database_id, "PRODUTOS_MERCADO_FARMA", "produtos.xlsx (legado)", len(linhas))
    return len(linhas)


def meta_numero(item: dict[str, Any], chave: str) -> float:
    try:
        return float(item.get(chave, 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def migrar_metas(database_id: str) -> int:
    dados = carregar_metas()
    consultores = dados.get("consultores", {}) if isinstance(dados, dict) else {}
    gerente = dados.get("gerente_territorial", {}) if isinstance(dados, dict) else {}
    if not isinstance(consultores, dict):
        consultores = {}
    if not isinstance(gerente, dict):
        gerente = {}
    if not consultores and not any(meta_numero(gerente, chave) for chave in [
        "ol_sem_combate", "ol_prioritarios", "ol_lancamentos", "clientes_positivados"
    ]):
        print("Metas legadas vazias; metas atuais do D1 preservadas.")
        return 0

    ano_mes = ano_mes_padrao()
    timestamp = agora()
    token = uuid4().hex
    linhas_consultores: list[list[Any]] = []
    linhas_metas: list[list[Any]] = []

    for nome_original, meta in consultores.items():
        if not isinstance(meta, dict):
            continue
        nome = normalizar_nome_consultor(nome_original)
        if not nome:
            continue
        consultor_id = d1.id_estavel("cons", nome)
        linhas_consultores.append([consultor_id, nome, "METAS", 1, timestamp])
        linhas_metas.append(
            [
                d1.id_estavel("meta", ano_mes, "consultor", consultor_id),
                ano_mes,
                "consultor",
                consultor_id,
                meta_numero(meta, "ol_sem_combate"),
                meta_numero(meta, "ol_prioritarios"),
                meta_numero(meta, "ol_lancamentos"),
                meta_numero(meta, "clientes_positivados"),
                token,
                timestamp,
            ]
        )

    if linhas_consultores:
        d1.executar_lotes(
            database_id,
            consultas_insert(
                "consultores",
                ["id", "nome", "origem", "ativo", "atualizado_em"],
                linhas_consultores,
                """
                ON CONFLICT(id) DO UPDATE SET
                  nome=excluded.nome,
                  ativo=1,
                  atualizado_em=excluded.atualizado_em
                """,
            ),
        )

    linhas_metas.append(
        [
            d1.id_estavel("meta", ano_mes, "gerente"),
            ano_mes,
            "gerente",
            None,
            meta_numero(gerente, "ol_sem_combate"),
            meta_numero(gerente, "ol_prioritarios"),
            meta_numero(gerente, "ol_lancamentos"),
            meta_numero(gerente, "clientes_positivados"),
            token,
            timestamp,
        ]
    )

    d1.executar(database_id, "DELETE FROM metas WHERE ano_mes=?", [ano_mes])
    d1.executar_lotes(
        database_id,
        consultas_insert(
            "metas",
            [
                "id",
                "ano_mes",
                "escopo",
                "consultor_id",
                "ol_sem_combate",
                "ol_prioritarios",
                "ol_lancamentos",
                "clientes_positivados",
                "importacao_id",
                "atualizado_em",
            ],
            linhas_metas,
        ),
    )
    registrar_importacao(database_id, "METAS_COMERCIAIS", f"metas legadas ({ano_mes})", len(linhas_metas))
    return len(linhas_metas)


def main() -> None:
    database_id = d1.localizar_database_id()
    resumo: dict[str, Any] = {}
    resumo.update(migrar_painel(database_id))
    resumo["produtos_mix"] = migrar_produtos_mix(database_id)
    resumo["produtos_mercado_farma"] = migrar_produtos_mercado(database_id)
    resumo["metas"] = migrar_metas(database_id)
    resumo["ano_mes_metas"] = ano_mes_padrao()
    resumo["migrado_em"] = agora()

    d1.executar(
        database_id,
        """
        INSERT INTO configuracoes (chave,valor_json,atualizado_em)
        VALUES (?,?,?)
        ON CONFLICT(chave) DO UPDATE SET
          valor_json=excluded.valor_json,
          atualizado_em=excluded.atualizado_em
        """,
        ["migracao_bases_legadas", json.dumps(resumo, ensure_ascii=False), resumo["migrado_em"]],
    )
    print("Migração concluída:")
    print(json.dumps(resumo, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
