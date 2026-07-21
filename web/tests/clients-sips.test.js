import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequestGet as clientes } from '../functions/api/clientes.js'
import { onRequestGet as sips } from '../functions/api/sips.js'
import { testDatabase } from './d1-fixture.js'

test('clientes calcula faturamento e prioridades pela carteira oficial', async () => {
  const response = await clientes({
    request: new Request('https://painel.local/api/clientes?periodo=todo-periodo&limite=100'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.resumo.clientes_ativos, 2)
  assert.equal(body.resumo.clientes_com_venda, 1)
  assert.equal(body.resumo.faturamento_total, 200)
  const clienteA = body.clientes.find((item) => item.id === 'cl1')
  const clienteB = body.clientes.find((item) => item.id === 'cl2')
  assert.equal(clienteA.faturamento_atual, 200)
  assert.equal(clienteA.produtos_prioritarios, 1)
  assert.equal(clienteB.prioridade, 'NOVO')
})

test('SIP consolida clientes e faturamento sem duplicar itens inativos', async () => {
  const response = await sips({
    request: new Request('https://painel.local/api/sips?periodo=todo-periodo'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.sips.length, 1)
  assert.equal(body.sips[0].clientes_ativos, 2)
  assert.equal(body.sips[0].clientes_com_venda, 1)
  assert.equal(body.sips[0].ol_total, 200)
  assert.equal(body.sips[0].ol_sem_combate, 150)
})
