import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const workflow = readFileSync(new URL('../../.github/workflows/bussola-d1.yml', import.meta.url), 'utf8')

test('Bússola possui agendamento real a cada 30 minutos', () => {
  assert.match(workflow, /schedule:\s*\n\s*- cron: ["']\*\/30 \* \* \* \*["']/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /concurrency:\s*\n\s*group: bussola-d1\s*\n\s*cancel-in-progress: false/)
})

test('extração permite concluir processamento longo sem perder a sincronização', () => {
  assert.match(workflow, /timeout-minutes: 60/)
  assert.match(workflow, /python scripts\/extrair_bussola_d1_corrigido\.py/)
})

test('cada extração recalcula o mês anterior fechado', () => {
  assert.match(workflow, /Atualizar mês fechado com faturamentos retroativos/)
  assert.match(workflow, /api\/internal\/fechamento-mensal/)
  assert.match(workflow, /automatico:true/)
  assert.match(workflow, /somente_se_alterado:true/)
  assert.match(workflow, /apenas_fechado:true/)
})
