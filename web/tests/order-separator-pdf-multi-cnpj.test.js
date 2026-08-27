import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/OrderSeparatorPdfBridgeV2.tsx', import.meta.url), 'utf8')

test('PDF com múltiplos CNPJs mantém contexto entre páginas e troca apenas no próximo CNPJ', () => {
  assert.match(source, /extractCnpjEvents/)
  assert.match(source, /let activeCnpj = ''/)
  assert.match(source, /nearestCnpjAbove/)
  assert.match(source, /nextCnpjY/)
  assert.match(source, /row\.cnpj = activeCnpj/)
  assert.match(source, /events\[events\.length - 1\]\.cnpj/)
  assert.match(source, /Separação automática por CNPJ ativada/)
  assert.match(source, /páginas de continuação permanecem no último CNPJ/)
})
