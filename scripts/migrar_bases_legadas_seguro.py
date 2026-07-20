from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from scripts import migrar_bases_legadas_d1 as legado
from src.configuracoes import carregar_metas


def migrar_metas_seguro(database_id: str) -> int:
    dados = carregar_metas()
    consultores = dados.get("consultores", {}) if isinstance(dados, dict) else {}
    gerente = dados.get("gerente_territorial", {}) if isinstance(dados, dict) else {}

    if not isinstance(consultores, dict):
        consultores = {}
    if not isinstance(gerente, dict):
        gerente = {}

    chaves = [
        "ol_sem_combate",
        "ol_prioritarios",
        "ol_lancamentos",
        "clientes_positivados",
    ]
    if not consultores and not any(legado.meta_numero(gerente, chave) for chave in chaves):
        print("Metas legadas vazias; metas atuais do D1 preservadas.")
        return 0

    ano_mes = legado.ano_mes_padrao()
    timestamp = legado.agora()
    importacao_id = f"imp-{uuid4().hex}"
    linhas_metas: list[list[Any]] = []

    # Cria e confirma cada consultor individualmente antes de inserir qualquer meta.
    for nome_original, meta in consultores.items():
        if not isinstance(meta, dict):
            continue

        nome = legado.normalizar_nome_consultor(nome_original)
        if not nome:
            continue

        consultor_id = legado.d1.id_estavel("cons", nome)
        legado.d1.executar(
            database_id,
            """
            INSERT INTO consultores (id,nome,origem,ativo,atualizado_em)
            VALUES (?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              nome=excluded.nome,
              ativo=1,
              atualizado_em=excluded.atualizado_em
            """,
            [consultor_id, nome, "METAS", 1, timestamp],
        )

        linhas_metas.append(
            [
                legado.d1.id_estavel("meta", ano_mes, "consultor", consultor_id),
                ano_mes,
                "consultor",
                consultor_id,
                legado.meta_numero(meta, "ol_sem_combate"),
                legado.meta_numero(meta, "ol_prioritarios"),
                legado.meta_numero(meta, "ol_lancamentos"),
                legado.meta_numero(meta, "clientes_positivados"),
                importacao_id,
                timestamp,
            ]
        )

    linhas_metas.append(
        [
            legado.d1.id_estavel("meta", ano_mes, "gerente"),
            ano_mes,
            "gerente",
            None,
            legado.meta_numero(gerente, "ol_sem_combate"),
            legado.meta_numero(gerente, "ol_prioritarios"),
            legado.meta_numero(gerente, "ol_lancamentos"),
            legado.meta_numero(gerente, "clientes_positivados"),
            importacao_id,
            timestamp,
        ]
    )

    consultores_json = json.dumps(
        [
            {
                "id": linha[0],
                "consultor_id": linha[3],
                "ol_sem_combate": linha[4],
                "ol_prioritarios": linha[5],
                "ol_lancamentos": linha[6],
                "clientes_positivados": linha[7],
            }
            for linha in linhas_metas
            if linha[3] is not None
        ],
        ensure_ascii=False,
    )
    gerente = next(linha for linha in linhas_metas if linha[3] is None)

    # O lote é atômico: preserva a versão anterior, grava a nova e só então
    # remove metas que deixaram de existir no arquivo oficial.
    consultas = [
        {
            "sql": """
            INSERT INTO importacoes
              (id,tipo,nome_arquivo,total_registros,status,erro,criado_em)
            VALUES (?,?,?,?,?,?,?)
            """,
            "params": [
                importacao_id,
                "METAS_COMERCIAIS",
                f"metas legadas ({ano_mes})",
                len(linhas_metas),
                "concluido",
                "",
                timestamp,
            ],
        },
        {
            "sql": """
            INSERT INTO metas_historico (
              meta_id,ano_mes,escopo,consultor_id,ol_sem_combate,
              ol_prioritarios,ol_lancamentos,clientes_positivados,
              importacao_anterior_id,nova_importacao_id,substituida_em
            )
            SELECT id,ano_mes,escopo,consultor_id,ol_sem_combate,
                   ol_prioritarios,ol_lancamentos,clientes_positivados,
                   importacao_id,?,?
              FROM metas WHERE ano_mes=?
            """,
            "params": [importacao_id, timestamp, ano_mes],
        },
        {
            "sql": """
            INSERT INTO metas (
              id,ano_mes,escopo,consultor_id,ol_sem_combate,
              ol_prioritarios,ol_lancamentos,clientes_positivados,
              importacao_id,atualizado_em
            )
            SELECT json_extract(value,'$.id'),?,'consultor',
                   json_extract(value,'$.consultor_id'),
                   json_extract(value,'$.ol_sem_combate'),
                   json_extract(value,'$.ol_prioritarios'),
                   json_extract(value,'$.ol_lancamentos'),
                   json_extract(value,'$.clientes_positivados'),?,?
              FROM json_each(?) WHERE 1
            ON CONFLICT(id) DO UPDATE SET
              ol_sem_combate=excluded.ol_sem_combate,
              ol_prioritarios=excluded.ol_prioritarios,
              ol_lancamentos=excluded.ol_lancamentos,
              clientes_positivados=excluded.clientes_positivados,
              importacao_id=excluded.importacao_id,
              atualizado_em=excluded.atualizado_em
            """,
            "params": [ano_mes, importacao_id, timestamp, consultores_json],
        },
        {
            "sql": """
            INSERT INTO metas (
              id,ano_mes,escopo,consultor_id,ol_sem_combate,
              ol_prioritarios,ol_lancamentos,clientes_positivados,
              importacao_id,atualizado_em
            ) VALUES (?,?,?,NULL,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              ol_sem_combate=excluded.ol_sem_combate,
              ol_prioritarios=excluded.ol_prioritarios,
              ol_lancamentos=excluded.ol_lancamentos,
              clientes_positivados=excluded.clientes_positivados,
              importacao_id=excluded.importacao_id,
              atualizado_em=excluded.atualizado_em
            """,
            "params": gerente[:3] + gerente[4:],
        },
        {
            "sql": "DELETE FROM metas WHERE ano_mes=? AND COALESCE(importacao_id,'')<>?",
            "params": [ano_mes, importacao_id],
        },
    ]
    legado.d1.executar_lotes(database_id, consultas, tamanho=len(consultas))

    print(f"Metas migradas com segurança: {len(linhas_metas)} registros para {ano_mes}.")
    return len(linhas_metas)


def main() -> None:
    legado.migrar_metas = migrar_metas_seguro
    legado.main()


if __name__ == "__main__":
    main()
