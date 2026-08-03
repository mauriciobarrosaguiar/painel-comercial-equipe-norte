import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { onRequestPost } from '../functions/api/admin/bases.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-administrativa-teste'
const migration = readFileSync(
  new URL('../migrations/10021_corrigir_mix_linha_historico.sql', import.meta.url),
  'utf8',
)
const mixScript = readFileSync(
  new URL('../../scripts/aplicar_mix_sap_d1.py', import.meta.url),
  'utf8',
)

test('produto que não está nas listas mensais é Linha e compõe OL Sem Combate', () => {
  assert.match(migration, /SET tipo_mix='LINHA'/)
  assert.match(migration, /SEM CLASSIFICACAO/)
  assert.match(migration, /trg_produtos_mix_linha_insert/)
  assert.match(migration, /trg_produtos_mix_linha_update/)
  assert.match(mixScript, /UPDATE produtos\s+SET tipo_mix='LINHA'/s)
  assert.match(mixScript, /Prioritários, Lançamentos e Combate/)
})

test('importar metas do mês seguinte fecha o resultado anterior antes de trocar o MIX', async () => {
  const database = testDatabase()
  const response = await onRequestPost({
    request: new Request('https://painel.local/api/admin/bases', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-key': ADMIN_KEY,
      },
      body: JSON.stringify({
        tipo: 'metas_mix',
        nome_arquivo: 'metas-agosto.xlsx',
        ano_mes: '2026-08',
        rows: [
          {
            colaborador: 'GD Norte',
            cargo: 'G DISTRITAL',
            escopo: 'gerente',
            ol_sem_combate: 1200,
            ol_prioritarios: 400,
            ol_lancamentos: 250,
          },
          {
            colaborador: 'Ana',
            cargo: 'CONSULTOR VENDAS',
            escopo: 'consultor',
            ol_sem_combate: 1200,
            ol_prioritarios: 400,
            ol_lancamentos: 250,
          },
        ],
        mix_rows: [
          { cod_sap: 10086, produto: 'Prioritário', tipo_mix: 'PRIORITARIOS' },
          { cod_sap: 37063, produto: 'Novo lançamento', tipo_mix: 'LANCAMENTOS' },
          { cod_sap: 10302, produto: 'Combate', tipo_mix: 'COMBATE' },
        ],
      }),
    }),
    env: { DB: database, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })

  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))

  const closed = await database.prepare(`
    SELECT resultado_json
      FROM historico_mensal
     WHERE ano_mes='2026-07' AND escopo='GERAL' AND versao_atual=1
  `).first()
  assert.ok(closed, 'Julho deveria ter sido fechado antes da importação de agosto.')

  const july = JSON.parse(closed.resultado_json)
  assert.equal(july.ol_sem_combate, 150)
  assert.equal(july.ol_prioritarios, 50)
  assert.equal(july.ol_lancamentos, 0)
  assert.equal(july.ol_combate, 40)

  const changedProduct = await database.prepare(
    "SELECT tipo_mix FROM produtos WHERE sku='37063'",
  ).first()
  assert.equal(changedProduct.tipo_mix, 'LANCAMENTO')

  const julyGoal = await database.prepare(
    "SELECT ol_sem_combate FROM metas WHERE ano_mes='2026-07' AND escopo='gerente'",
  ).first()
  const augustGoal = await database.prepare(
    "SELECT ol_sem_combate FROM metas WHERE ano_mes='2026-08' AND escopo='gerente'",
  ).first()
  assert.equal(julyGoal.ol_sem_combate, 1000)
  assert.equal(augustGoal.ol_sem_combate, 1200)
})
