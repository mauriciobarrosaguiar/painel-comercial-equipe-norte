import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequestPost as importar } from '../functions/api/historico/importar.js'
import { onRequestGet as historicoMensal } from '../functions/api/historico.js'
import { onRequestGet as detalhe } from '../functions/api/clientes/detalhe.js'
import { testDatabase } from './d1-fixture.js'

test('histórico importado aparece na evolução mensal do cliente', async () => {
  const DB = testDatabase()
  const response = await importar({
    request: new Request('https://painel.local/api/historico/importar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        arquivo: 'historico.xlsx',
        registros: [
          {
            ano_mes: '2026-05',
            cnpj: '11111111000111',
            faturamento: 350,
            pedidos: 2,
            produtos: 4,
            quantidade: 8,
          },
        ],
      }),
    }),
    env: { DB, PAINEL_ADMIN_KEY: 'chave-administrativa-teste' },
  })
  assert.equal(response.status, 200)
  const imported = await response.json()
  assert.equal(imported.registros, 1)
  assert.equal(imported.vinculados, 1)

  const result = await detalhe({
    request: new Request('https://painel.local/api/clientes/detalhe?id=cl1'),
    env: { DB },
  })
  const body = await result.json()
  const month = body.historico.find((item) => item.ano_mes === '2026-05')
  assert.equal(month.faturamento, 350)
  assert.equal(month.origem, 'IMPORTADO')
  assert.equal(body.historico.find((item) => item.ano_mes === '2026-07').origem, 'BUSSOLA')
})

test('planilha importada alimenta o seletor e os totais do histórico mensal', async () => {
  const DB = testDatabase()
  await importar({
    request: new Request('https://painel.local/api/historico/importar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        arquivo: 'Pedidos_2026-07-21.xlsx',
        registros: [
          {
            ano_mes: '2026-05',
            cnpj: '11111111000111',
            faturamento: 350,
            pedidos: 2,
            produtos: 4,
            quantidade: 8,
          },
        ],
      }),
    }),
    env: { DB, PAINEL_ADMIN_KEY: 'chave-administrativa-teste' },
  })

  const response = await historicoMensal({
    request: new Request('https://painel.local/api/historico'),
    env: { DB },
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  const month = body.meses.find((item) => item.ano_mes === '2026-05')
  assert.equal(month.origem, 'IMPORTADO')

  const geral = body.geral.find((item) => item.ano_mes === '2026-05')
  assert.equal(geral.resultado.ol_total, 350)
  assert.equal(geral.resultado.clientes_com_venda, 1)

  const consultor = body.itens.find(
    (item) => item.ano_mes === '2026-05' && item.escopo === 'CONSULTOR',
  )
  assert.equal(consultor.referencia_nome, 'Ana')
  assert.equal(consultor.resultado.ol_total, 350)
  assert.equal(consultor.resultado.clientes_ativos, 2)
})
