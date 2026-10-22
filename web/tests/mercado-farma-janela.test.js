import assert from 'node:assert/strict'
import test from 'node:test'
import { horarioPermitidoMercadoFarma, MENSAGEM_JANELA_MERCADO_FARMA } from '../functions/_lib/mercado-farma-janela.js'

test('bloqueia Mercado Farma das 20h às 7h em Brasília, incluindo os limites', () => {
  const casos = [
    ['2026-10-22T09:59:59Z', false], // 06:59:59 BRT
    ['2026-10-22T10:00:00Z', true],  // 07:00 BRT
    ['2026-10-22T22:59:59Z', true],  // 19:59:59 BRT
    ['2026-10-22T23:00:00Z', false], // 20:00 BRT
    ['2026-10-23T03:00:00Z', false], // 00:00 BRT
  ]
  for (const [iso, permitido] of casos) {
    assert.equal(horarioPermitidoMercadoFarma(new Date(iso)), permitido, iso)
  }
  assert.match(MENSAGEM_JANELA_MERCADO_FARMA, /20h às 06h59/)
})
