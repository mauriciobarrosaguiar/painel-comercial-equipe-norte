from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

import pandas as pd

from scripts import importar_mercadofarma_d1 as d1
from src.persistencia import carregar_json
from src.sip_migracao import normalizar_sips_para_d1


def agora() -> str:
    return pd.Timestamp.now(tz="America/Sao_Paulo").isoformat()


def consulta_valor(database_id: str, sql: str, params: list[Any]) -> int:
    resposta = d1.executar(database_id, sql, params)
    for bloco in resposta.get("result") or []:
        linhas = bloco.get("results") or []
        if linhas:
            return int(linhas[0].get("total") or 0)
    return 0


def consultas_upsert(
    dados: dict[str, list[dict[str, Any]]],
    importacao_id: str,
    timestamp: str,
) -> list[dict[str, Any]]:
    consultas: list[dict[str, Any]] = []
    for item in dados["sips"]:
        consultas.append({
            "sql": """
            INSERT INTO sips (
              id,id_legado,nome,meta_mes,pagamento_percentual,
              acesso_publico_ativo,acesso_publico_expira_em,origem,
              ativo,importacao_id,atualizado_em
            ) VALUES (?,?,?,?,?,?,?,'LEGADO',1,?,?)
            ON CONFLICT(id) DO UPDATE SET
              id_legado=excluded.id_legado,
              nome=excluded.nome,
              meta_mes=excluded.meta_mes,
              pagamento_percentual=excluded.pagamento_percentual,
              acesso_publico_ativo=excluded.acesso_publico_ativo,
              acesso_publico_expira_em=excluded.acesso_publico_expira_em,
              ativo=1,
              importacao_id=excluded.importacao_id,
              atualizado_em=excluded.atualizado_em
            """,
            "params": [
                item["id"], item["id_legado"], item["nome"], item["meta_mes"],
                item["pagamento_percentual"], item["acesso_publico_ativo"],
                item["acesso_publico_expira_em"], importacao_id, timestamp,
            ],
        })

    for item in dados["redes"]:
        consultas.append({
            "sql": """
            INSERT INTO redes(id,nome,origem,ativo,atualizado_em)
            VALUES (?,?,'LEGADO_SIP',1,?)
            ON CONFLICT(id) DO UPDATE SET
              nome=excluded.nome,ativo=1,atualizado_em=excluded.atualizado_em
            """,
            "params": [item["id"], item["nome"], timestamp],
        })

    for item in dados["sip_redes"]:
        consultas.append({
            "sql": """
            INSERT INTO sip_redes(sip_id,rede_id,ativo,importacao_id,atualizado_em)
            VALUES (?,?,1,?,?)
            ON CONFLICT(sip_id,rede_id) DO UPDATE SET
              ativo=1,importacao_id=excluded.importacao_id,
              atualizado_em=excluded.atualizado_em
            """,
            "params": [item["sip_id"], item["rede_id"], importacao_id, timestamp],
        })

    for item in dados["sip_clientes"]:
        consultas.append({
            "sql": """
            INSERT INTO sip_clientes(
              sip_id,cnpj,cliente_id,ativo,importacao_id,atualizado_em
            )
            SELECT ?,?,(SELECT id FROM clientes WHERE cnpj=? LIMIT 1),1,?,?
            ON CONFLICT(sip_id,cnpj) DO UPDATE SET
              cliente_id=excluded.cliente_id,ativo=1,
              importacao_id=excluded.importacao_id,
              atualizado_em=excluded.atualizado_em
            """,
            "params": [item["sip_id"], item["cnpj"], item["cnpj"], importacao_id, timestamp],
        })

    for item in dados["recados"]:
        consultas.append({
            "sql": """
            INSERT INTO sip_recados(
              id,sip_id,titulo,comentario,status,imagem_nome,imagem_tipo,
              imagem_base64,criado_em,atualizado_em,ativo,importacao_id
            ) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)
            ON CONFLICT(id) DO UPDATE SET
              sip_id=excluded.sip_id,titulo=excluded.titulo,
              comentario=excluded.comentario,status=excluded.status,
              imagem_nome=excluded.imagem_nome,imagem_tipo=excluded.imagem_tipo,
              imagem_base64=excluded.imagem_base64,
              criado_em=excluded.criado_em,atualizado_em=excluded.atualizado_em,
              ativo=1,importacao_id=excluded.importacao_id
            """,
            "params": [
                item["id"], item["sip_id"], item["titulo"], item["comentario"],
                item["status"], item["imagem_nome"], item["imagem_tipo"],
                item["imagem_base64"], item["criado_em"], item["atualizado_em"],
                importacao_id,
            ],
        })
    return consultas


