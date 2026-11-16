import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequestGet } from '../functions/api/clientes/ofertas.js'
import { createSessionToken } from '../functions/_lib/credentials.js'
import { personalDatabase, MAURICIO_TEST_ID } from './d1-fixture.js'

const key = 'chave-apenas-para-testar-ofertas'
async function setup() {
  const DB = await personalDatabase()
  const token = await createSessionToken({ login: 'test', consultor_id: MAURICIO_TEST_ID }, key)
  return {
    DB,
    get: (query, authenticated = true) => onRequestGet({
      request: new Request(`https://painel.local/api/clientes/ofertas?${query}`, {
        headers: authenticated ? { cookie: `painel_session=${token}` } : {},
      }), env: { DB, PAINEL_ADMIN_KEY: key },
    }),
  }
}

test('ofertas usam UF do cadastro, estoque positivo e preço com imposto do carrinho', async () => {
  const { DB, get } = await setup()
  await DB.prepare("INSERT INTO mercado_farma_precos VALUES ('fora-uf','TO','','linha','111','Linha','Outra UF',100,0,0,0,1,1,'OK','','2026-11-16')").run()
  const response = await get('id=cl1&eans=111&uf=TO')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.cliente.uf, 'PA')
  assert.equal(body.ofertas.length, 1)
  assert.equal(body.ofertas[0].uf, 'PA')
  assert.equal(body.ofertas[0].distribuidora, 'Distribuidora A')
  assert.equal(body.ofertas[0].preco, 11)
  assert.equal(body.ofertas[0].estoque, 10)
})

test('sem sessão ou fora da carteira não retorna preços; UF ausente não usa outra UF', async () => {
  const { DB, get } = await setup()
  assert.equal((await get('id=cl1&eans=111', false)).status, 401)
  await DB.prepare("UPDATE clientes SET consultor_id='outro' WHERE id='cl2'").run()
  assert.equal((await get('id=cl2&eans=111')).status, 404)
  await DB.prepare("UPDATE clientes SET uf='' WHERE id='cl1'").run()
  assert.equal((await get('id=cl1&eans=111&uf=PA')).status, 422)
})

test('não inclui produto inativo, sem preço ou extração com erro', async () => {
  const { DB, get } = await setup()
  await DB.prepare("UPDATE mercado_farma_precos SET status='ERRO' WHERE id='mf1'").run()
  assert.deepEqual((await (await get('id=cl1&eans=111')).json()).ofertas, [])
  await DB.prepare("UPDATE mercado_farma_precos SET status='OK',preco_com_imposto=0,preco_sem_imposto=0 WHERE id='mf1'").run()
  assert.deepEqual((await (await get('id=cl1&eans=111')).json()).ofertas, [])
  await DB.prepare("UPDATE mercado_farma_precos SET preco_sem_imposto=9 WHERE id='mf1'").run()
  assert.equal((await (await get('id=cl1&eans=111')).json()).ofertas[0].preco, 9)
  await DB.prepare("UPDATE produtos SET ativo=0 WHERE ean='111'").run()
  assert.deepEqual((await (await get('id=cl1&eans=111')).json()).ofertas, [])
  assert.equal((await get('id=cl1&eans=111%27')).status, 400)
})
