import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { onRequestGet as dashboard } from '../functions/api/dashboard.js'
import { onRequestGet as consultores } from '../functions/api/consultores.js'

function d1Statement(database, sql, parameters = []) {
  return {
    bind(...values) {
      return d1Statement(database, sql, values)
    },
    async all() {
      return { results: database.prepare(sql).all(...parameters) }
    },
  }
}

function testDatabase() {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    CREATE TABLE consultores (id TEXT PRIMARY KEY, nome TEXT, uf TEXT, ativo INTEGER, origem TEXT);
    CREATE TABLE clientes (id TEXT PRIMARY KEY, consultor_id TEXT, uf TEXT, ativo INTEGER, carteira_importada INTEGER);
    CREATE TABLE produtos (id TEXT PRIMARY KEY, tipo_mix TEXT, mercado_farma_ativo INTEGER);
    CREATE TABLE pedidos (id TEXT PRIMARY KEY, cliente_id TEXT, data_pedido TEXT, data_faturamento TEXT, status TEXT, ativo INTEGER);
    CREATE TABLE itens_pedido (id TEXT PRIMARY KEY, pedido_id TEXT, produto_id TEXT, valor_faturado REAL, ativo INTEGER);
    CREATE TABLE metas (consultor_id TEXT, escopo TEXT, ano_mes TEXT, ol_sem_combate REAL, ol_prioritarios REAL, ol_lancamentos REAL, clientes_positivados INTEGER);
    CREATE TABLE extracoes (id TEXT PRIMARY KEY, status TEXT);

    INSERT INTO consultores VALUES ('co1','Ana','PA',1,'PAINEL_EQUIPE');
    INSERT INTO clientes VALUES ('cl1','co1','PA',1,1), ('cl2','co1','PA',1,1);
    INSERT INTO produtos VALUES
      ('linha','LINHA',0),
      ('prioritario','PRIORITARIO',0),
      ('combate','COMBATE',0),
      ('desconhecido','SEM CLASSIFICACAO',0);
    INSERT INTO pedidos VALUES
      ('p1','cl1','2026-07-10','2026-07-10','FATURADO',1),
      ('p2','cl1','2026-07-10','2026-07-10','NAO FATURADO',1),
      ('p3','cl1','2026-07-10','2026-07-10','FATURADO',0);
    INSERT INTO itens_pedido VALUES
      ('i1','p1','linha',100,1),
      ('i2','p1','prioritario',50,1),
      ('i3','p1','combate',40,1),
      ('i4','p1','desconhecido',10,1),
      ('i5','p1','linha',999,0),
      ('i6','p2','linha',700,1),
      ('i7','p3','linha',800,1);
  `)

  return {
    prepare(sql) {
      return d1Statement(database, sql)
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.all()))
    },
  }
}

test('dashboard separa total, sem combate, combate e não classificados', async () => {
  const response = await dashboard({
    request: new Request('https://painel.local/api/dashboard?periodo=todo-periodo'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.equal(body.ol_total_faturado, 200)
  assert.equal(body.ol_sem_combate, 150)
  assert.equal(body.ol_prioritarios, 50)
  assert.equal(body.ol_combate, 40)
  assert.equal(body.clientes_com_venda, 1)
  assert.equal(body.clientes_sem_venda, 1)
})

test('módulo de consultores aplica as mesmas regras do dashboard', async () => {
  const response = await consultores({
    request: new Request('https://painel.local/api/consultores?periodo=todo-periodo'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.equal(body.consultores.length, 1)
  assert.equal(body.consultores[0].ol_total_faturado, 200)
  assert.equal(body.consultores[0].ol_sem_combate, 150)
  assert.equal(body.consultores[0].ol_combate, 40)
  assert.equal(body.consultores[0].clientes_com_venda, 1)
  assert.equal(body.consultores[0].clientes_sem_venda, 1)
})
