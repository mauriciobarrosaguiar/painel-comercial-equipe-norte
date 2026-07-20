import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequestGet as dashboard } from '../functions/api/dashboard.js'
import { onRequestGet as consultores } from '../functions/api/consultores.js'
import { testDatabase } from './d1-fixture.js'

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
