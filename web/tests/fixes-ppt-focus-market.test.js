import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPptx, shape, slideXml } from '../functions/_lib/pptx-compatible.js'
import { repairPptxBytes } from '../functions/_lib/pptx-repair.js'
import { createSessionToken } from '../functions/_lib/credentials.js'
import { onRequestGet as focoGet, onRequestPost as focoPost } from '../functions/api/foco-historico.js'
import { onRequestGet as mercadoGet } from '../functions/api/mercado-farma.js'
import { onRequestPost as pedidoExcel } from '../functions/api/mercado-farma-pedido-excel.js'
import { testDatabase } from './d1-fixture.js'

const KEY = 'chave-teste-segura-123'
const archiveText = bytes => new TextDecoder().decode(bytes)

test('PPTX é reconstruído sobre uma base compatível com PowerPoint móvel', async () => {
  const legacy = buildPptx({
    slides: [slideXml([shape({ id: 2, x: 1, y: 1, w: 8, h: 1, text: 'Consultores · SIP · Foco Semanal' })])],
  })
  const repaired = await repairPptxBytes(legacy)
  assert.deepEqual([...repaired.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04])
  const text = archiveText(repaired)
  for (const expected of ['ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'Office Theme', 'screen16x9', 'Consultores · SIP · Foco Semanal']) {
    assert.ok(text.includes(expected), expected)
  }
})

test('histórico lista foco sem selecionar período e permite excluir', async () => {
  const env = { DB: testDatabase(), PAINEL_ADMIN_KEY: KEY }
  const response = await focoGet({ env })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(body.historicos.some(item => item.produtos.some(produto => produto.foco_id === 'f1')))

  const removed = await focoPost({
    request: new Request('https://painel.local/api/foco-historico', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': KEY },
      body: JSON.stringify({ foco_id: 'f1' }),
    }),
    env,
  })
  assert.equal(removed.status, 200)
  const after = await focoGet({ env })
  const afterBody = await after.json()
  assert.ok(!afterBody.historicos.some(item => item.produtos.some(produto => produto.foco_id === 'f1')))
})

test('Mercado Farma pesquisa por parte do nome e por EAN', async () => {
  const env = { DB: testDatabase(), PAINEL_ADMIN_KEY: KEY }
  const byName = await mercadoGet({ request: new Request('https://painel.local/api/mercado-farma?busca=Linh&limite=5000'), env })
  assert.equal(byName.status, 200)
  const nameBody = await byName.json()
  assert.ok(nameBody.resultados.length > 0)
  assert.ok(nameBody.resultados.every(item => item.produto.toUpperCase().includes('LINH')))

  const byEan = await mercadoGet({ request: new Request('https://painel.local/api/mercado-farma?busca=111&limite=5000'), env })
  const eanBody = await byEan.json()
  assert.ok(eanBody.resultados.some(item => item.ean === '111'))
})

test('pedido do carrinho gera Excel verdadeiro e valida a carteira do consultor', async () => {
  const env = { DB: testDatabase(), PAINEL_ADMIN_KEY: KEY }
  const token = await createSessionToken({ login: 'm0043497', nome: 'Ana', consultor_id: 'co1' }, KEY)
  const response = await pedidoExcel({
    request: new Request('https://painel.local/api/mercado-farma-pedido-excel', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `painel_session=${token}` },
      body: JSON.stringify({
        cliente_cnpj: '11111111000111',
        itens: [{ ean: '111', quantidade: 3, distribuidora: 'Distribuidora A', uf: 'PA' }],
      }),
    }),
    env,
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04])
  const text = archiveText(bytes)
  for (const expected of ['Nome do Cliente:', 'Nome do Consultor:', 'DISTRIBUIDORA ESCOLHIDA', 'TOTAL POR DISTRIBUIDORA', 'Farmácia A']) assert.ok(text.includes(expected))
})
