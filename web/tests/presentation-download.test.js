import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { onRequestGet as exportImages } from '../functions/api/apresentacao-painel.js'
import { onRequestGet as imageManifest } from '../functions/api/relatorio-imagens.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-teste-segura-123'
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('relatório em imagens exige sessão ou chave administrativa', async () => {
  const response = await exportImages({
    request: new Request('https://painel.local/api/apresentacao-painel'),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  assert.equal(response.status, 401)
})

test('download gera ZIP com imagens SVG nítidas de Consultores, SIP e Foco Semanal', async () => {
  const response = await exportImages({
    request: new Request(
      'https://painel.local/api/apresentacao-painel?periodo=personalizado&inicio=2026-07-01&fim=2026-07-31',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    ),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/zip')
  assert.match(response.headers.get('content-disposition') || '', /relatorios-painel-2026-07-imagens\.zip/)

  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04])
  const archiveText = new TextDecoder().decode(bytes)
  for (const content of [
    '01-consultores.svg',
    '02-sips.svg',
    '<svg',
    'Consultores',
    'META SC',
    'REAL P',
    'REAL L',
    'SIP / Redes',
    'GAP 100%',
    'GAP 90%',
    'GAP 80%',
    'Foco Semanal',
    'SIP Teste',
  ]) assert.ok(archiveText.includes(content), `Conteúdo ausente no pacote de imagens: ${content}`)
})

test('manifesto visual usa resolução alta e quebra foco somente quando necessário', async () => {
  const response = await imageManifest({
    request: new Request(
      'https://painel.local/api/relatorio-imagens?periodo=personalizado&inicio=2026-07-01&fim=2026-07-31',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    ),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.ok(payload.pages.length >= 3)
  assert.ok(payload.pages.every(page => page.width === 2400 && page.height === 1350))
  assert.ok(payload.pages.some(page => page.name.startsWith('01-consultores')))
  assert.ok(payload.pages.some(page => page.name.startsWith('02-sips')))
  assert.ok(payload.pages.some(page => page.name.includes('foco-')))
})

test('página principal mostra Baixar imagens mantendo os filtros atuais', () => {
  const app = read('src/App.tsx')
  const styles = read('src/dashboard.css')
  const endpoint = read('functions/api/relatorio-imagens.js')

  assert.match(app, /\/api\/apresentacao-painel/)
  assert.match(app, /presentationQuery/)
  assert.match(styles, /content:'Baixar imagens'/)
  assert.match(styles, /dashboard-ppt-button/)
  assert.match(endpoint, /2400/)
  assert.match(endpoint, /GAP 90%/)
  assert.match(endpoint, /meta_ol_prioritarios/)
  assert.match(endpoint, /Foco Semanal/)
})

// Mantém a validação da exportação visual ativa no pipeline completo.
