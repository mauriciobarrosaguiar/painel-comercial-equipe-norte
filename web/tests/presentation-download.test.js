import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { onRequestGet as exportPresentation } from '../functions/api/apresentacao-painel.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-teste-segura-123'
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('apresentação exige sessão ou chave administrativa', async () => {
  const response = await exportPresentation({
    request: new Request('https://painel.local/api/apresentacao-painel'),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  assert.equal(response.status, 401)
})

test('download gera PPTX verdadeiro com metas, GAPs e focos vigentes/encerrados', async () => {
  const response = await exportPresentation({
    request: new Request(
      'https://painel.local/api/apresentacao-painel?periodo=personalizado&inicio=2026-07-01&fim=2026-07-31',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    ),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  assert.match(response.headers.get('content-disposition') || '', /painel-equipe-norte-2026-07\.pptx/)

  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04])
  assert.ok(bytes.length > 12000)

  const archiveText = new TextDecoder().decode(bytes)
  for (const content of [
    '[Content_Types].xml',
    'ppt/presentation.xml',
    'ppt/slideMasters/slideMaster1.xml',
    'ppt/slideLayouts/slideLayout1.xml',
    'PAINEL COMERCIAL',
    'Consultores — Sem Combate',
    'Consultores — Prioritários e Lançamentos',
    'SIP — Objetivo e GAP',
    'GAP 90%',
    'GAP 80%',
    'SIP — Mix faturado',
    'Foco Semanal — ENCERRADO',
    'SIP Teste',
    'Linha',
  ]) assert.ok(archiveText.includes(content), `Conteúdo ausente no PPTX: ${content}`)
})

test('página principal oferece botão Baixar PPT com os filtros atuais', () => {
  const app = read('src/App.tsx')
  const styles = read('src/dashboard.css')
  const endpoint = read('functions/api/apresentacao-painel-v2.js')
  const pptx = read('functions/_lib/pptx-compatible.js')

  assert.match(app, /Baixar PPT/)
  assert.match(app, /\/api\/apresentacao-painel/)
  assert.match(app, /presentationQuery/)
  assert.match(styles, /dashboard-ppt-button/)
  assert.match(endpoint, /Consultores, SIP e Foco Semanal/)
  assert.match(endpoint, /meta_ol_prioritarios/)
  assert.match(endpoint, /gap90/)
  assert.match(endpoint, /focusData\.ongoing/)
  assert.match(endpoint, /application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/)
  assert.match(pptx, /ppt\/presentation\.xml/)
  assert.match(pptx, /slideMaster1\.xml/)
})