def registrar_avisos(
    database_id: str,
    importacao_id: str,
    avisos: list[dict[str, Any]],
) -> None:
    consultas = [
        {
            "sql": """
            INSERT INTO sip_migracao_erros(
              importacao_id,sip_id,tipo,referencia,mensagem
            ) VALUES (?,?,?,?,?)
            """,
            "params": [
                importacao_id,
                aviso.get("sip_id", ""),
                aviso.get("tipo", "AVISO"),
                aviso.get("referencia", ""),
                aviso.get("mensagem", ""),
            ],
        }
        for aviso in avisos
    ]
    if consultas:
        d1.executar_lotes(database_id, consultas)


def migrar() -> dict[str, Any]:
    brutos = carregar_json("sip", [])
    dados = normalizar_sips_para_d1(brutos)
    if not dados["sips"]:
        raise RuntimeError("A base SIP persistida está vazia ou inválida; o D1 foi preservado.")

    database_id = d1.localizar_database_id()
    timestamp = agora()
    importacao_id = f"imp-{uuid4().hex}"
    d1.executar(
        database_id,
        """
        INSERT INTO importacoes(
          id,tipo,nome_arquivo,total_registros,status,erro,criado_em
        ) VALUES (?,?,?,?,?,?,?)
        """,
        [importacao_id, "SIP_REDES", "sip_grupos.json.fernet", 0, "executando", "", timestamp],
    )

    try:
        consultas = consultas_upsert(dados, importacao_id, timestamp)
        if consultas:
            d1.executar_lotes(database_id, consultas)

        # Ausências na fonte atual apenas inativam registros antigos; nada é excluído.
        d1.executar_lotes(database_id, [
            {"sql": "UPDATE sips SET ativo=0 WHERE origem='LEGADO' AND COALESCE(importacao_id,'')<>?", "params": [importacao_id]},
            {"sql": "UPDATE sip_redes SET ativo=0 WHERE COALESCE(importacao_id,'')<>? AND sip_id IN (SELECT id FROM sips WHERE origem='LEGADO')", "params": [importacao_id]},
            {"sql": "UPDATE sip_clientes SET ativo=0 WHERE COALESCE(importacao_id,'')<>? AND sip_id IN (SELECT id FROM sips WHERE origem='LEGADO')", "params": [importacao_id]},
            {"sql": "UPDATE sip_recados SET ativo=0 WHERE COALESCE(importacao_id,'')<>? AND sip_id IN (SELECT id FROM sips WHERE origem='LEGADO')", "params": [importacao_id]},
            {"sql": "UPDATE redes SET ativo=CASE WHEN EXISTS(SELECT 1 FROM sip_redes sr WHERE sr.rede_id=redes.id AND sr.ativo=1) THEN 1 ELSE 0 END WHERE origem='LEGADO_SIP'", "params": []},
        ])

        registrar_avisos(database_id, importacao_id, dados["avisos"])
        d1.executar(
            database_id,
            """
            INSERT INTO sip_migracao_erros(
              importacao_id,sip_id,tipo,referencia,mensagem
            )
            SELECT ?,sip_id,'CNPJ_NAO_LOCALIZADO',cnpj,
                   'CNPJ da SIP não localizado na carteira oficial.'
              FROM sip_clientes
             WHERE importacao_id=? AND ativo=1 AND cliente_id IS NULL
            """,
            [importacao_id, importacao_id],
        )
        sem_vinculo = consulta_valor(
            database_id,
            "SELECT COUNT(*) total FROM sip_clientes WHERE importacao_id=? AND ativo=1 AND cliente_id IS NULL",
            [importacao_id],
        )
        resumo = {
            "sips": len(dados["sips"]),
            "redes": len(dados["redes"]),
            "vinculos_cnpj": len(dados["sip_clientes"]),
            "cnpjs_nao_localizados": sem_vinculo,
            "recados": len(dados["recados"]),
            "avisos": len(dados["avisos"]),
            "importacao_id": importacao_id,
            "migrado_em": timestamp,
        }
        d1.executar_lotes(database_id, [
            {
                "sql": "UPDATE importacoes SET total_registros=?,status='concluido',erro='' WHERE id=?",
                "params": [len(dados["sips"]), importacao_id],
            },
            {
                "sql": """
                INSERT INTO configuracoes(chave,valor_json,atualizado_em)
                VALUES ('migracao_sips',?,?)
                ON CONFLICT(chave) DO UPDATE SET
                  valor_json=excluded.valor_json,
                  atualizado_em=excluded.atualizado_em
                """,
                "params": [json.dumps(resumo, ensure_ascii=False), timestamp],
            },
        ])
        return resumo
    except Exception as exc:
        d1.executar(
            database_id,
            "UPDATE importacoes SET status='erro',erro=? WHERE id=?",
            [str(exc)[:2000], importacao_id],
        )
        raise


if __name__ == "__main__":
    print(json.dumps(migrar(), ensure_ascii=False, indent=2))
