import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { onRequestPost as excluirSip } from '../functions/api/sips/excluir.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-teste-segura-123'
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('exclusão de SIP exige autenticação administrativa', async () => {
  const response = await excluirSip({
    request: new Request('https://painel.local/api/sips/excluir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sip_id: 'sip1' }),
    }),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })

  assert.equal(response.status, 401)
})

test('exclusão desativa a SIP, seus vínculos e o link público', async () => {
  const DB = testDatabase()
  const response = await excluirSip({
    request: new Request('https://painel.local/api/sips/excluir', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({ sip_id: 'sip1' }),
    }),
    env: { DB, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.sucesso, true)
  assert.equal(body.sip_id, 'sip1')

  const sip = await DB.prepare('SELECT ativo,acesso_publico_ativo FROM sips WHERE id=?').bind('sip1').first()
  const clientes = await DB.prepare('SELECT COUNT(*) total FROM sip_clientes WHERE sip_id=? AND ativo=1').bind('sip1').first()
  const redes = await DB.prepare('SELECT COUNT(*) total FROM sip_redes WHERE sip_id=? AND ativo=1').bind('sip1').first()

  assert.equal(Number(sip.ativo), 0)
  assert.equal(Number(sip.acesso_publico_ativo), 0)
  assert.equal(Number(clientes.total), 0)
  assert.equal(Number(redes.total), 0)
})

test('tela mostra botão Excluir SIP em cada cartão com confirmação', () => {
  const module = read('src/SipsModule.tsx')
  const styles = read('src/sips.css')
  const endpoint = read('functions/api/sips/excluir.js')

  assert.match(module, /Excluir SIP/)
  assert.match(module, /window\.confirm/)
  assert.match(module, /\/api\/sips\/excluir/)
  assert.match(module, /deletingSipId/)
  assert.match(styles, /sip-delete-button/)
  assert.match(endpoint, /UPDATE sips SET ativo=0/)
  assert.match(endpoint, /acesso_publico_ativo=0/)
  assert.match(endpoint, /UPDATE sip_clientes SET ativo=0/)
  assert.match(endpoint, /UPDATE sip_redes SET ativo=0/)
})
