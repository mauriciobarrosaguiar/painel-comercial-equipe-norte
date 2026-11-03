import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequestGet as dashboard } from '../functions/api/dashboard.js'
import { onRequestGet as consultores } from '../functions/api/consultores.js'
import { onRequestGet as clientes } from '../functions/api/clientes.js'
import { onRequestGet as sips } from '../functions/api/sips.js'
import { onRequestGet as sip } from '../functions/api/sips/detalhe.js'
import { onRequestGet as market } from '../functions/api/mercado-farma-v2.js'
import { loadConsultantReport } from '../functions/_lib/consultant-report.js'
import { personalDatabase } from './d1-fixture.js'

test('faturamento concilia entre dashboard, desempenho, clientes, SIP e relatório', async () => {
  const DB = await personalDatabase(), key = 'chave-administrativa-teste'
  const env = { DB, PAINEL_ADMIN_KEY: key }
  const call = async (handler, path) => {
    const response = await handler({ request: new Request(`https://test${path}`, { headers: { 'x-admin-key': key } }), env })
    assert.equal(response.status, 200)
    return response.json()
  }
  const [a, b, c, d] = await Promise.all([
    call(dashboard, '/api/dashboard?periodo=todo-periodo'),
    call(consultores, '/api/consultores?periodo=todo-periodo'),
    call(clientes, '/api/clientes?periodo=todo-periodo'),
    call(sips, '/api/sips?periodo=todo-periodo'),
  ])
  const report = await loadConsultantReport(new Request('https://test/report?periodo=todo-periodo', { headers: { 'x-admin-key': key } }), env)
  assert.equal(a.ol_total_faturado, 200)
  assert.equal(b.consultores[0].ol_total_faturado, a.ol_total_faturado)
  assert.equal(c.resumo.faturamento_total, a.ol_total_faturado)
  assert.equal(d.sips[0].ol_total, a.ol_total_faturado)
  assert.equal(report.rows[0].ol_total_faturado, a.ol_total_faturado)
  assert.equal(report.rows[0].valor_nao_faturado, a.valor_nao_faturado)
  assert.equal(a.ol_sem_combate + a.ol_combate + 10, a.ol_total_faturado) // R$10 sem classificação
})

test('projeção SIP usa os mesmos 19 dias úteis do dashboard em novembro', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-03T15:00:00Z') })
  const DB = await personalDatabase()
  await DB.prepare("UPDATE pedidos SET data_faturamento='2026-11-03',data_pedido='2026-11-03'").run()
  const response = await sip({ request: new Request('https://test/api/sips/detalhe?id=sip1&inicio=2026-11-01&fim=2026-11-30'), env: { DB } })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.totais.projecao_ol_sem_combate, 150 * 19)
})

test('menor preço ignora zero e oferta com falha', async () => {
  const DB = await personalDatabase()
  await DB.prepare("INSERT INTO mercado_farma_precos VALUES('zero','PA','111','linha','111','Linha','Preço zero',100,0,0,0,0,0,'OK','','2026-11-03')").run()
  await DB.prepare("INSERT INTO mercado_farma_precos VALUES('erro','PA','111','linha','111','Linha','Oferta com erro',100,0,0,0,1,1,'ERRO','','2026-11-03')").run()
  const response = await market({ request: new Request('https://test/api/mercado-farma?uf=PA'), env: { DB } })
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.resultados[0].melhor_preco, 10)
})

test('cliente com compra integralmente estornada não continua positivado em outra tela', async () => {
  const DB = await personalDatabase(), env = { DB }
  await DB.prepare("INSERT INTO itens_pedido(id,pedido_id,produto_id,ean,quantidade_faturada,valor_faturado,ativo) VALUES('estorno','p1','linha','111',-4,-200,1)").run()
  const call = async (handler, path) => (await handler({ request: new Request(`https://test${path}?periodo=todo-periodo`), env })).json()
  const [a, b, c] = await Promise.all([call(dashboard, '/api/dashboard'), call(consultores, '/api/consultores'), call(clientes, '/api/clientes')])
  assert.equal(a.ol_total_faturado, 0)
  assert.equal(a.clientes_com_venda, 0)
  assert.equal(b.consultores[0].clientes_com_venda, 0)
  assert.equal(c.resumo.clientes_com_venda, 0)
})
