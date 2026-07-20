from __future__ import annotations

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

    # O registro-pai precisa existir antes das metas caso o banco possua FK de importação.
    legado.d1.executar(
        database_id,
        """
        INSERT INTO importacoes
          (id,tipo,nome_arquivo,total_registros,status,erro,criado_em)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          total_registros=excluded.total_registros,
          status=excluded.status,
          erro=excluded.erro
        """,
        [
            importacao_id,
            "METAS_COMERCIAIS",
            f"metas legadas ({ano_mes})",
            0,
            "executando",
            "",
            timestamp,
        ],
    )

    legado.d1.executar(database_id, "DELETE FROM metas WHERE ano_mes=?", [ano_mes])

    # Inserção individual facilita identificar qualquer registro problemático e respeita as FKs.
    for linha in linhas_metas:
        legado.d1.executar(
            database_id,
            """
            INSERT INTO metas (
              id,ano_mes,escopo,consultor_id,ol_sem_combate,
              ol_prioritarios,ol_lancamentos,clientes_positivados,
              importacao_id,atualizado_em
            ) VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            linha,
        )

    legado.d1.executar(
        database_id,
        """
        UPDATE importacoes
           SET total_registros=?, status='concluido', erro=''
         WHERE id=?
        """,
        [len(linhas_metas), importacao_id],
    )

    print(f"Metas migradas com segurança: {len(linhas_metas)} registros para {ano_mes}.")
    return len(linhas_metas)


def main() -> None:
    legado.migrar_metas = migrar_metas_seguro
    legado.main()


if __name__ == "__main__":
    main()
