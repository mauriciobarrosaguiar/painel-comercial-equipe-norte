import test from 'node:test'
import assert from 'node:assert/strict'
import { createTursoD1 } from '../functions/_lib/turso-d1.js'
import { onRequestPost as login } from '../functions/api/auth/login.js'
import { onRequestGet as session } from '../functions/api/auth/session.js'
import { createSessionToken } from '../functions/_lib/credentials.js'
import { testDatabase } from './d1-fixture.js'

const env = { TURSO_DATABASE_URL: 'https://database.invalid', TURSO_AUTH_TOKEN: 'test-only' }
const key = 'chave-de-sessao-apenas-teste'
const transient = () => Object.assign(new Error('Turso HTTP 502: {}'), { tursoTransient: true })
const ok = () => Response.json({ results: [{ type: 'ok', response: { type: 'execute', result: { cols: [{ name: 'ok' }], rows: [[{ type: 'integer', value: '1' }]] } } }] })

test('consulta se recupera de 502 e de falha de rede sem alterar seus argumentos', async t => {
  for (const network of [false, true]) {
    let calls = 0
    const bodies = []
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      bodies.push(options.body)
      if (++calls === 1) {
        if (network) throw new TypeError('fetch failed')
        return new Response('Bad gateway', { status: 502 })
      }
      return ok()
    })
    assert.equal(await createTursoD1(env).prepare('SELECT ? AS ok').bind(1).first('ok'), 1)
    assert.equal(calls, 2)
    assert.equal(bodies[0], bodies[1])
    t.mock.restoreAll()
  }
})

test('escritas e erros de credencial não são repetidos automaticamente', async t => {
  for (const [sql, status] of [['INSERT INTO teste VALUES (1)', 503], ['SELECT 1', 401]]) {
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}, { status }) })
    await assert.rejects(createTursoD1(env).prepare(sql).run(), new RegExp(`HTTP ${status}`))
    assert.equal(calls, 1)
    t.mock.restoreAll()
  }
})

test('batch com escrita não repete após resposta ambígua', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}, { status: 502 }) })
  const db = createTursoD1(env)
  await assert.rejects(db.batch([db.prepare('UPDATE teste SET total=total+1')]), /HTTP 502/)
  assert.equal(calls, 1)
})

test('login repete imposição de escopo pessoal e só emite sessão após sucesso', async () => {
  const original = testDatabase()
  let calls = 0
  const DB = { prepare: sql => original.prepare(sql), batch: statements => {
    if (++calls === 1) throw transient()
    return original.batch(statements)
  } }
  const response = await login({ request: new Request('https://painel.local/api/auth/login', {
    method: 'POST', body: JSON.stringify({ login: 'm0043497' }),
  }), env: { DB, PAINEL_ADMIN_KEY: key } })
  assert.equal(response.status, 200)
  assert.equal(calls, 2)
  assert.match(response.headers.get('set-cookie'), /painel_session=/)
})

test('indisponibilidade persistente tem limite e não cria nem apaga sessão', async () => {
  let calls = 0
  const DB = { prepare: () => ({ bind() { return this } }), batch: () => { calls++; throw transient() } }
  const settings = { DB, PAINEL_ADMIN_KEY: key }
  const response = await login({ request: new Request('https://painel.local/api/auth/login', {
    method: 'POST', body: JSON.stringify({ login: 'm0043497' }),
  }), env: settings })
  assert.equal(response.status, 503)
  assert.equal(calls, 3)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('retry-after'), '5')
  assert.doesNotMatch(JSON.stringify(await response.json()), /HTTP 502/)
  const token = await createSessionToken({ login: 'm0043497' }, key)
  calls = 0
  const checked = await session({ request: new Request('https://painel.local/api/auth/session', {
    headers: { cookie: `painel_session=${token}` },
  }), env: settings })
  assert.equal(checked.status, 503)
  assert.equal(calls, 3)
  assert.equal(checked.headers.get('set-cookie'), null)
})
