import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequestPost } from '../functions/api/auth/login.js'
import { testDatabase } from './d1-fixture.js'

test('código EMS fora da lista autorizada é recusado', async () => {
  const response = await onRequestPost({
    request: new Request('https://x/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'm0099999@ems.com.br' }),
    }),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: 'chave-administrativa-teste' },
  })
  assert.equal(response.status, 401)
})
