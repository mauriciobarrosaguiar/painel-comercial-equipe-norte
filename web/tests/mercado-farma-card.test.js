import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('cards do Mercado Farma exibem os campos do buybox original', () => {
  const source = read('src/MarketFarmaModule.new.tsx')
  for (const expected of ['mef-discount', 'PF Dist.:', 'Sem imposto:', 'Distribuidor selecionado', 'mef-quantity', 'mef-cart-total']) {
    assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('API entrega preços e desconto como números', () => {
  const source = read('functions/api/mercado-farma.js')
  for (const expected of ['desconto: number(item.desconto)', 'pf_distribuidora: number(item.pf_distribuidora)', 'pf_fabrica: number(item.pf_fabrica)']) {
    assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})
