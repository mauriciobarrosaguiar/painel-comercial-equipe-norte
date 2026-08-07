import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const bridge = readFileSync(new URL('../src/OrderSeparatorPdfBridge.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/AppShell.tsx', import.meta.url), 'utf8')

test('Separador de Pedidos aceita PDF além de Excel e colagem', () => {
  assert.match(shell, /OrderSeparatorPdfBridge/)
  assert.match(bridge, /accept="\.pdf,application\/pdf"/)
  assert.match(bridge, /pdf\.min\.mjs/)
  assert.match(bridge, /pdf\.worker\.min\.mjs/)
  assert.match(bridge, /CNPJ/)
  assert.match(bridge, /Cód\. Barras/)
  assert.match(bridge, /Produto/)
  assert.match(bridge, /Qtd\./)
  assert.match(bridge, /texto selecionável/)
})
