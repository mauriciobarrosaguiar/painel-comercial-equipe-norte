import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarioDoPeriodo, diasUteis, metasDiarias } from '../functions/_lib/business-calendar.js'
import { onRequestGet as dashboard } from '../functions/api/dashboard.js'
import { onRequestGet as consultores } from '../functions/api/consultores.js'
import { personalDatabase } from './d1-fixture.js'

const periodo = { tipo: 'mes-atual', inicio: '2026-11-01', fim: '2026-11-30' }
const agora = new Date('2026-11-03T15:00:00Z')
test('novembro tem 19 dias úteis comerciais; feriados e fuso não dependem do aparelho', () => {
  assert.equal(diasUteis(periodo.inicio, periodo.fim), 19)
  assert.equal(diasUteis('2026-11-02', '2026-11-02'), 0)
  assert.equal(diasUteis('2026-11-20', '2026-11-20'), 0)
  assert.equal(calendarioDoPeriodo(periodo, agora).dias_uteis_restantes, 19)
  assert.equal(calendarioDoPeriodo(periodo, new Date('2026-11-04T02:59:59Z')).dias_uteis_restantes, 19)
  assert.equal(calendarioDoPeriodo(periodo, new Date('2026-11-04T03:00:00Z')).dias_uteis_restantes, 18)
})
test('saldo dividido pelos dias restantes, com arredondamento para cima em centavos', () => {
  const data = metasDiarias(periodo, { ol_sem_combate: 83.43 }, { ol_sem_combate: 183884.18 }, agora).ol_sem_combate
  assert.equal(data.valor, 9673.73)
  assert.equal(data.falta, 183800.75)
  assert.equal(data.inclui_hoje, true)
  assert.ok(data.valor * data.dias_uteis_restantes >= data.falta)
})
test('meta atingida, sem meta, fim de semana e período encerrado não dividem por zero', () => {
  const calc = (real, meta, date = agora, range = periodo) => metasDiarias(range, { ol_sem_combate: real }, { ol_sem_combate: meta }, date).ol_sem_combate
  assert.equal(calc(200, 100).valor, 0)
  assert.equal(calc(200, 100).atingida, true)
  assert.equal(calc(0, 0).sem_meta, true)
  assert.equal(calc(0, 0).valor, null)
  assert.equal(calc(0, 100, new Date('2026-11-07T15:00:00Z')).inclui_hoje, false)
  assert.equal(calc(0, 100, agora, { inicio: '2026-10-01', fim: '2026-10-31' }).ativa, false)
  assert.equal(calc(0, 100, agora, { inicio: '2026-11-01', fim: '2026-11-15' }).ativa, false)
})
test('dashboard e Meu desempenho usam exatamente a mesma meta diária', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: agora })
  const DB = await personalDatabase()
  await DB.prepare("UPDATE pedidos SET data_faturamento='2026-11-03',data_pedido='2026-11-03'").run()
  await DB.prepare("UPDATE metas SET ano_mes='2026-11'").run()
  const env = { DB }
  const a = await (await dashboard({ request: new Request('https://test/api/dashboard'), env })).json()
  const b = await (await consultores({ request: new Request('https://test/api/consultores'), env })).json()
  assert.deepEqual(a.metas_diarias, b.consultores[0].metas_diarias)
  assert.equal(a.projecao.dias_uteis_total, 19)
})
