import assert from 'node:assert/strict'
import test from 'node:test'
import { historicoCliente } from '../functions/_lib/client-history.js'
import { mesesReferencia } from '../functions/_lib/client-insights.js'
import { onRequestGet as detalhe } from '../functions/api/clientes/detalhe.js'
import { testDatabase } from './d1-fixture.js'

const importado = (ano_mes, extra = {}) => ({ ano_mes, faturamento: 0, pedidos: 2, produtos: 6, ...extra })

test('sem compras Bússola, mês atual fica zerado mesmo com pedidos/produtos importados', () => {
  const resultado = historicoCliente([importado('2026-10'), importado('2026-09', { faturamento: 350 })], [], new Date('2026-10-22T19:00:00Z'))
  assert.deepEqual(resultado.find(x => x.ano_mes === '2026-10'), {
    ano_mes: '2026-10', faturamento: 0, pedidos: 0, produtos: 0, quantidade: 0, origem: 'BUSSOLA',
  })
  assert.equal(resultado.find(x => x.ano_mes === '2026-09').faturamento, 350)
  assert.equal(resultado.find(x => x.ano_mes === '2026-09').origem, 'IMPORTADO')
})

test('dados atuais do Bússola vencem planilha com valores divergentes, sem somar', () => {
  const resultado = historicoCliente([importado('2026-10', { faturamento: 9999 })], [{ ano_mes: '2026-10', faturamento: 120, pedidos: 1, produtos: 3 }], new Date('2026-10-22T19:00:00Z'))
  assert.equal(resultado.length, 1)
  assert.equal(resultado[0].origem, 'BUSSOLA')
  assert.equal(resultado[0].faturamento, 120)
  assert.equal(resultado[0].pedidos, 1)
  assert.equal(resultado[0].produtos, 3)
})

test('virada do mês considera Brasília e mantém o mês anterior importado', () => {
  const registros = [importado('2026-09'), importado('2026-10')]
  const antes = historicoCliente(registros, [], new Date('2026-10-01T02:59:59Z'))
  assert.equal(antes.at(-1).ano_mes, '2026-09')
  assert.equal(antes.at(-1).origem, 'BUSSOLA')
  const depois = historicoCliente(registros, [], new Date('2026-10-01T03:00:00Z'))
  assert.equal(depois.at(-1).ano_mes, '2026-10')
  assert.equal(depois.at(-1).origem, 'BUSSOLA')
  assert.equal(depois[0].origem, 'IMPORTADO')
})

async function adicionarImportado(DB, cliente, cnpj, mes) {
  await DB.prepare(`INSERT INTO historico_clientes_importado(id,ano_mes,cnpj,cliente_id,faturamento,pedidos,produtos,quantidade,origem_arquivo,importado_por,importado_em)
    VALUES(?,?,?,?,0,2,6,0,'fixture.xlsx','Teste','2026-10-22')`)
    .bind(`h-${cliente}`, mes, cnpj, cliente).run()
}

test('API: caso 2 pedidos/6 produtos importados não invade o mês atual sem faturamento', async () => {
  const DB = testDatabase()
  const mes = mesesReferencia().fim.slice(0, 7)
  await adicionarImportado(DB, 'cl2', '22222222000122', mes)
  const response = await detalhe({ request: new Request('https://painel.local/api/clientes/detalhe?id=cl2'), env: { DB } })
  assert.equal(response.status, 200)
  const body = await response.json()
  const atual = body.historico.find(x => x.ano_mes === mes)
  assert.deepEqual([atual.faturamento, atual.pedidos, atual.produtos, atual.origem], [0, 0, 0, 'BUSSOLA'])
  // Corrige a leitura; não apaga os dados importados do banco.
  const preservado = await DB.prepare('SELECT pedidos,produtos FROM historico_clientes_importado WHERE id=?').bind('h-cl2').first()
  assert.deepEqual([preservado.pedidos, preservado.produtos], [2, 6])
})

test('API: mês atual confere com resumo faturado e ignora pedidos não faturados/inativos', async () => {
  const DB = testDatabase()
  const hoje = mesesReferencia().fim
  const mes = hoje.slice(0, 7)
  await adicionarImportado(DB, 'cl1', '11111111000111', mes)
  await DB.prepare("UPDATE pedidos SET data_pedido=?,data_faturamento=? WHERE id IN ('p1','p2','p3')").bind(hoje, hoje).run()
  const response = await detalhe({ request: new Request(`https://painel.local/api/clientes/detalhe?id=cl1&inicio=${mes}-01&fim=${hoje}`), env: { DB } })
  const body = await response.json()
  assert.equal(response.status, 200)
  const atual = body.historico.find(x => x.ano_mes === mes)
  assert.equal(atual.origem, 'BUSSOLA')
  assert.equal(atual.faturamento, 200)
  assert.equal(atual.pedidos, 1)
  assert.equal(atual.produtos, 4)
  assert.equal(atual.faturamento, body.resumo.faturamento)
  assert.equal(atual.pedidos, body.resumo.pedidos)
  assert.equal(atual.produtos, body.resumo.produtos)
})
