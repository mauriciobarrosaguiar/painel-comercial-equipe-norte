import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { onRequestGet as listarSips } from '../functions/api/sips.js'
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

test('página principal recebe todas as SIPs com seus clientes e GAPs', async () => {
  const response = await listarSips({
    request: new Request('https://painel.local/api/sips?periodo=personalizado&inicio=2026-07-01&fim=2026-07-31'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.equal(body.resumos_sip.length, body.sips.length)
  assert.equal(body.resumos_sip[0].sip.id, 'sip1')
  assert.equal(body.resumos_sip[0].clientes.length, 2)
  assert.equal(body.resumos_sip[0].resumo_sip.objetivo, 1000)
  assert.equal(body.resumos_sip[0].resumo_sip.realizado, 150)
  assert.equal(body.resumos_sip[0].resumo_sip.gap_100, -850)
  assert.match(body.resumos_sip[0].link_resumo_excel, /resumo-exportar/)
  assert.match(body.resumos_sip[0].link_resumo_pdf, /formato=pdf/)
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

test('resumos ficam abaixo da lista principal e não dentro da SIP individual', () => {
  const page = read('src/SipsModule.tsx')
  const report = read('src/SipSummaryReport.tsx')
  const detail = read('src/SipDetailView.tsx')
  const styles = read('src/sip-summary.css')
  const migration = read('migrations/10013_resumo_sip_objetivos.sql')
  const endpoint = read('functions/api/sips/objetivos.js')

  assert.match(page, /sip-all-summaries/)
  assert.match(page, /data\?\.resumos_sip\.map/)
  assert.match(page, /Resumo de todas as SIPs/)
  assert.doesNotMatch(detail, /sip-goal-report/)
  assert.doesNotMatch(detail, /RESUMO SIP/)
  for (const label of ['OBJETIVO', 'REALIZADO', 'COBERTURA', 'GAP 80%', 'GAP 90%', 'GAP 100%', 'TOTAL DISTRITAL']) {
    assert.match(report, new RegExp(label))
  }
  assert.match(report, /Editar objetivos/)
  assert.match(report, /Salvar objetivos/)
  assert.match(report, /Baixar Excel/)
  assert.match(report, /Baixar PDF/)
  assert.match(styles, /sip-all-summaries/)
  assert.match(styles, /sip-coverage-low/)
  assert.match(styles, /sip-goal-total/)
  assert.match(migration, /objetivo_preco_liquido/)
  assert.match(endpoint, /UPDATE sip_clientes/)
  assert.match(endpoint, /UPDATE sips SET meta_mes/)
})
