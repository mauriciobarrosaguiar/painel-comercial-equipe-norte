import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('botão Baixar PPT fica centralizado e com a mesma altura das demais ações', () => {
  const css = read('src/dashboard.css')
  for (const expected of ['.dashboard-ppt-button', 'display:inline-flex', 'align-items:center', 'justify-content:center', 'min-height:44px', '.hero-actions>.secondary-button']) {
    assert.match(css, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('mantém PPT consolidado, download do foco e carrinho sem botão continuar comprando', () => {
  const ppt = read('functions/api/apresentacao-painel-v3.js')
  const focus = read('src/FocusModule.tsx')
  const history = read('src/FocusHistory.tsx')
  const market = read('src/MarketFarmaModule.v2.tsx')
  assert.match(ppt, /function consultantSlide\(/)
  assert.match(ppt, /function sipSlide\(/)
  assert.match(ppt, /chunks\(section\.products, 3\)/)
  assert.match(ppt, /chunks\(section\.consultants, 8\)/)
  assert.match(focus, /Baixar planilha da missão/)
  assert.match(history, /Baixar planilha/)
  assert.doesNotMatch(market, /Continuar comprando/i)
})
