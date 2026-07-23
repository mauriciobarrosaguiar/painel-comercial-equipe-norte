from __future__ import annotations

import json
import os
from typing import Any
from uuid import uuid4

import pandas as pd

from scripts import extrair_bussola_d1 as legacy
from src.tratamento import deduplicar_exportacao_bussola


texto = legacy.texto
somente_digitos = legacy.somente_digitos
numero = legacy.numero
data_iso = legacy.data_iso
id_estavel = legacy.id_estavel


def sincronizar() -> None:
    usuario, segredo = legacy.obter_credenciais()
    database_id = legacy.localizar_database_id()
    run_uuid = uuid4().hex
    extracao_id = f"bussola-{run_uuid}"
    timestamp = pd.Timestamp.now(tz="America/Sao_Paulo").isoformat()

    legacy.executar(
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
        base_extraida = legacy.extrair_base(usuario, segredo)
        total_extraido = len(base_extraida)
        base = deduplicar_exportacao_bussola(base_extraida)
        duplicatas_ignoradas = total_extraido - len(base)

        legacy.executar(
            database_id,
            """
            DROP TABLE IF EXISTS bussola_pedidos_staging_v2;
            DROP TABLE IF EXISTS bussola_itens_staging_v2;

            CREATE TABLE IF NOT EXISTS bussola_pedidos_staging_v2 (
              run_id TEXT NOT NULL,
              id TEXT NOT NULL,
              pedido_origem TEXT NOT NULL,
              nota_fiscal TEXT,
              cliente_id TEXT,
              centro_distribuicao TEXT,
              uf_centro_distribuicao TEXT,
              data_pedido TEXT,
              data_faturamento TEXT,
              status TEXT,
              valor_faturado REAL NOT NULL DEFAULT 0,
              atualizado_em TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_bussola_pedidos_staging_v2_run
              ON bussola_pedidos_staging_v2(run_id);

            CREATE TABLE IF NOT EXISTS bussola_itens_staging_v2 (
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
            CREATE INDEX IF NOT EXISTS idx_bussola_itens_staging_v2_run
              ON bussola_itens_staging_v2(run_id);
            """,
        )

        # O Bússola fornece pedidos, itens, CNPJ e EAN.
        # Ele NÃO define a carteira, o consultor, o GD ou a UF do cliente.
        linhas_clientes: dict[str, list[Any]] = {}
        linhas_produtos: dict[str, list[Any]] = {}

        for _, linha in base.iterrows():
            cnpj = somente_digitos(linha.get("cnpj_pdv"))
            if cnpj:
                cliente_id = id_estavel("cli", cnpj)
                linhas_clientes[cliente_id] = [
                    cliente_id,
                    cnpj,
                    cnpj,
                    1,
                    0,
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

        legacy.executar_lotes(
            database_id,
            legacy.consultas_insert(
                "clientes",
                ["id", "cnpj", "razao_social", "ativo", "carteira_importada", "atualizado_em"],
                list(linhas_clientes.values()),
                """
                ON CONFLICT(cnpj) DO UPDATE SET
                  razao_social=CASE
                    WHEN TRIM(COALESCE(clientes.razao_social,''))='' OR clientes.razao_social=clientes.cnpj
                    THEN excluded.razao_social ELSE clientes.razao_social END,
                  atualizado_em=excluded.atualizado_em
                """,
            ),
        )

        legacy.executar_lotes(
            database_id,
            legacy.consultas_insert(
                "produtos",
                ["id", "ean", "sku", "descricao", "laboratorio", "tipo_mix", "ativo", "atualizado_em"],
                list(linhas_produtos.values()),
                """
                ON CONFLICT(ean) DO UPDATE SET
                  sku=excluded.sku,
                  descricao=CASE
                    WHEN TRIM(COALESCE(produtos.descricao,''))='' OR produtos.descricao LIKE 'Produto %'
                    THEN excluded.descricao ELSE produtos.descricao END,
                  laboratorio=CASE
                    WHEN TRIM(COALESCE(produtos.laboratorio,''))=''
                    THEN excluded.laboratorio ELSE produtos.laboratorio END,
                  ativo=1,
                  atualizado_em=excluded.atualizado_em
                """,
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

        legacy.executar_lotes(
            database_id,
            legacy.consultas_insert(
                "bussola_pedidos_staging_v2",
                [
                    "run_id", "id", "pedido_origem", "nota_fiscal", "cliente_id",
                    "centro_distribuicao", "uf_centro_distribuicao", "data_pedido",
                    "data_faturamento", "status", "valor_faturado", "atualizado_em",
                ],
                linhas_pedidos,
            ),
        )

        legacy.executar_lotes(
            database_id,
            legacy.consultas_insert(
                "bussola_itens_staging_v2",
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

        # O lote é atômico no D1: versões anteriores ficam inativas, nunca apagadas.
        legacy.executar_lotes(
            database_id,
            [
                {
                    "sql": "UPDATE itens_pedido SET ativo=0 WHERE pedido_id IN (SELECT id FROM pedidos WHERE origem='BUSSOLA' AND ativo=1)",
                    "params": [],
                },
                {"sql": "UPDATE pedidos SET ativo=0 WHERE origem='BUSSOLA' AND ativo=1", "params": []},
                {
                    "sql": """
                    INSERT INTO pedidos
                      (id,pedido_origem,nota_fiscal,cliente_id,consultor_id,
                       centro_distribuicao,uf_centro_distribuicao,data_pedido,
                       data_faturamento,status,valor_faturado,origem,atualizado_em,
                       ativo,ultima_extracao_id)
                    SELECT s.id,s.pedido_origem,s.nota_fiscal,s.cliente_id,c.consultor_id,
                           s.centro_distribuicao,s.uf_centro_distribuicao,s.data_pedido,
                           s.data_faturamento,s.status,s.valor_faturado,'BUSSOLA',s.atualizado_em,
                           1,?
                      FROM bussola_pedidos_staging_v2 s
                      LEFT JOIN clientes c ON c.id=s.cliente_id AND c.carteira_importada=1
                     WHERE s.run_id=?
                    ON CONFLICT(id) DO UPDATE SET
                      pedido_origem=excluded.pedido_origem,
                      nota_fiscal=excluded.nota_fiscal,
                      cliente_id=excluded.cliente_id,
                      consultor_id=excluded.consultor_id,
                      centro_distribuicao=excluded.centro_distribuicao,
                      uf_centro_distribuicao=excluded.uf_centro_distribuicao,
                      data_pedido=excluded.data_pedido,
                      data_faturamento=excluded.data_faturamento,
                      status=excluded.status,
                      valor_faturado=excluded.valor_faturado,
                      atualizado_em=excluded.atualizado_em,
                      ativo=1,
                      ultima_extracao_id=excluded.ultima_extracao_id
                    """,
                    "params": [extracao_id, run_uuid],
                },
                {
                    "sql": """
                    INSERT INTO itens_pedido
                      (id,pedido_id,produto_id,ean,descricao,quantidade_solicitada,
                       quantidade_atendida,quantidade_faturada,quantidade_cancelada,
                       preco_unitario_sem_imposto,preco_unitario_com_imposto,
                       valor_total_solicitado_sem_imposto,total_atendido_sem_imposto,
                       valor_faturado,
                       ativo,ultima_extracao_id)
                    SELECT id,pedido_id,produto_id,ean,descricao,quantidade_solicitada,
                           quantidade_atendida,quantidade_faturada,quantidade_cancelada,
                           preco_unitario_sem_imposto,preco_unitario_com_imposto,
                           valor_total_solicitado_sem_imposto,total_atendido_sem_imposto,
                           valor_faturado,
                           1,?
                      FROM bussola_itens_staging_v2 WHERE run_id=?
                    ON CONFLICT(id) DO UPDATE SET
                      pedido_id=excluded.pedido_id,
                      produto_id=excluded.produto_id,
                      ean=excluded.ean,
                      descricao=excluded.descricao,
                      quantidade_solicitada=excluded.quantidade_solicitada,
                      quantidade_atendida=excluded.quantidade_atendida,
                      quantidade_faturada=excluded.quantidade_faturada,
                      quantidade_cancelada=excluded.quantidade_cancelada,
                      preco_unitario_sem_imposto=excluded.preco_unitario_sem_imposto,
                      preco_unitario_com_imposto=excluded.preco_unitario_com_imposto,
                      valor_total_solicitado_sem_imposto=excluded.valor_total_solicitado_sem_imposto,
                      total_atendido_sem_imposto=excluded.total_atendido_sem_imposto,
                      valor_faturado=excluded.valor_faturado,
                      ativo=1,
                      ultima_extracao_id=excluded.ultima_extracao_id
                    """,
                    "params": [extracao_id, run_uuid],
                },
            ],
        )

        legacy.executar(database_id, "DELETE FROM bussola_pedidos_staging_v2 WHERE run_id=?", [run_uuid])
        legacy.executar(database_id, "DELETE FROM bussola_itens_staging_v2 WHERE run_id=?", [run_uuid])

        resumo = json.dumps(
            {
                "linhas": int(len(base)),
                "linhas_extraidas": int(total_extraido),
                "duplicatas_ignoradas": int(duplicatas_ignoradas),
                "pedidos": int(len(linhas_pedidos)),
                "itens": int(len(linhas_itens)),
                "regra_carteira": "PAINEL_EQUIPE_NORTE",
                "campo_valor": "valor_faturado",
                "sincronizado_em": timestamp,
            },
            ensure_ascii=False,
        )
        legacy.executar(
            database_id,
            """
            INSERT INTO configuracoes (chave,valor_json,atualizado_em)
            VALUES (?,?,?)
            ON CONFLICT(chave) DO UPDATE SET
              valor_json=excluded.valor_json,atualizado_em=excluded.atualizado_em
            """,
            ["bussola_ultima_sincronizacao", resumo, timestamp],
        )
        legacy.executar(
            database_id,
            "UPDATE integracao_credenciais SET status='conectada',mensagem_status=?,testado_em=? WHERE integracao='BUSSOLA'",
            [f"Conexão validada. {len(linhas_pedidos)} pedidos sincronizados pela carteira do Painel Equipe Norte.", timestamp],
        )
        legacy.executar(
            database_id,
            "UPDATE extracoes SET status='concluido',total_registros=?,mensagem=?,finalizado_em=? WHERE id=?",
            [
                len(base),
                f"{len(linhas_pedidos)} pedidos e {len(linhas_itens)} itens sincronizados; "
                f"{duplicatas_ignoradas} duplicatas ignoradas.",
                timestamp,
                extracao_id,
            ],
        )
        print(
            f"Bússola sincronizado corretamente: {len(linhas_pedidos)} pedidos, "
            f"{len(linhas_itens)} itens, {len(base)} linhas e "
            f"{duplicatas_ignoradas} duplicatas ignoradas."
        )
    except Exception as exc:
        finalizado = pd.Timestamp.now(tz="America/Sao_Paulo").isoformat()
        try:
            legacy.executar(
                database_id,
                "UPDATE extracoes SET status='erro',erro=?,finalizado_em=? WHERE id=?",
                [str(exc)[:2000], finalizado, extracao_id],
            )
            legacy.executar(
                database_id,
                "UPDATE integracao_credenciais SET status='erro',mensagem_status=?,testado_em=? WHERE integracao='BUSSOLA'",
                [str(exc)[:500], finalizado],
            )
        except Exception:
            pass
        raise


if __name__ == "__main__":
    sincronizar()
