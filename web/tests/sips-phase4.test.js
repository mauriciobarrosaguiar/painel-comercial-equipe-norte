import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequestGet as detalhe } from '../functions/api/sips/detalhe.js'
import { onRequestPost as cadastro } from '../functions/api/sips/cadastro.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-administrativa-teste'

test('ficha da SIP carrega clientes, notas, pendências e produtos', async () => {
  const response = await detalhe({
    request: new Request('https://painel.local/api/sips/detalhe?id=sip1&inicio=2026-07-01&fim=2026-07-31'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.equal(body.sip.nome, 'SIP Teste')
  assert.equal(body.totais.clientes_ativos, 2)
  assert.equal(body.totais.clientes_com_venda, 1)
  assert.equal(body.totais.ol_total, 200)
  assert.equal(body.totais.notas_faturadas, 1)
  assert.equal(body.totais.notas_canceladas, 1)
  assert.equal(body.totais.notas_a_faturar, 3)
  assert.equal(body.totais.valor_a_faturar, 550)
  assert.equal(body.pendentes_por_consultor.length, 1)
  assert.equal(body.pendentes_por_consultor[0].pedidos_nao_faturados, 3)
  assert.equal(body.pendentes_por_consultor[0].valor_nao_faturado, 550)
  assert.equal(body.produtos.length, 4)
  assert.match(body.link_exportacao, /sip_detalhado/)
})

test('detalhe usa a meta atual da SIP mesmo quando objetivos internos ainda estão no valor anterior', async () => {
  const DB = testDatabase()
  await DB.prepare("UPDATE sips SET meta_mes=1500 WHERE id='sip1'").run()

  const response = await detalhe({
    request: new Request('https://painel.local/api/sips/detalhe?id=sip1&inicio=2026-07-01&fim=2026-07-31'),
    env: { DB },
  })
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.equal(body.sip.meta_mes, 1500)
  assert.equal(body.resumo_sip.objetivo, 1500)
  assert.equal(body.totais.resultado_meta, body.totais.ol_sem_combate / 1500 * 100)
  assert.equal(body.resumo_sip.gap_80, body.totais.ol_sem_combate - 1200)
  assert.equal(body.resumo_sip.gap_90, body.totais.ol_sem_combate - 1350)
  assert.equal(body.resumo_sip.gap_100, body.totais.ol_sem_combate - 1500)
  assert.ok(Math.abs(body.clientes.reduce((total, item) => total + item.objetivo, 0) - 1500) < 0.01)
})

test('cadastro da SIP aceita acesso autenticado e salva registro', async () => {
  const DB = testDatabase()
  const response = await cadastro({
    request: new Request('https://painel.local/api/sips/cadastro', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({ nome: 'SIP Nova', meta_mes: 500, acesso_publico_ativo: true }),
    }),
    env: { DB, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  const saved = await DB.prepare('SELECT nome FROM sips WHERE id=?').bind(body.id).first()
  assert.equal(saved.nome, 'SIP Nova')
})
