import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ITEM_FATURADO,
  MIX_SEM_COMBATE,
  classificarMix,
} from '../functions/_lib/commercial.js'

test('classifica sem combate sem transformar em combate', () => {
  assert.equal(classificarMix('SEM COMBATE'), 'LINHA')
  assert.equal(classificarMix('não combate'), 'LINHA')
  assert.equal(classificarMix('sem combate prioritários'), 'PRIORITARIO')
  assert.equal(classificarMix('COMBATE'), 'COMBATE')
})

test('consultas exigem registro ativo e status faturado exato', () => {
  assert.match(ITEM_FATURADO, /pe\.ativo=1/)
  assert.match(ITEM_FATURADO, /ip\.ativo=1/)
  assert.match(ITEM_FATURADO, /IN \('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO'\)/)
  assert.doesNotMatch(ITEM_FATURADO, /LIKE/)
  assert.match(MIX_SEM_COMBATE, /'LINHA','PRIORITARIO','LANCAMENTO'/)
  assert.doesNotMatch(MIX_SEM_COMBATE, /SEM CLASSIFICACAO/)
})
