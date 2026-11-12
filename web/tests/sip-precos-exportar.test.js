import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequestGet as detalhe } from '../functions/api/sips/detalhe.js'
import { onRequestGet as precos } from '../functions/api/sips/precos-exportar.js'
import { testDatabase } from './d1-fixture.js'

const KEY = 'chave-administrativa-teste'
const url = 'https://painel.local/api/sips/precos-exportar?publico=1&sip_id=sip1'

test('SIP exporta apenas UFs de clientes vinculados, sem revelar CNPJ de referência', async () => {
  const DB = testDatabase()
  await DB.prepare(
    "INSERT INTO clientes(id,cnpj,nome_fantasia,cidade,uf,ativo,carteira_importada) VALUES('cl-to','33333333000133','Farmácia TO','Palmas','TO',1,1)"
  ).run()
  await DB.prepare(
    "INSERT INTO sip_clientes(sip_id,cnpj,cliente_id,ativo) VALUES('sip1','33333333000133','cl-to',1)"
  ).run()
  await DB.prepare(
    "INSERT INTO mercado_farma_precos VALUES('mf-to','TO','99999999000199','linha','5555555555555','Produto Tocantins','Distribuidora TO',10,5,12,15,11,10,'OK','','2026-11-12T12:00:00Z')"
  ).run()
  await DB.prepare(
    "INSERT INTO mercado_farma_precos VALUES('mf-mt','MT','88888888000188','linha','6666666666666','Produto Mato Grosso','Distribuidora MT',10,5,12,15,11,10,'OK','','2026-11-12T11:00:00Z')"
  ).run()
  await DB.prepare("UPDATE mercado_farma_precos SET cnpj_referencia='77777777000177' WHERE id='mf1'").run()
  const env = { DB, PAINEL_ADMIN_KEY: KEY }

  const ficha = await detalhe({
    request: new Request('https://painel.local/api/sips/detalhe?publico=1&id=sip1'),
    env,
  })
  assert.equal(ficha.status, 200)
  const body = await ficha.json()
  assert.deepEqual(body.precos.ufs, ['PA', 'TO'])
  assert.equal(body.precos.registros, 3)
  assert.deepEqual(body.precos.por_uf.map((item) => item.uf), ['PA', 'TO'])
  assert.equal(body.precos.atualizado_em, '2026-11-12T12:00:00Z')
  assert.match(body.link_precos, /precos-exportar/)

  // Tentar forçar outra UF pela URL deve ser ignorado.
  const resposta = await precos({
    request: new Request(url + '&uf=MT'),
    env,
  })
  assert.equal(resposta.status, 200)
  assert.match(resposta.headers.get('content-type'), /spreadsheetml.sheet/)
  const arquivo = new TextDecoder().decode(new Uint8Array(await resposta.arrayBuffer()))
  assert.ok(arquivo.includes('Produto Tocantins'))
  assert.ok(arquivo.includes('Distribuidora A'))
  assert.ok(!arquivo.includes('Produto Mato Grosso'))
  assert.ok(!arquivo.includes('88888888000188'))
  assert.ok(!arquivo.includes('99999999000199'))
  assert.ok(!arquivo.includes('77777777000177'))
  assert.ok(!arquivo.includes('CNPJ REFERÊNCIA'))
  assert.ok(!arquivo.includes('cnpj_referencia'))
  assert.ok(arquivo.includes('PREÇO FINAL (R$)'))
})

test('SIP pública desativada não permite download e SIP inválida é recusada', async () => {
  const DB = testDatabase()
  await DB.prepare("UPDATE sips SET acesso_publico_ativo=0 WHERE id='sip1'").run()
  const env = { DB, PAINEL_ADMIN_KEY: KEY }
  const desativado = await precos({ request: new Request(url), env })
  assert.equal(desativado.status, 403)
  const invalido = await precos({
    request: new Request('https://painel.local/api/sips/precos-exportar?publico=1&sip_id=nao-existe'), env,
  })
  assert.equal(invalido.status, 404)
  const naoAutenticado = await precos({
    request: new Request('https://painel.local/api/sips/precos-exportar?sip_id=sip1'), env,
  })
  assert.equal(naoAutenticado.status, 401)
  const admin = await precos({
    request: new Request('https://painel.local/api/sips/precos-exportar?sip_id=sip1', {
      headers: { 'x-admin-key': KEY },
    }),
    env,
  })
  assert.equal(admin.status, 200)
})

test('SIP sem vínculos válidos não exporta outras UFs', async () => {
  const DB = testDatabase()
  await DB.prepare("UPDATE sip_clientes SET ativo=0 WHERE sip_id='sip1'").run()
  const response = await precos({
    request: new Request(url),
    env: { DB, PAINEL_ADMIN_KEY: KEY },
  })
  assert.equal(response.status, 404)
})
