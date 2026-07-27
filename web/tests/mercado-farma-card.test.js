import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('cards do Mercado Farma exibem buybox, carrinho e busca de cliente', () => {
  const source = read('src/MarketFarmaModule.v2.tsx')
  for (const expected of ['mef-discount', 'PF Dist.:', 'Sem imposto:', 'Distribuidor selecionado', 'mef-quantity', 'mef-cart-total', 'Digite parte do nome do PDV ou CNPJ', 'Ofertas liberadas somente para a UF']) {
    assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('API entrega preços numéricos, desconto da base e aplica a UF do cliente', () => {
  const source = read('functions/api/mercado-farma-v2.js')
  for (const expected of ['desconto: discountFromBase(item)', 'pf_distribuidora: number(item.pf_distribuidora)', 'pf_fabrica: number(item.pf_fabrica)', 'cliente_cnpj', 'effectiveUf', 'uf_aplicada']) {
    assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})
