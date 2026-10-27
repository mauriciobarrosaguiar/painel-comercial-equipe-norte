import test from 'node:test'
import assert from 'node:assert/strict'
import { mesesReferencia, gerarInteligencia } from '../functions/_lib/client-insights.js'
import { createSessionToken } from '../functions/_lib/credentials.js'
import { onRequestGet as inteligencia } from '../functions/api/clientes/inteligencia.js'
import { personalDatabase, MAURICIO_TEST_ID } from './d1-fixture.js'

test('últimos três meses seguem calendário e fuso de Brasília', () => {
  const periodo = mesesReferencia(new Date('2026-10-22T18:02:00Z'))
  assert.deepEqual([periodo.inicio_3m, periodo.inicio_6m, periodo.fim], ['2026-07-01', '2026-04-01', '2026-10-22'])
})

test('cobertura conta somente os EANs faturados nos três meses, e sugere reposição e mix', () => {
  const periodo = mesesReferencia(new Date('2026-10-22T18:02:00Z'))
  const catalogo = [
    { id: 'p1', ean: '123', descricao: 'Produto A', tipo_mix: 'LINHA' },
    { id: 'p2', ean: '456', descricao: 'Produto B', tipo_mix: 'PRIORITARIO' },
    { id: 'p3', ean: '789', descricao: 'Produto C', tipo_mix: 'LINHA' },
  ]
  const compras = [
    { id: 'p1', linhas_3m: 2, quantidade_3m: 9, quantidade_6m: 12, pedidos_3m: 2 },
    { id: 'p3', linhas_3m: 0, quantidade_3m: 0, quantidade_6m: 6 },
  ]
  const { cobertura, sugestoes } = gerarInteligencia(catalogo, compras, periodo)
  assert.equal(cobertura.comprados, 1)
  assert.equal(cobertura.nao_comprados, 2)
  assert.equal(cobertura.percentual, 33.3)
  assert.equal(sugestoes.find(item => item.id === 'p1').quantidade_sugerida, 3)
  assert.equal(sugestoes.find(item => item.id === 'p2').tipo, 'EXPANSAO_MIX')
  assert.equal(sugestoes.find(item => item.id === 'p3').tipo, 'REATIVACAO')
})

test('sugestão usa a média dos três meses fechados e desconta vendas do mês corrente', () => {
  const periodo = mesesReferencia(new Date('2026-10-27T13:00:00Z'))
  assert.equal(periodo.inicio_3m, '2026-07-01')
  assert.equal(periodo.fim_3m, '2026-09-30')
  assert.equal(periodo.inicio_mes_atual, '2026-10-01')
  const catalogo = [
    { id: 'reposicao', ean: '111', descricao: 'Reposição', tipo_mix: 'LINHA' },
    { id: 'completo', ean: '222', descricao: 'Já comprado', tipo_mix: 'LINHA' },
    { id: 'mix', ean: '333', descricao: 'Mix comprado agora', tipo_mix: 'PRIORITARIO' },
    { id: 'semcompra', ean: '444', descricao: 'Mix novo', tipo_mix: 'PRIORITARIO' },
  ]
  const compras = [
    { id: 'reposicao', linhas_3m: 2, quantidade_3m: 90, quantidade_6m: 90, quantidade_mes_atual: 12, linhas_mes_atual: 1 },
    { id: 'completo', linhas_3m: 1, quantidade_3m: 30, quantidade_6m: 30, quantidade_mes_atual: 10, linhas_mes_atual: 1 },
    { id: 'mix', linhas_3m: 0, quantidade_3m: 0, quantidade_6m: 0, quantidade_mes_atual: 1, linhas_mes_atual: 1 },
  ]
  const { sugestoes } = gerarInteligencia(catalogo, compras, periodo)
  assert.equal(sugestoes.find(item => item.ean === '111').quantidade_base, 30)
  assert.equal(sugestoes.find(item => item.ean === '111').quantidade_mes_atual, 12)
  assert.equal(sugestoes.find(item => item.ean === '111').quantidade_sugerida, 18)
  assert.ok(!sugestoes.some(item => item.ean === '222' || item.ean === '333'))
  assert.equal(sugestoes.find(item => item.ean === '444').quantidade_sugerida, 1)
})

test('análise exige sessão da carteira e oferece somente UF do cliente com estoque', async () => {
  const DB = await personalDatabase()
  const periodo = mesesReferencia()
  const hoje = periodo.fim
  await DB.prepare("INSERT INTO pedidos(id,pedido_origem,cliente_id,consultor_id,data_pedido,data_faturamento,status,ativo) VALUES ('pnovo','N','cl1',?,?,?,'FATURADO',1)")
    .bind(MAURICIO_TEST_ID, periodo.inicio_3m, periodo.inicio_3m).run()
  await DB.prepare("INSERT INTO itens_pedido(id,pedido_id,produto_id,ean,descricao,quantidade_faturada,valor_faturado,ativo) VALUES ('inovo','pnovo','linha','111','Linha',12,120,1)").run()
  await DB.prepare("INSERT INTO pedidos(id,pedido_origem,cliente_id,consultor_id,data_pedido,data_faturamento,status,ativo) VALUES ('patual','N','cl1',?,?,?,'FATURADO',1)")
    .bind(MAURICIO_TEST_ID, hoje, hoje).run()
  await DB.prepare("INSERT INTO itens_pedido(id,pedido_id,produto_id,ean,descricao,quantidade_faturada,valor_faturado,ativo) VALUES ('iatual','patual','linha','111','Linha',1,10,1)").run()
  await DB.prepare("INSERT INTO mercado_farma_precos VALUES ('outra-uf','TO','111','linha','111','Linha','Distribuidora TO',100,0,0,0,15,10,'OK','',?)").bind(hoje).run()

  const semSessao = await inteligencia({ request: new Request('https://painel.local/api/clientes/inteligencia?id=cl1'), env: { DB, PAINEL_ADMIN_KEY: 'secret-123456789' } })
  assert.equal(semSessao.status, 401)

  const segredo = 'secret-123456789'
  const token = await createSessionToken({ login: 'mauricio', nome: 'Mauricio', consultor_id: MAURICIO_TEST_ID }, segredo)
  const headers = { cookie: `painel_session=${token}` }
  const response = await inteligencia({ request: new Request('https://painel.local/api/clientes/inteligencia?id=cl1', { headers }), env: { DB, PAINEL_ADMIN_KEY: segredo } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.cobertura.total, 4)
  assert.equal(body.cobertura.comprados, 1)
  assert.equal(body.cobertura.nao_comprados, 3)
  assert.equal(body.cliente.uf, 'PA')
  const compra = body.sugestoes.find(item => item.ean === '111')
  assert.equal(compra.quantidade_mes_atual, 1)
  assert.equal(compra.quantidade_base - compra.quantidade_mes_atual, compra.quantidade_sugerida)
  assert.ok(compra.quantidade_sugerida > 0)
  assert.equal(compra.ofertas.length, 1)
  assert.equal(compra.ofertas[0].distribuidora, 'Distribuidora A')
  assert.ok(body.distribuidoras_disponiveis.includes('Distribuidora A'))
  assert.ok(!body.distribuidoras_disponiveis.includes('Distribuidora TO'))


  const forjado = await inteligencia({ request: new Request('https://painel.local/api/clientes/inteligencia?id=cl-nao-autorizado', { headers }), env: { DB, PAINEL_ADMIN_KEY: segredo } })
  assert.equal(forjado.status, 404)
})
