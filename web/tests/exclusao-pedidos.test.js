import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('pedidos não faturados podem ser excluídos com confirmação', () => {
  const view = read('src/ConsultantsModule.tsx')
  const api = read('functions/api/consultor-pedidos.js')
  const migration = read('migrations/10012_exclusao_manual_pedidos.sql')

  assert.match(view, /className="consultant-order-delete"/)
  assert.match(view, /window\.confirm/)
  assert.match(view, /method: 'DELETE'/)
  assert.match(api, /onRequestDelete/)
  assert.match(api, /excluido_manual=1/)
  assert.match(api, /PEDIDO_NAO_FATURADO/)
  assert.match(migration, /ADD COLUMN excluido_manual/)
  assert.match(migration, /permanecem_inativos/)
})
