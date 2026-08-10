import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const bridge = readFileSync(new URL('../src/OrderSeparatorPdfBridgeV3.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/AppShell.tsx', import.meta.url), 'utf8')

test('Separador usa a UF selecionada no painel quando a planilha não informa UF', () => {
  assert.match(shell, /OrderSeparatorPdfBridgeV3/)
  assert.match(bridge, /separator-state-list button\.active span/)
  assert.match(bridge, /UF \/ Estado/)
  assert.match(bridge, /headers\.push\('UF \/ Estado'\)/)
  assert.match(bridge, /row\.push\(selectedUf\)/)
  assert.match(bridge, /mapping: \{ \.\.\.body\.mapping, uf: ufIndex \}/)
  assert.match(bridge, /separador-pedidos-analisar/)
})
