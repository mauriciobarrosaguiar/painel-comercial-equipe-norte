from __future__ import annotations

import ast
import sqlite3
from pathlib import Path


MIGRATIONS = Path(__file__).resolve().parents[1] / "web" / "migrations"
EXTRATOR = Path(__file__).resolve().parents[1] / "scripts" / "extrair_bussola_d1_corrigido.py"


def _aplicar_migrations(connection: sqlite3.Connection) -> None:
    arquivos = sorted(
        MIGRATIONS.glob("*.sql"),
        key=lambda path: int(path.stem.split("_", 1)[0]),
    )
    for arquivo in arquivos:
        connection.executescript(arquivo.read_text(encoding="utf-8"))


def _sql_do_extrator(trecho: str) -> str:
    arvore = ast.parse(EXTRATOR.read_text(encoding="utf-8"))
    candidatos = [
        no.value
        for no in ast.walk(arvore)
        if isinstance(no, ast.Constant) and isinstance(no.value, str) and trecho in no.value
    ]
    assert len(candidatos) == 1
    return candidatos[0]


def test_migrations_criam_controle_de_versao_da_bussola() -> None:
    connection = sqlite3.connect(":memory:")
    _aplicar_migrations(connection)

    pedidos = {row[1] for row in connection.execute("PRAGMA table_info(pedidos)")}
    itens = {row[1] for row in connection.execute("PRAGMA table_info(itens_pedido)")}
    sip_clientes = {row[1] for row in connection.execute("PRAGMA table_info(sip_clientes)")}
    indices = {row[1] for row in connection.execute("PRAGMA index_list(pedidos)")}

    assert {"ativo", "ultima_extracao_id"} <= pedidos
    assert {
        "ativo",
        "ultima_extracao_id",
        "valor_total_solicitado_sem_imposto",
        "total_atendido_sem_imposto",
    } <= itens
    assert "objetivo_preco_liquido" in sip_clientes
    assert "idx_pedidos_data_faturamento" in indices
    tabelas = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"auditorias_calculos", "metas_historico", "sips", "redes", "sip_clientes", "sip_recados"} <= tabelas


def test_sincronizacao_bussola_atualiza_sem_apagar_historico() -> None:
    connection = sqlite3.connect(":memory:")
    _aplicar_migrations(connection)

    connection.executescript(_sql_do_extrator("CREATE TABLE IF NOT EXISTS bussola_pedidos_staging_v2"))
    connection.execute("INSERT INTO consultores(id,nome,origem) VALUES('c1','Consultor','PAINEL_EQUIPE')")
    connection.execute(
        "INSERT INTO clientes(id,cnpj,consultor_id,carteira_importada) VALUES('cl1','12345678000190','c1',1)"
    )
    connection.execute("INSERT INTO produtos(id,ean,descricao) VALUES('pr1','7891','Produto')")
    connection.execute(
        """INSERT INTO bussola_pedidos_staging_v2
        (run_id,id,pedido_origem,nota_fiscal,cliente_id,data_pedido,data_faturamento,status,valor_faturado,atualizado_em)
        VALUES('run-1','p1','P1','NF1','cl1','2026-07-10','2026-07-12','FATURADO',100,'2026-07-20')"""
    )
    connection.execute(
        """INSERT INTO bussola_itens_staging_v2
        (run_id,id,pedido_id,produto_id,ean,descricao,valor_total_solicitado_sem_imposto,total_atendido_sem_imposto,valor_faturado)
        VALUES('run-1','i1','p1','pr1','7891','Produto',125,100,100)"""
    )

    connection.execute(_sql_do_extrator("INSERT INTO pedidos\n"), ("ext-1", "run-1"))
    connection.execute(_sql_do_extrator("INSERT INTO itens_pedido\n"), ("ext-1", "run-1"))
    connection.execute("UPDATE pedidos SET ativo=0 WHERE id='p1'")
    connection.execute("UPDATE itens_pedido SET ativo=0 WHERE id='i1'")
    connection.execute(_sql_do_extrator("INSERT INTO pedidos\n"), ("ext-2", "run-1"))
    connection.execute(_sql_do_extrator("INSERT INTO itens_pedido\n"), ("ext-2", "run-1"))

    assert connection.execute("SELECT ativo,ultima_extracao_id FROM pedidos WHERE id='p1'").fetchone() == (1, "ext-2")
    assert connection.execute("SELECT ativo,ultima_extracao_id FROM itens_pedido WHERE id='i1'").fetchone() == (1, "ext-2")
    assert connection.execute(
        "SELECT valor_total_solicitado_sem_imposto,total_atendido_sem_imposto FROM itens_pedido WHERE id='i1'"
    ).fetchone() == (125, 100)
