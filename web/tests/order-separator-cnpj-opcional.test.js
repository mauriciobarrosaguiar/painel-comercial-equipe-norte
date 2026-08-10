import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const bridge = readFileSync(new URL('../src/OrderSeparatorPdfBridgeV4.tsx', import.meta.url), 'utf8')
const endpoint = readFileSync(new URL('../functions/api/separador-pedidos-analisar-v2.js', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/AppShell.tsx', import.meta.url), 'utf8')

test('Separador permite planilha sem CNPJ', () => {
  assert.match(shell, /OrderSeparatorPdfBridgeV4/)
  assert.match(bridge, /Sem CNPJ \(pedido único\)/)
  assert.match(bridge, /Opcional/)
  assert.match(bridge, /separador-pedidos-analisar-v2/)
  assert.match(endpoint, /mapping\.ean < 0 \|\| mapping\.quantidade < 0/)
  assert.doesNotMatch(endpoint, /mapping\.cnpj < 0/)
  assert.match(endpoint, /SEM CNPJ/)
  assert.match(endpoint, /uf_selecionada_no_painel/)
})
