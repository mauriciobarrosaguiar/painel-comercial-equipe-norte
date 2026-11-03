import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { analisarSkus } from '../functions/_lib/sku-coverage.js'
import { onRequestGet } from '../functions/api/cobertura-skus.js'
import { createSessionToken } from '../functions/_lib/credentials.js'

const catalog = [
  { id: 'p1', ean: '111', descricao: 'Produto 10mg 30cp', tipo_mix: 'LANÇAMENTO' },
  { id: 'p2', ean: '222', descricao: 'Produto 20mg 30cp', tipo_mix: 'PRIORITARIO' },
  { id: 'p3', ean: '333', descricao: 'Produto 20mg 60cp', tipo_mix: 'PRIORITARIO' },
]
const clients = [{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }, { id: 'c', nome: 'Sem compras' }]
test('separa apresentações, SKUs distintos, unidades, faltantes e recompra por cliente', () => {
  const rows = [
    { cliente_id: 'a', sku: '111', mes: '2026-09', quantidade: 5, pedidos: 2 },
    { cliente_id: 'a', sku: '111', mes: '2026-10', quantidade: 7, pedidos: 1 },
    { cliente_id: 'b', sku: '111', mes: '2026-10', quantidade: 3, pedidos: 1 },
    { cliente_id: 'a', sku: '222', mes: '2026-10', quantidade: 8, pedidos: 1 },
    { cliente_id: 'a', sku: '999', mes: '2026-10', quantidade: 4, pedidos: 1 },
  ]
  const data = analisarSkus(catalog, rows, clients)
  assert.equal(data.resumo.LANCAMENTO.comprados, 1)
  assert.equal(data.resumo.LANCAMENTO.unidades, 15)
  assert.equal(data.resumo.PRIORITARIO.faltantes, 1)
  assert.equal(data.resumo.TOTAL.unidades, 27)
  assert.equal(data.unidades_sem_catalogo, 4)
  assert.equal(data.produtos.find(p => p.sku === '111').clientes_recompra, 1)
  assert.equal(data.clientes[0].grupos.LANCAMENTO.unidades, 12)
  assert.equal(data.clientes[2].grupos.PRIORITARIO.comprados, 0)
  assert.equal(data.mensal[0].grupos.TOTAL.unidades, 5)
  const october = analisarSkus(catalog, rows, clients, '2026-10-01', '2026-10-31')
  assert.equal(october.resumo.LANCAMENTO.unidades, 10)
  assert.equal(october.produtos.find(p => p.sku === '111').clientes_recompra, 0)
})

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE produtos(id TEXT,ean TEXT,sku TEXT,descricao TEXT,tipo_mix TEXT,ativo INTEGER);
    CREATE TABLE desafio_gigantes_metas(sku TEXT,ean TEXT,produto_identificado TEXT,produto_planilha TEXT,escopo TEXT,consultor_id TEXT,ano_mes TEXT);
    CREATE TABLE produtos_mix_sap(sku TEXT,descricao TEXT,tipo_mix TEXT,ativo INTEGER);
    CREATE TABLE clientes(id TEXT,cnpj TEXT,nome_fantasia TEXT,razao_social TEXT,consultor_id TEXT,ativo INTEGER,carteira_importada INTEGER,uf TEXT);
    CREATE TABLE pedidos(id TEXT,cliente_id TEXT,consultor_id TEXT,data_faturamento TEXT,data_pedido TEXT,status TEXT,ativo INTEGER);
    CREATE TABLE itens_pedido(id TEXT,pedido_id TEXT,produto_id TEXT,ean TEXT,quantidade_faturada REAL,ativo INTEGER);
    INSERT INTO produtos VALUES('p1','111',NULL,'Produto A','LANCAMENTO',1),('p2','222',NULL,'Produto B','PRIORITARIO',1),('p3','333',NULL,'Produto C','PRIORITARIO',1);
    INSERT INTO clientes VALUES('a','1','Cliente A','','me',1,1,'TO'),('b','2','Outro cliente','','other',1,1,'TO'),('c','3','Cliente sem compras','','me',1,1,'TO');
    INSERT INTO pedidos VALUES('o1','a','me','2026-11-01',NULL,'FATURADO',1),('o2','a','me','2026-11-02',NULL,'FATURADO PARCIAL',1),('o3','a','me','2026-10-30',NULL,'FATURADO',1),('o4','a','me','2026-11-02',NULL,'ENVIADO',1),('o5','b','other','2026-11-02',NULL,'FATURADO',1),('o6','a','me','2026-11-02',NULL,'FATURADO',0);
    INSERT INTO itens_pedido VALUES('i1','o1','p1','111',10,1),('i2','o1','p2','222',4,1),('i3','o2',NULL,'111',2,1),('i4','o3','p3','333',8,1),('i5','o4','p3','333',90,1),('i6','o5','p3','333',99,1),('i7','o6','p3','333',90,1),('i8','o1','p3','333',90,0),('i9','o1','p3','333',0,1);`)
  const prepare = sql => {
    let args = []
    return { bind(...values) { args = values; return this }, async all() { return { results: db.prepare(sql).all(...args) } } }
  }
  return { prepare, batch: stmts => Promise.all(stmts.map(s => s.all())), exec: sql => db.exec(sql) }
}
const secret = 'fixture-secret'
async function request(query = '', signed = true) {
  const token = await createSessionToken({ login: 'test', consultor_id: 'me' }, secret)
  return new Request(`https://example.test/api/cobertura-skus?${query}`, { headers: signed ? { cookie: `painel_session=${token}` } : {} })
}
test('SQL real respeita período, carteira, pedidos e itens ativos, e correspondência EAN', async () => {
  const response = await onRequestGet({ request: await request('inicio=2026-11-01&fim=2026-11-03'), env: { DB: fixture(), PAINEL_ADMIN_KEY: secret } })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.resumo.LANCAMENTO.unidades, 12)
  assert.equal(data.resumo.PRIORITARIO.unidades, 4)
  assert.equal(data.resumo.TOTAL.comprados, 2)
  assert.equal(data.clientes.length, 2)
  assert.equal(data.produtos.find(p => p.sku === 'ean:111').clientes_recompra, 1)
})
test('nega acesso sem sessão e a cliente de outro consultor; valida datas', async () => {
  const env = { DB: fixture(), PAINEL_ADMIN_KEY: secret }
  assert.equal((await onRequestGet({ request: await request('', false), env })).status, 401)
  assert.equal((await onRequestGet({ request: await request('id=b'), env })).status, 404)
  assert.equal((await onRequestGet({ request: await request('inicio=2026-99-01&fim=2026-11-03'), env })).status, 400)
  assert.equal((await onRequestGet({ request: await request('inicio=2026-11-01'), env })).status, 400)
})

