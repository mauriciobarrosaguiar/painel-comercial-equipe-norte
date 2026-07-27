import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { onRequestGet as imageManifest } from '../functions/api/relatorio-imagens.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-teste-segura-123'
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('manifesto de imagens exige sessão ou chave administrativa', async () => {
  const response = await imageManifest({
    request: new Request('https://painel.local/api/relatorio-imagens'),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  assert.equal(response.status, 401)
})

test('manifesto visual usa resolução alta e contém Consultores, SIP e Foco Semanal', async () => {
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
  assert.ok(payload.pages.every(page => page.name.endsWith('.png')))
  assert.ok(payload.pages.some(page => page.name.startsWith('01-consultores')))
  assert.ok(payload.pages.some(page => page.name.startsWith('02-sips')))
  assert.ok(payload.pages.some(page => page.name.includes('foco-')))
  const source = payload.pages.map(page => page.svg).join('\n')
  for (const content of ['Consultores', 'META SC', 'REAL P', 'REAL L', 'SIP / Redes', 'GAP 100%', 'GAP 90%', 'GAP 80%', 'Foco Semanal', 'SIP Teste']) {
    assert.ok(source.includes(content), `Conteúdo ausente no relatório: ${content}`)
  }
})

test('botão único converte o SVG em PNG real e depois cria o ZIP', () => {
  const app = read('src/App.tsx')
  const button = read('src/DownloadImagesButton.tsx')
  const converter = read('src/download-report-images.ts')
  const styles = read('src/dashboard.css')

  assert.match(app, /DownloadImagesButton/)
  assert.match(app, /query=\{presentationQuery\}/)
  assert.doesNotMatch(app, /href=\{`\/api\/apresentacao-painel/)
  assert.match(button, /Baixar imagens/)
  assert.match(button, /Gerando PNGs/)
  assert.match(converter, /\/api\/relatorio-imagens/)
  assert.match(converter, /canvas\.toBlob/)
  assert.match(converter, /image\/png/)
  assert.match(converter, /name: pngName/)
  assert.match(converter, /application\/zip/)
  assert.match(converter, /-png\.zip/)
  assert.doesNotMatch(converter, /replace\(\/\\\.png\$\/i, '\\.svg'\)/)
  assert.match(styles, /dashboard-ppt-button:disabled/)
})
