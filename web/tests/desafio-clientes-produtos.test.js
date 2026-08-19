import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { testDatabase } from './d1-fixture.js'
import { onRequestGet } from '../functions/api/desafio-gigantes-clientes.js'
import { onRequestGet as exportarNaoPositivados } from '../functions/api/desafio-gigantes-nao-positivados-excel.js'

const page = readFileSync(new URL('../src/DesafioGigantesPage.tsx', import.meta.url), 'utf8')
const component = readFileSync(new URL('../src/DesafioClientesProdutos.tsx', import.meta.url), 'utf8')

async function preparar(DB) {
  await DB.prepare("INSERT INTO desafio_gigantes_produtos(sku,ean,produto,status,atualizado_em) VALUES('10018','111','Linha','IDENTIFICADO','2026-07-01'),('10086','222','Prioritário','IDENTIFICADO','2026-07-01')").run()
  await DB.prepare("INSERT INTO desafio_gigantes_metas(id,ano_mes,escopo,consultor_id,nome_colaborador,setor,sku,produto_planilha,meta_positivacao,meta_giro,ean,produto_identificado,status_identificacao,atualizado_em) VALUES('dg1','2026-07','consultor','co1','Ana','m0043497','10018','Linha',2,1,'111','Linha','IDENTIFICADO','2026-07-01'),('dg2','2026-07','consultor','co1','Ana','m0043497','10086','Prioritário',2,1,'222','Prioritário','IDENTIFICADO','2026-07-01')").run()
}

async function carregar(DB, extra='') {
  const response = await onRequestGet({ request: new Request(`https://painel.test/api/desafio-gigantes-clientes?ano_mes=2026-07&consultor=co1${extra}`), env: { DB } })
  assert.equal(response.status, 200)
  return response.json()
}

test('tela do Desafio inclui mapa por cliente e por produto', () => {
  assert.match(page, /DesafioClientesProdutos/)
  assert.match(component, /Por cliente/)
  assert.match(component, /Por produto/)
  assert.match(component, /Próxima melhor venda/)
  assert.match(component, /Não positivou/)
  assert.match(component, /Já positivou/)
  assert.match(component, /Clientes para vender/)
})

test('download dos não positivados fica visível no topo do Desafio', () => {
  assert.match(page, /Baixar não positivados/)
  assert.match(page, /dg-download-visible/)
  assert.match(page, /desafio-gigantes-nao-positivados-excel/)
})

test('tela oferece Excel dos não positivados com preços do Mercado Farma', () => {
  assert.match(component, /Extrair não positivados \+ preços/)
  assert.match(component, /desafio-gigantes-nao-positivados-excel/)
})

test('mapa mostra quais produtos cada cliente positivou e recomenda o próximo SKU', async () => {
  const DB = testDatabase()
  await preparar(DB)
  const body = await carregar(DB)
  assert.equal(body.resumo.clientes, 2)
  assert.equal(body.resumo.skus, 2)
  const farmaciaA = body.clientes.find((item) => item.cliente_id === 'cl1')
  const farmaciaB = body.clientes.find((item) => item.cliente_id === 'cl2')
  assert.equal(farmaciaA.positivados, 2)
  assert.equal(farmaciaA.faltantes, 0)
  assert.equal(farmaciaB.positivados, 0)
  assert.equal(farmaciaB.faltantes, 2)
  assert.equal(farmaciaB.recomendacao_sku, '10018')
  const linha = body.produtos.find((item) => item.sku === '10018')
  assert.equal(linha.clientes_positivados, 1)
  assert.equal(linha.clientes_sem_compra, 1)
  assert.equal(linha.falta_pdv_80, 1)
})

test('detalhe do cliente separa produtos positivados dos não positivados', async () => {
  const DB = testDatabase()
  await preparar(DB)
  const body = await carregar(DB, '&cliente=cl2')
  assert.equal(body.cliente.id, 'cl2')
  assert.equal(body.produtos.length, 2)
  assert.equal(body.produtos.every((item) => item.positivou === false), true)
})

test('detalhe do produto lista clientes positivados e clientes para vender', async () => {
  const DB = testDatabase()
  await preparar(DB)
  const body = await carregar(DB, '&sku=10018')
  assert.equal(body.produto.sku, '10018')
  const a = body.clientes.find((item) => item.cliente_id === 'cl1')
  const b = body.clientes.find((item) => item.cliente_id === 'cl2')
  assert.equal(a.positivou, true)
  assert.equal(a.unidades, 1)
  assert.equal(b.positivou, false)
})

test('Excel traz somente não positivados, somente preço sem imposto e distribuidora com estoque', async () => {
  const DB = testDatabase()
  await preparar(DB)
  const response = await exportarNaoPositivados({
    request: new Request('https://painel.test/api/desafio-gigantes-nao-positivados-excel?ano_mes=2026-07&consultor=co1', { headers: { 'x-admin-key': 'chave-administrativa-teste' } }),
    env: { DB, PAINEL_ADMIN_KEY: 'chave-administrativa-teste' },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /spreadsheetml/)
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK')
  const raw = new TextDecoder().decode(bytes)
  assert.match(raw, /Farmácia B/)
  assert.doesNotMatch(raw, /Farmácia A/)
  assert.match(raw, /Distribuidora A - SEM IMPOSTO \(R\$\)/)
  assert.doesNotMatch(raw, /Distribuidora B - SEM IMPOSTO \(R\$\)/)
  assert.match(raw, /MELHOR PREÇO SEM IMPOSTO \(R\$\)/)
  assert.match(raw, /PREÇOS SEM IMPOSTO/)
  assert.match(raw, /Prioritário/)
})