test('inclui SAP sem EAN no denominador e une EANs do mesmo SKU sem duplicar cobertura', async () => {
  const DB = fixture()
  DB.exec(`UPDATE produtos SET sku='SAP1' WHERE id='p1';
    INSERT INTO produtos_mix_sap VALUES('SAP1','Lançamento A','LANCAMENTO',1),('SAP2','Lançamento sem EAN','LANCAMENTO',1);
    INSERT INTO produtos VALUES('p4','444','SAP1','Outra embalagem comercial mesmo SAP','LANCAMENTO',1);
    INSERT INTO itens_pedido VALUES('i10','o2','p4','444',3,1);`)
  const response = await onRequestGet({ request: await request('inicio=2026-11-01&fim=2026-11-03'), env: { DB, PAINEL_ADMIN_KEY: secret } })
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.resumo.LANCAMENTO.total, 2)
  assert.equal(data.resumo.LANCAMENTO.comprados, 1)
  assert.equal(data.resumo.LANCAMENTO.unidades, 15)
  assert.equal(data.resumo.LANCAMENTO.faltantes, 1)
  assert.equal(data.produtos.find(p => p.codigo_sap === 'SAP2').unidades, 0)
})


test('Desafio usa a campanha do consultor e período, inclui ausentes e não altera catálogo total', async () => {
  const DB = fixture()
  DB.exec(`INSERT INTO desafio_gigantes_metas VALUES
    ('SAP1','111','Produto A','','consultor','me','2026-11'),
    ('SAP1','111','Produto A','','consultor','me','2026-11'),
    ('SAP3','333','Produto C','','consultor','me','2026-11'),
    ('SAP9',NULL,'Produto pendente','','consultor','me','2026-11'),
    ('SAP2','222','Outro mês','','consultor','me','2026-10'),
    ('SAP4','444','Outro consultor','','consultor','other','2026-11');`)
  const response = await onRequestGet({ request: await request('inicio=2026-11-01&fim=2026-11-03'), env: { DB, PAINEL_ADMIN_KEY: secret } })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.resumo.DESAFIO.total, 3)
  assert.equal(data.resumo.DESAFIO.comprados, 1)
  assert.equal(data.resumo.DESAFIO.faltantes, 2)
  assert.equal(data.resumo.DESAFIO.unidades, 12)
  assert.equal(data.resumo.TOTAL.total, 3)
  const faltantes = data.produtos.filter(p => p.desafio && p.unidades === 0)
  assert.deepEqual(faltantes.map(p => p.produto).sort(), ['Produto C', 'Produto pendente'])
  assert.equal(data.clientes.find(c => c.id === 'c').grupos.DESAFIO.faltantes, 3)
})
