import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { onRequestGet as listarSips } from '../functions/api/sips.js'
import { onRequestGet as exportarResumoGeral } from '../functions/api/sips/resumo-geral-exportar.js'
import { testDatabase } from './d1-fixture.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const ADMIN_KEY = 'chave-teste-segura-123'

test('resumo consolida todos os CNPJs de cada SIP em uma única linha', async () => {
  const response = await listarSips({
    request: new Request('https://painel.local/api/sips?periodo=personalizado&inicio=2026-07-01&fim=2026-07-31'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  const row = body.resumo_sip.linhas.find((item) => item.id === 'sip1')

  assert.equal(body.resumo_sip.linhas.length, 1)
  assert.equal(row.nome, 'SIP Teste')
  assert.equal(row.cnpjs, 2)
  assert.equal(row.objetivo, 1000)
  assert.equal(row.realizado, 150)
  assert.equal(row.cobertura, 15)
  assert.equal(row.gap_100, -850)
  assert.equal(row.gap_90, -750)
  assert.equal(row.gap_80, -650)
  assert.equal(body.resumo_sip.total.cnpjs, 2)
  assert.equal(body.resumo_sip.total.objetivo, 1000)
  assert.equal(body.resumo_sip.total.realizado, 150)
  assert.match(body.resumo_sip.link_resumo_excel, /resumo-geral-exportar/)
  assert.match(body.resumo_sip.link_resumo_pdf, /formato=pdf/)
})

test('download Excel traz uma linha por SIP e total distrital', async () => {
  const response = await exportarResumoGeral({
    request: new Request(
      'https://painel.local/api/sips/resumo-geral-exportar?inicio=2026-07-01&fim=2026-07-31&formato=xls',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    ),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /application\/vnd\.ms-excel/)
  assert.match(response.headers.get('content-disposition') || '', /resumo-sips-2026-07\.xls/)
  const body = await response.text()

  for (const label of ['RESUMO SIP', 'SIP', 'CNPJs', 'OBJETIVO', 'REALIZADO', 'COBERTURA', 'GAP 100%', 'GAP 90%', 'GAP 80%', 'TOTAL DISTRITAL']) {
    assert.match(body, new RegExp(label))
  }
  assert.match(body, /SIP Teste/)
  assert.match(body, />2<\/td>/)
  assert.match(body, /R\$ 1\.000,00/)
  assert.match(body, /R\$ 150,00/)
  assert.match(body, /-R\$ 850,00/)
})

test('download PDF consolidado é gerado em paisagem', async () => {
  const response = await exportarResumoGeral({
    request: new Request(
      'https://painel.local/api/sips/resumo-geral-exportar?inicio=2026-07-01&fim=2026-07-31&formato=pdf',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    ),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.match(response.headers.get('content-disposition') || '', /resumo-sips-2026-07\.pdf/)
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.equal(new TextDecoder().decode(bytes.slice(0, 8)), '%PDF-1.4')
  assert.ok(bytes.length > 1000)
})

test('página mostra uma única tabela consolidada por SIP', () => {
  const report = read('src/SipSummaryReport.tsx')
  const module = read('src/SipsModule.tsx')
  const styles = read('src/sip-summary.css')
  const endpoint = read('functions/api/sips/objetivos.js')

  for (const label of ['SIP', 'CNPJs', 'OBJETIVO', 'REALIZADO', 'COBERTURA', 'GAP 100%', 'GAP 90%', 'GAP 80%', 'TOTAL DISTRITAL']) {
    assert.match(report, new RegExp(label))
  }
  assert.match(report, /Cada linha soma todos os CNPJs vinculados à SIP/)
  assert.match(module, /<SipSummaryReport data=\{data\.resumo_sip\}/)
  assert.doesNotMatch(module, /resumos_sip\.map/)
  assert.match(styles, /sip-consolidated-table/)
  assert.match(endpoint, /metas_sip/)
  assert.match(endpoint, /UPDATE sips SET meta_mes/)
})
