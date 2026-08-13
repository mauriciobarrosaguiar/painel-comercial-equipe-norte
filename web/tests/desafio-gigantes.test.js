import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequestPost } from '../functions/api/admin/bases-v2.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-administrativa-teste'

test('Desafio de Gigantes importa somente consultor e GD do painel', async () => {
  const database = testDatabase()
  const response = await onRequestPost({
    request: new Request('https://painel.local/api/admin/bases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({
        tipo: 'desafio_gigantes',
        nome_arquivo: 'Meta Territorio - Ago26.xlsx',
        ano_mes: '2026-08',
        rows: [
          { escopo: 'consultor', setor: 'm0043497', nome_colaborador: 'Ana', sap: 10538, produto: 'ACETILCISTEINA', meta_positivacao: 20, meta_giro: 4 },
          { escopo: 'gerente', setor: '18150300', nome_colaborador: 'GD Norte', sap: 10939, produto: 'ROSUVASTATINA', meta_positivacao: 100, meta_giro: 12 },
          { escopo: 'consultor', setor: '99999999', nome_colaborador: 'Pessoa Outro Territorio', sap: 11126, produto: 'ORLISTATE', meta_positivacao: 10, meta_giro: 2 },
        ],
      }),
    }),
    env: { DB: database, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  assert.equal(result.total, 2)
  assert.equal(result.consultores, 1)
  assert.equal(result.gerentes, 1)
  assert.equal(result.ignoradas, 1)
  assert.equal(result.skus, 2)

  const metas = await database.prepare('SELECT escopo,nome_colaborador,setor,sku,meta_positivacao,meta_giro FROM desafio_gigantes_metas ORDER BY escopo').all()
  assert.equal(metas.results.length, 2)
  assert.deepEqual(metas.results.map((row) => ({ ...row })), [
    { escopo: 'consultor', nome_colaborador: 'Ana', setor: '0043497', sku: '10538', meta_positivacao: 20, meta_giro: 4 },
    { escopo: 'gerente', nome_colaborador: 'GD Norte', setor: '18150300', sku: '10939', meta_positivacao: 100, meta_giro: 12 },
  ])
  const produtos = await database.prepare('SELECT sku,status FROM desafio_gigantes_produtos ORDER BY sku').all()
  assert.deepEqual(produtos.results.map((row) => ({ ...row })), [
    { sku: '10538', status: 'PENDENTE' },
    { sku: '10939', status: 'PENDENTE' },
  ])
})
