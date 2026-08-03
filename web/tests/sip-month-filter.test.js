import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/SipsModule.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/sips.css', import.meta.url), 'utf8')

test('SIP administrativa e pública possuem filtro mensal', () => {
  assert.match(source, /type="month"/)
  assert.match(source, /sip-admin-month/)
  assert.match(source, /sip-public-month/)
  assert.match(source, /sip-detail-month/)
  assert.match(source, /Mês analisado/)
  assert.match(source, /max=\{currentMonth\(\)\}/)
})

test('filtro mensal envia intervalo completo para lista e detalhe', () => {
  assert.match(source, /periodo: 'personalizado'/)
  assert.match(source, /inicio: range\.inicio/)
  assert.match(source, /fim: range\.fim/)
  assert.match(source, /api\/sips\?\$\{query\}/)
  assert.match(source, /api\/sips\/detalhe\?\$\{query\}/)
})

test('link público preserva o mês escolhido e layout é responsivo', () => {
  assert.match(source, /url\.searchParams\.set\('mes', selectedMonth\)/)
  assert.match(source, /window\.history\.replaceState/)
  assert.match(css, /\.sip-month-filter/)
  assert.match(css, /@media\(max-width:600px\)/)
  assert.match(css, /\.sip-month-filter\{width:100%/)
})
