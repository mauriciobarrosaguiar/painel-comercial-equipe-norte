import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { onRequestGet, onRequestPost } from '../functions/api/foco-semanal.js'
import { testDatabase } from './d1-fixture.js'

const key = 'chave-administrativa-teste'

const requestFocus = (DB, inicio = '2026-07-07', fim = '2026-07-13') => onRequestGet({
  request: new Request(`https://x/api/foco-semanal?inicio=${inicio}&fim=${fim}`),
  env: { DB },
})

test('Foco Semanal compara meta com a quantidade faturada no período cadastrado', async () => {
  const body = await (await requestFocus(testDatabase())).json()
  assert.equal(body.linhas.length, 1)
  assert.equal(body.linhas[0].consultor, 'Ana')
  assert.equal(body.linhas[0].meta_quantidade, 2)
  assert.equal(body.linhas[0].realizado_quantidade, 1)
  assert.equal(body.linhas[0].cobertura_percentual, 50)
})

test('Foco Semanal usa somente quantidade faturada, sem substituir por atendida ou solicitada', async () => {
  const DB = testDatabase()
  await DB.prepare("UPDATE itens_pedido SET quantidade_faturada=0,quantidade_atendida=3,quantidade_solicitada=4 WHERE id='i1'").run()
  const body = await (await requestFocus(DB)).json()
  assert.equal(body.linhas[0].realizado_quantidade, 0)
  assert.equal(body.linhas[0].cobertura_percentual, 0)
})

test('Foco Semanal mostra somente a missão cadastrada exatamente para as datas selecionadas', async () => {
  const body = await (await requestFocus(testDatabase(), '2026-07-08', '2026-07-13')).json()
  assert.equal(body.linhas.length, 0)
})

test('Foco Semanal devolve catálogo pesquisável por produto e EAN', async () => {
  const body = await (await requestFocus(testDatabase())).json()
  const product = body.filtros.produtos.find(item => item.ean === '222')
  assert.equal(product.descricao, 'Prioritário')
  assert.equal(product.id, 'prioritario')
  assert.equal(body.filtros.consultores[0].setor, 'm0043497')
})

test('Foco Semanal salva produto e meta individual no período escolhido', async () => {
  const DB = testDatabase()
  const env = { DB, PAINEL_ADMIN_KEY: key }
  const request = new Request('https://x/api/foco-semanal', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': key },
    body: JSON.stringify({
      semana_inicio: '2026-07-07',
      semana_fim: '2026-07-13',
      produto_id: 'prioritario',
      ean: '222',
      consultores: [{ id: 'co1', meta_quantidade: 3 }],
    }),
  })
  const response = await onRequestPost({ request, env })
  assert.equal(response.status, 200)
  const saved = await response.json()
  assert.equal(saved.consultores, 1)
  assert.equal(saved.produto.id, 'prioritario')
  assert.deepEqual(saved.periodo, { inicio: '2026-07-07', fim: '2026-07-13' })

  const stored = await DB.prepare("SELECT produto_id,ean,semana_inicio,semana_fim FROM foco_semanal WHERE ean='222'").first()
  assert.equal(stored.produto_id, 'prioritario')
  assert.equal(stored.semana_inicio, '2026-07-07')
  assert.equal(stored.semana_fim, '2026-07-13')

  const body = await (await requestFocus(DB)).json()
  const line = body.linhas.find(item => item.ean === '222')
  assert.equal(line.meta_quantidade, 3)
  assert.equal(line.realizado_quantidade, 1)
  assert.ok(Math.abs(line.cobertura_percentual - 33.3333333333) < 0.0001)
})

test('Tela usa matriz de missão com meta, quantidade faturada e atingimento por produto', () => {
  const source = readFileSync(new URL('../src/FocusModule.tsx', import.meta.url), 'utf8')
  assert.match(source, /Produto — pesquise pelo nome ou EAN/)
  assert.match(source, /focus-product-options/)
  assert.match(source, /colSpan=\{3\}/)
  assert.match(source, /META DO PRODUTO/)
  assert.match(source, /QTDE FATURADA/)
  assert.match(source, /% ATINGIMENTO/)
  assert.match(source, /focus-mission-table/)
  assert.doesNotMatch(source, /className="market-table focus-consultant-table"/)
})
