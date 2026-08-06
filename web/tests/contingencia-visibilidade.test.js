import assert from 'node:assert/strict'
import test from 'node:test'

import { contingencyDecision } from '../functions/_middleware.js'

const estado = {
  modo: 'individual',
  consultores_ids: ['c1'],
  consultores_extraidos: 1,
  consultores_esperados: 2,
}

test('consultor publicado recebe dashboard forçado para a própria carteira', () => {
  const decision = contingencyDecision(
    '/api/dashboard',
    { consultor_id: 'c1' },
    estado,
    'https://painel.local/api/dashboard?consultor=c2&periodo=mes-atual',
  )

  assert.equal(decision.action, 'dashboard')
  assert.equal(new URL(decision.url).searchParams.get('consultor'), 'c1')
})

test('consultor ainda não publicado não enxerga a base parcial', () => {
  const decision = contingencyDecision(
    '/api/dashboard',
    { consultor_id: 'c2' },
    estado,
    'https://painel.local/api/dashboard',
  )

  assert.equal(decision.action, 'block')
  assert.equal(decision.code, 'CONTINGENCIA_AGUARDANDO_ACESSO')
})

test('módulos de equipe ficam bloqueados durante a contingência parcial', () => {
  const decision = contingencyDecision(
    '/api/consultores',
    { consultor_id: 'c1' },
    estado,
    'https://painel.local/api/consultores',
  )

  assert.equal(decision.action, 'block')
  assert.equal(decision.code, 'CONTINGENCIA_APENAS_VISAO_INDIVIDUAL')
})

test('quando a cobertura está completa o painel volta ao modo normal', () => {
  const decision = contingencyDecision(
    '/api/dashboard',
    { consultor_id: 'c1' },
    { modo: 'equipe', consultores_ids: ['c1', 'c2'] },
    'https://painel.local/api/dashboard',
  )

  assert.equal(decision.action, 'pass')
})
