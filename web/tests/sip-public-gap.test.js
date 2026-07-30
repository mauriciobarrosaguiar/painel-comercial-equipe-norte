import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('visão administrativa e pública da SIP mostram quanto falta para 80, 90 e 100 por cento', () => {
  const view = read('src/SipDetailView.tsx')
  const styles = read('src/sip-goal-progress.css')

  for (const label of ['Falta para 80%', 'Falta para 90%', 'Falta para 100%', 'Meta atingida', 'Meta não cadastrada']) {
    assert.match(view, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(view, /Math\.max\(0, objective \* target - realized\)/)
  assert.match(view, /detail\.resumo_sip/)
  assert.match(view, /sip-goal-progress/)
  assert.match(styles, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(styles, /@media\(max-width:760px\)/)
  assert.match(styles, /grid-template-columns:1fr/)
})
