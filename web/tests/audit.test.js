import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequestGet, onRequestPost } from '../functions/api/admin/auditoria.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-administrativa-teste'

test('auditoria concilia o OL e registra os sinais encontrados', async () => {
  const database = testDatabase()
  const response = await onRequestPost({
    request: new Request('https://painel.local/api/admin/auditoria', {
      method: 'POST',
      headers: { 'x-admin-key': ADMIN_KEY },
    }),
    env: { DB: database, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.equal(body.conciliacao.ol_total, 200)
  assert.equal(body.conciliacao.ol_sem_combate, 150)
  assert.equal(body.conciliacao.ol_combate, 40)
  assert.equal(body.conciliacao.ol_sem_classificacao, 10)
  assert.equal(body.conciliacao.diferenca, 0)
  assert.equal(body.vinculos.itens_sem_classificacao, 1)
  assert.equal(body.qualidade.status_faturado_excluido, 0)
  assert.equal(body.status, 'atencao')

  const historyResponse = await onRequestGet({
    request: new Request('https://painel.local/api/admin/auditoria', {
      headers: { 'x-admin-key': ADMIN_KEY },
    }),
    env: { DB: database, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  assert.equal(historyResponse.status, 200)
  const history = await historyResponse.json()
  assert.equal(history.auditorias.length, 1)
  assert.equal(history.auditorias[0].resultado.conciliacao.ol_total, 200)
})

test('auditoria rejeita chave administrativa inválida', async () => {
  const response = await onRequestPost({
    request: new Request('https://painel.local/api/admin/auditoria', {
      method: 'POST',
      headers: { 'x-admin-key': 'chave-incorreta' },
    }),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  assert.equal(response.status, 401)
})
