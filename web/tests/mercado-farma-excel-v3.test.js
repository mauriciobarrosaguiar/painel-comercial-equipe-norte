import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequestGet as exportExcel } from '../functions/api/mercado-farma-excel-v3.js'
import { onRequestGet as mercadoFarma } from '../functions/api/mercado-farma-v2.js'
import { testDatabase } from './d1-fixture.js'

const KEY = 'chave-teste-segura-123'

test('Excel do Mercado Farma gera XML válido, percentual numérico e colunas da base', async () => {
  const response = await exportExcel({
    request: new Request('https://painel.local/api/mercado-farma-excel?uf=PA', { headers: { 'x-admin-key': KEY } }),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: KEY },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04])
  const archive = new TextDecoder().decode(bytes)
  for (const expected of ['NOME DO PRODUTO', 'DESCONTO (%)', 'PF DIST. (R$)', 'PREÇO FINAL (R$)', 'SEM IMPOSTO (R$)', '0.00%']) {
    assert.ok(archive.includes(expected), expected)
  }
  const filter = archive.indexOf('<autoFilter ref="A3:K')
  const merges = archive.indexOf('<mergeCells count="1">')
  assert.ok(filter > 0 && merges > filter, 'autoFilter deve vir antes de mergeCells no XML da planilha')
})

test('API mantém desconto extraído e calcula contingência quando a base antiga está zerada', async () => {
  const response = await mercadoFarma({
    request: new Request('https://painel.local/api/mercado-farma?uf=PA&limite=5000'),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: KEY },
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  const saved = body.resultados.find(item => item.distribuidora === 'Distribuidora A')
  const fallback = body.resultados.find(item => item.distribuidora === 'Distribuidora B')
  assert.equal(saved.desconto, 5)
  assert.ok(Math.abs(fallback.desconto - (1 - 12 / 13)) < 0.000001)
  assert.equal(saved.pf_distribuidora, 12)
  assert.equal(saved.preco_com_imposto, 11)
  assert.equal(saved.preco_sem_imposto, 10)
})
