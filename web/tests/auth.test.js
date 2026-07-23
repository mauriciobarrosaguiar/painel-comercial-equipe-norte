import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequestPost as login } from '../functions/api/auth/login.js'
import { onRequestGet as session } from '../functions/api/auth/session.js'
import { onRequestPost as logout } from '../functions/api/auth/logout.js'
import { testDatabase } from './d1-fixture.js'

const key = 'chave-administrativa-teste'
const acessos = [
  ['a0002958', 'ALESSANDRA FREITAS SA'],
  ['d0047303', 'DENYSE CRISTINA VIANA VELOSO ARAUJO'],
  ['j0050526', 'JOAO DIEGO FERREIRA DE OLIVEIRA'],
  ['r0041868', 'RAIMUNDA MARTINS GOMES CARNEIRO'],
  ['m0043497', 'MAURICIO BARROS DE AGUIAR'],
  ['f0059410', 'FRANCISCO CORTEZ FILHO'],
]

async function entrar(acesso, DB = testDatabase()) {
  return login({
    request: new Request('https://painel.local/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: acesso }),
    }),
    env: { DB, PAINEL_ADMIN_KEY: key },
  })
}

test('os seis colaboradores entram com código ou e-mail EMS', async () => {
  for (const [codigo, nome] of acessos) {
    for (const acesso of [codigo, `${codigo}@ems.com.br`]) {
      const response = await entrar(acesso)
      assert.equal(response.status, 200, acesso)
      const body = await response.json()
      assert.equal(body.usuario.login, codigo)
      assert.equal(body.usuario.email, `${codigo}@ems.com.br`)
      assert.equal(body.usuario.nome, nome)
      assert.match(response.headers.get('set-cookie') || '', /painel_session=/)
    }
  }
})

test('código não autorizado é recusado', async () => {
  const response = await entrar('x0000000')
  assert.equal(response.status, 401)
})

test('sessão assinada libera o painel', async () => {
  const DB = testDatabase()
  const result = await entrar('m0043497', DB)
  const cookie = (result.headers.get('set-cookie') || '').split(';')[0]
  const response = await session({
    request: new Request('https://painel.local/api/auth/session', { headers: { cookie } }),
    env: { DB, PAINEL_ADMIN_KEY: key },
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).usuario.login, 'm0043497')
})

test('sair encerra a sessão no navegador', async () => {
  const response = await logout()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie') || '', /painel_session=/)
  assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/i)
})
