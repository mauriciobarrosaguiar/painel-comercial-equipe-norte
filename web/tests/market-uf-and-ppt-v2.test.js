import assert from 'node:assert/strict'
import test from 'node:test'

import { createSessionToken } from '../functions/_lib/credentials.js'
import { onRequestGet as mercadoGet } from '../functions/api/mercado-farma.js'
import { onRequestGet as mercadoExcel } from '../functions/api/mercado-farma-excel.js'
import { testDatabase } from './d1-fixture.js'

const KEY = 'chave-teste-segura-123'
const archiveText = async response => new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()))

test('Mercado Farma mostra somente ofertas que atendem a UF do CNPJ selecionado', async () => {
  const DB = testDatabase()
  await DB.prepare(`INSERT INTO mercado_farma_precos VALUES('mf-to','TO','999','linha','111','Linha','Distribuidora TO',20,5,12,15,11,10,'OK','','2026-07-10T12:00:00Z')`).run()
  const token = await createSessionToken({ login: 'm0043497', nome: 'Ana', consultor_id: 'co1' }, KEY)
  const response = await mercadoGet({
    request: new Request('https://painel.local/api/mercado-farma?cliente_cnpj=11111111000111&limite=5000', { headers: { cookie: `painel_session=${token}` } }),
    env: { DB, PAINEL_ADMIN_KEY: KEY },
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.uf_aplicada, 'PA')
  assert.ok(body.resultados.length > 0)
  assert.ok(body.resultados.every(item => item.uf === 'PA'))
  assert.ok(!body.resultados.some(item => item.distribuidora === 'Distribuidora TO'))
})

test('Excel do Mercado Farma baixa todas as UFs ou somente a UF selecionada', async () => {
  const DB = testDatabase()
  await DB.prepare(`INSERT INTO mercado_farma_precos VALUES('mf-to','TO','999','linha','111','Linha','Distribuidora TO',20,5,12,15,11,10,'OK','','2026-07-10T12:00:00Z')`).run()
  const env = { DB, PAINEL_ADMIN_KEY: KEY }
  const all = await mercadoExcel({ request: new Request('https://painel.local/api/mercado-farma-excel', { headers: { 'x-admin-key': KEY } }), env })
  const allText = await archiveText(all)
  assert.ok(allText.includes('Distribuidora A'))
  assert.ok(allText.includes('Distribuidora TO'))

  const pa = await mercadoExcel({ request: new Request('https://painel.local/api/mercado-farma-excel?uf=PA', { headers: { 'x-admin-key': KEY } }), env })
  const paText = await archiveText(pa)
  assert.ok(paText.includes('Distribuidora A'))
  assert.ok(!paText.includes('Distribuidora TO'))
})

test('PPT V2 declara metas, percentuais, GAPs e focos separados', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../functions/api/apresentacao-painel-v2.js', import.meta.url), 'utf8'))
  for (const expected of ['META SC', 'REAL SC', '% SC', 'META P', 'REAL P', '% P', 'META L', 'REAL L', '% L', 'GAP 100%', 'GAP 90%', 'GAP 80%', 'EM ANDAMENTO', 'ENCERRADO', 'prioritarios', 'lancamentos']) {
    assert.ok(source.includes(expected), expected)
  }
})
