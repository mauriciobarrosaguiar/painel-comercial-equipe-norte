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

test('Foco Semanal calcula meta, realizado e CNPJ por consultor', async () => {
  const body = await (await requestFocus(testDatabase())).json()
  assert.equal(body.linhas.length, 1)
  assert.equal(body.linhas[0].consultor, 'Ana')
  assert.equal(body.linhas[0].meta_quantidade, 2)
  assert.equal(body.linhas[0].realizado_quantidade, 1)
  assert.equal(body.linhas[0].cnpj_positivados, 1)
  assert.equal(body.linhas[0].faturamento, 100)
  assert.equal(body.linhas[0].cobertura_percentual, 50)
})

test('Foco Semanal usa quantidade atendida quando a faturada veio zerada', async () => {
  const DB = testDatabase()
  await DB.prepare("UPDATE itens_pedido SET quantidade_faturada=0,quantidade_atendida=3 WHERE id='i1'").run()
  const body = await (await requestFocus(DB)).json()
  assert.equal(body.linhas[0].realizado_quantidade, 3)
  assert.equal(body.linhas[0].cobertura_percentual, 150)
})

test('Foco Semanal devolve catálogo pesquisável por produto e EAN', async () => {
  const body = await (await requestFocus(testDatabase())).json()
  const product = body.filtros.produtos.find(item => item.ean === '222')
  assert.equal(product.descricao, 'Prioritário')
  assert.equal(product.id, 'prioritario')
  assert.equal(body.filtros.consultores[0].setor, 'm0043497')
})

test('Foco Semanal salva metas individuais e vincula o produto do catálogo', async () => {
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
      descricao: 'Prioritário',
      consultores: [{ id: 'co1', meta_quantidade: 3 }],
    }),
  })
  const response = await onRequestPost({ request, env })
  assert.equal(response.status, 200)
  const saved = await response.json()
  assert.equal(saved.consultores, 1)
  assert.equal(saved.produto.id, 'prioritario')
  const stored = await DB.prepare("SELECT produto_id,ean FROM foco_semanal WHERE ean='222'").first()
  assert.equal(stored.produto_id, 'prioritario')
  const body = await (await requestFocus(DB)).json()
  assert.equal(body.linhas.length, 2)
  assert.equal(body.linhas.find(item => item.ean === '222').meta_quantidade, 3)
})

test('Tela do Foco possui lista compacta e pesquisa por nome ou EAN', () => {
  const source = readFileSync(new URL('../src/FocusModule.tsx', import.meta.url), 'utf8')
  assert.match(source, /Produto — pesquise pelo nome ou EAN/)
  assert.match(source, /focus-product-options/)
  assert.match(source, /focus-target-table/)
  assert.match(source, /TOTAL/)
})
