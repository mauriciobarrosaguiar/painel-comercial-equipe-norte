import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { onRequestPost as fechar } from '../functions/api/internal/fechamento-mensal.js'
import { onRequestGet as historico } from '../functions/api/historico.js'
import { testDatabase } from './d1-fixture.js'

const key = 'chave-administrativa-teste'
const request = (body) => new Request('https://painel.local/api/internal/fechamento-mensal', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-key': key },
  body: JSON.stringify(body),
})

test('mês fechado recebe faturamento retroativo sem alterar as metas congeladas', async () => {
  const DB = testDatabase()
  const env = { DB, PAINEL_ADMIN_KEY: key }

  await DB.prepare(`
    INSERT INTO metas(
      id,consultor_id,escopo,ano_mes,ol_sem_combate,ol_prioritarios,
      ol_lancamentos,clientes_positivados,demanda_sem_combate,importacao_id,atualizado_em
    ) VALUES('mc','co1','consultor','2026-07',600,180,120,2,0,'imp','2026-07-01')
  `).run()

  const first = await fechar({ request: request({ ano_mes: '2026-07' }), env })
  assert.equal(first.status, 200)
  const initial = await first.json()
  assert.equal(initial.versao, 1)

  const initialHistory = await (await historico({
    request: new Request('https://painel.local/api/historico?ano_mes=2026-07'),
    env,
  })).json()
  const consultorInicial = initialHistory.itens.find((item) => item.escopo === 'CONSULTOR' && item.referencia_id === 'co1')
  assert.equal(consultorInicial.resultado.meta_ol_sem_combate, 600)
  assert.equal(consultorInicial.resultado.meta_ol_prioritarios, 180)
  assert.equal(initialHistory.geral[0].resultado.meta_ol_sem_combate, 1000)

  await DB.prepare("UPDATE metas SET ol_sem_combate=9999,ol_prioritarios=9999 WHERE ano_mes='2026-07'").run()
  await DB.prepare("UPDATE pedidos SET status='FATURADO' WHERE id='p2'").run()

  const update = await fechar({
    request: request({
      ano_mes: '2026-07',
      automatico: true,
      somente_se_alterado: true,
      apenas_fechado: true,
    }),
    env,
  })
  assert.equal(update.status, 200)
  const updated = await update.json()
  assert.equal(updated.atualizado, true)
  assert.equal(updated.versao, 2)
  assert.equal(updated.versao_anterior, 1)
  assert.equal(updated.diferencas.ol_total, 700)
  assert.match(updated.motivo, /faturamentos retroativos/i)

  const versions = await DB.prepare(
    "SELECT versao,versao_atual,motivo_reprocessamento FROM historico_mensal WHERE ano_mes='2026-07' AND escopo='GERAL' ORDER BY versao",
  ).all()
  assert.equal(versions.results.length, 2)
  assert.equal(versions.results[0].versao_atual, 0)
  assert.equal(versions.results[1].versao_atual, 1)
  assert.match(versions.results[1].motivo_reprocessamento, /faturamentos retroativos/i)

  const history = await (await historico({
    request: new Request('https://painel.local/api/historico?ano_mes=2026-07'),
    env,
  })).json()
  assert.equal(history.geral[0].versao, 2)
  assert.equal(history.geral[0].resultado.ol_total, 900)
  assert.equal(history.geral[0].resultado.ol_sem_combate, 850)
  assert.equal(history.geral[0].resultado.meta_ol_sem_combate, 1000)

  const consultorAtualizado = history.itens.find((item) => item.escopo === 'CONSULTOR' && item.referencia_id === 'co1')
  assert.equal(consultorAtualizado.resultado.meta_ol_sem_combate, 600)
  assert.equal(consultorAtualizado.resultado.meta_ol_prioritarios, 180)
  assert.equal(consultorAtualizado.resultado.ol_sem_combate, 850)
})

test('reconciliação automática não cria nova versão quando nada mudou', async () => {
  const DB = testDatabase()
  const env = { DB, PAINEL_ADMIN_KEY: key }
  await fechar({ request: request({ ano_mes: '2026-07' }), env })

  const response = await fechar({
    request: request({ ano_mes: '2026-07', automatico: true }),
    env,
  })
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.sem_alteracao, true)
  assert.equal(body.versao, 1)

  const count = await DB.prepare(
    "SELECT COUNT(DISTINCT versao) total FROM historico_mensal WHERE ano_mes='2026-07'",
  ).first()
  assert.equal(Number(count.total), 1)
})

test('automação pode criar o primeiro fechamento quando apenas_fechado é falso', async () => {
  const DB = testDatabase()
  const env = { DB, PAINEL_ADMIN_KEY: key }

  const response = await fechar({
    request: request({
      ano_mes: '2026-07',
      automatico: true,
      apenas_fechado: false,
      somente_se_alterado: true,
    }),
    env,
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ignorado, undefined)
  assert.equal(body.atualizado, false)
  assert.equal(body.versao, 1)
})

test('Bússola fecha o mês anterior e reconcilia todos os meses fechados', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/bussola-d1.yml', import.meta.url), 'utf8')
  assert.match(workflow, /Fechar mês anterior e reconciliar histórico/)
  assert.match(workflow, /TZ=America\/Araguaina/)
  assert.match(workflow, /automatico:true/)
  assert.match(workflow, /somente_se_alterado:true/)
  assert.match(workflow, /apenas_fechado:\$apenas_fechado/)
  assert.match(workflow, /fechar_mes[\s\\]+\n[\s]*"\$ANO_MES"[\s\\]+\n[\s]*false/)
  assert.match(workflow, /api\/historico/)
  assert.match(workflow, /select\(\.origem == "FECHAMENTO"\)/)
  assert.match(workflow, /api\/internal\/fechamento-mensal/)
})
