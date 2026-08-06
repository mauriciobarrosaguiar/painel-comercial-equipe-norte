import test from 'node:test'
import assert from 'node:assert/strict'
import { allocateCnpj, inferUf, sortOffers } from '../functions/_lib/order-separator.js'

const rules = [
  { distribuidora: 'Total - TO', utilizar: true, prioridade: 1, pedido_minimo: 300 },
  { distribuidora: 'Panpharma - GO', utilizar: true, prioridade: 2, pedido_minimo: 0 },
  { distribuidora: 'Nazaria - Imperatriz', utilizar: true, prioridade: 3, pedido_minimo: 200 },
]

test('identifica UF no texto da unidade', () => {
  assert.equal(inferUf('Imperatriz - TO'), 'TO')
  assert.equal(inferUf('Confresa - MT- M'), 'MT')
})

test('prioridade prevalece sobre menor preço', () => {
  const offers = [
    { distribuidora: 'Panpharma - GO', estoque: 100, preco: 8 },
    { distribuidora: 'Total - TO', estoque: 100, preco: 10 },
  ]
  assert.equal(sortOffers(offers, rules, 'prioridade')[0].distribuidora, 'Total - TO')
  assert.equal(sortOffers(offers, rules, 'melhor_preco')[0].distribuidora, 'Panpharma - GO')
})

test('marca sem estoque quando nenhuma distribuidora atende a quantidade', () => {
  const items = [{ index: 0, quantidade: 20, eanExiste: true, status: '', offers: [
    { distribuidora: 'Total - TO', estoque: 10, preco: 10 },
    { distribuidora: 'Panpharma - GO', estoque: 15, preco: 8 },
  ] }]
  const result = allocateCnpj(items, { modo: 'prioridade', distribuidoras: rules })
  assert.equal(result.items[0].status, 'SEM ESTOQUE')
  assert.equal(result.items[0].offer, null)
})

test('remove distribuidora que não alcança o pedido mínimo', () => {
  const items = [{ index: 0, quantidade: 10, eanExiste: true, status: '', offers: [
    { distribuidora: 'Total - TO', estoque: 100, preco: 20 },
    { distribuidora: 'Panpharma - GO', estoque: 100, preco: 21 },
  ] }]
  const result = allocateCnpj(items, { modo: 'prioridade', distribuidoras: rules })
  assert.equal(result.items[0].offer.distribuidora, 'Panpharma - GO')
  assert.equal(result.items[0].status, 'DISTRIBUÍDO')
})
