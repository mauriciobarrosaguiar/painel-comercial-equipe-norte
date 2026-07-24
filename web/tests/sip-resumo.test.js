import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { onRequestGet as detalheSip } from '../functions/api/sips/detalhe.js'
import { onRequestGet as exportarResumo } from '../functions/api/sips/resumo-exportar.js'
import { testDatabase } from './d1-fixture.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('resumo SIP calcula cobertura e GAPs de 80%, 90% e 100%', async () => {
  const response = await detalheSip({
    request: new Request('https://painel.local/api/sips/detalhe?id=sip1&inicio=2026-07-01&fim=2026-07-31'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  const farmaciaA = body.clientes.find((item) => item.cnpj === '11111111000111')

  assert.equal(farmaciaA.objetivo, 400)
  assert.equal(farmaciaA.ol_sem_combate, 150)
  assert.equal(farmaciaA.cobertura, 37.5)
  assert.equal(farmaciaA.gap_80, -170)
  assert.equal(farmaciaA.gap_90, -210)
  assert.equal(farmaciaA.gap_100, -250)
  assert.equal(body.resumo_sip.objetivo, 1000)
  assert.equal(body.resumo_sip.realizado, 150)
  assert.equal(body.resumo_sip.cobertura, 15)
  assert.equal(body.resumo_sip.gap_80, -650)
  assert.match(body.link_resumo_excel, /formato=xls/)
  assert.match(body.link_resumo_pdf, /formato=pdf/)
})

test('resumo SIP baixa planilha colorida em formato Excel', async () => {
  const response = await exportarResumo({
    request: new Request('https://painel.local/api/sips/resumo-exportar?id=sip1&inicio=2026-07-01&fim=2026-07-31&publico=1&formato=xls'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /application\/vnd\.ms-excel/)
  assert.match(response.headers.get('content-disposition') || '', /resumo-sip-sip-teste-2026-07\.xls/)
  const body = await response.text()
  assert.match(body, /RESUMO SIP/)
  assert.match(body, /OBJETIVO PREÇO LÍQUIDO/)
  assert.match(body, /GAP 80%/)
  assert.match(body, /GAP 90%/)
  assert.match(body, /GAP 100%/)
  assert.match(body, /TOTAL DISTRITAL/)
  assert.match(body, /-R\$ 170,00/)
})

test('resumo SIP gera PDF paisagem para download', async () => {
  const response = await exportarResumo({
    request: new Request('https://painel.local/api/sips/resumo-exportar?id=sip1&inicio=2026-07-01&fim=2026-07-31&publico=1&formato=pdf'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.match(response.headers.get('content-disposition') || '', /resumo-sip-sip-teste-2026-07\.pdf/)
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.equal(new TextDecoder().decode(bytes.slice(0, 8)), '%PDF-1.4')
  assert.ok(bytes.length > 1000)
})

test('tela da SIP mostra tabela, edição de objetivos e downloads', () => {
  const view = read('src/SipDetailView.tsx')
  const styles = read('src/sip-summary.css')
  const migration = read('migrations/10013_resumo_sip_objetivos.sql')
  const endpoint = read('functions/api/sips/objetivos.js')

  for (const label of ['OBJETIVO', 'REALIZADO', 'COBERTURA', 'GAP 80%', 'GAP 90%', 'GAP 100%', 'TOTAL DISTRITAL']) {
    assert.match(view, new RegExp(label))
  }
  assert.match(view, /Editar objetivos/)
  assert.match(view, /Salvar objetivos/)
  assert.match(view, /Baixar Excel/)
  assert.match(view, /Baixar PDF/)
  assert.match(styles, /sip-coverage-low/)
  assert.match(styles, /sip-goal-total/)
  assert.match(migration, /objetivo_preco_liquido/)
  assert.match(endpoint, /UPDATE sip_clientes/)
  assert.match(endpoint, /UPDATE sips SET meta_mes/)
})
