import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('PPT mantém Consultores e SIP em uma página consolidada', () => {
  const source = read('functions/api/apresentacao-painel-v3.js')
  assert.match(source, /function consultantSlide\(/)
  assert.match(source, /function sipSlide\(/)
  assert.doesNotMatch(source, /consultantSemCombatSlides/)
  assert.doesNotMatch(source, /sipMixSlides/)
  for (const field of ['META SC','REAL SC','% SC','META P','REAL P','% P','META L','REAL L','% L','PRIORITÁRIOS','LANÇAMENTOS','GAP 100%','GAP 90%','GAP 80%']) {
    assert.match(source, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('Foco no PPT é exibido por consultor e quebra somente quando necessário', () => {
  const source = read('functions/api/apresentacao-painel-v3.js')
  assert.match(source, /chunks\(section\.products, 3\)/)
  assert.match(source, /chunks\(section\.consultants, 8\)/)
  assert.match(source, /META DO PRODUTO/)
  assert.match(source, /QTDE FATURADA/)
  assert.match(source, /% ATINGIMENTO/)
  assert.match(source, /EM ANDAMENTO/)
  assert.match(source, /ENCERRADO/)
})

test('página do Foco mantém download e Mercado Farma não mostra continuar comprando', () => {
  const focus = read('src/FocusModule.tsx')
  const history = read('src/FocusHistory.tsx')
  const market = read('src/MarketFarmaModule.v2.tsx')
  assert.match(focus, /Baixar planilha da missão/)
  assert.match(history, /Baixar planilha/)
  assert.doesNotMatch(market, /Continuar comprando/i)
})
