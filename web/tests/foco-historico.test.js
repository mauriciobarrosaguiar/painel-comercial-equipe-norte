import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequestGet as getHistory } from '../functions/api/foco-historico.js'
import { onRequestGet as getSpreadsheet } from '../functions/api/foco-planilha.js'
import { testDatabase } from './d1-fixture.js'

test('missão encerrada vira histórico com meta e realizado congelados', async () => {
  const DB = testDatabase()
  const response = await getHistory({ env: { DB } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.historicos.length, 1)

  const snapshot = body.historicos[0]
  assert.deepEqual(snapshot.periodo, { inicio: '2026-07-07', fim: '2026-07-13' })
  assert.equal(snapshot.produtos.length, 1)
  assert.equal(snapshot.consultores.length, 1)
  assert.equal(snapshot.linhas[0].meta_quantidade, 2)
  assert.equal(snapshot.linhas[0].realizado_quantidade, 1)
  assert.equal(snapshot.linhas[0].cobertura_percentual, 50)

  await DB.prepare("UPDATE itens_pedido SET quantidade_faturada=9 WHERE id='i1'").run()
  const second = await (await getHistory({ env: { DB } })).json()
  assert.equal(second.historicos[0].linhas[0].realizado_quantidade, 1)
})

test('planilha da missão mantém cabeçalhos agrupados e totais', async () => {
  const DB = testDatabase()
  const response = await getSpreadsheet({
    request: new Request('https://x/api/foco-planilha?inicio=2026-07-07&fim=2026-07-13'),
    env: { DB },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /application\/vnd\.ms-excel/)
  assert.match(response.headers.get('content-disposition') || '', /missao_2026-07-07_a_2026-07-13\.xls/)

  const content = await response.text()
  assert.match(content, /MISSÃO DO PERÍODO/)
  assert.match(content, /META DO PRODUTO/)
  assert.match(content, /QTDE FATURADA/)
  assert.match(content, /% ATINGIMENTO/)
  assert.match(content, /Ana/)
  assert.match(content, /TOTAL/)
})
