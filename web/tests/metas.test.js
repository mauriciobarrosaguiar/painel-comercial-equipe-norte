import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequestPost } from '../functions/api/admin/bases-v2.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-administrativa-teste'

async function importGoals(database, value) {
  const response = await onRequestPost({
    request: new Request('https://painel.local/api/admin/bases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({
        tipo: 'metas',
        nome_arquivo: 'metas.xlsx',
        ano_mes: '2026-07',
        rows: [{ consultor: 'Ana', ol_sem_combate: value, ol_prioritarios: 20, ol_lancamentos: 10, clientes_positivados: 5 }],
      }),
    }),
    env: { DB: database, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
}

test('reimportação de metas preserva a versão anterior', async () => {
  const database = testDatabase()
  await importGoals(database, 100)
  await importGoals(database, 150)

  const current = await database.prepare("SELECT ol_sem_combate FROM metas WHERE escopo='consultor'").all()
  const history = await database.prepare("SELECT ol_sem_combate FROM metas_historico WHERE escopo='consultor'").all()
  const imports = await database.prepare("SELECT COUNT(*) total FROM importacoes WHERE tipo='METAS_COMERCIAIS'").all()

  assert.equal(current.results[0].ol_sem_combate, 150)
  assert.equal(history.results.length, 1)
  assert.equal(history.results[0].ol_sem_combate, 100)
  assert.equal(imports.results[0].total, 2)
})
