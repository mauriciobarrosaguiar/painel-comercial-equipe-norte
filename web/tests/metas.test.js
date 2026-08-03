import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequestPost } from '../functions/api/admin/bases-v2.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-administrativa-teste'

async function importGoals(database, value) {
  const response = await onRequestPost({
    request: new Request('https://painel.local/api/admin/bases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({
        tipo: 'metas',
        nome_arquivo: 'metas.xlsx',
        ano_mes: '2026-07',
        rows: [{ consultor: 'Ana', ol_sem_combate: value, ol_prioritarios: 20, ol_lancamentos: 10, clientes_positivados: 5 }],
      }),
    }),
    env: { DB: database, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
}

test('reimportação de metas preserva a versão anterior', async () => {
  const database = testDatabase()
  await importGoals(database, 100)
  await importGoals(database, 150)

  const current = await database.prepare("SELECT ol_sem_combate FROM metas WHERE escopo='consultor'").all()
  const history = await database.prepare("SELECT ol_sem_combate FROM metas_historico WHERE escopo='consultor'").all()
  const imports = await database.prepare("SELECT COUNT(*) total FROM importacoes WHERE tipo='METAS_COMERCIAIS'").all()

  assert.equal(current.results[0].ol_sem_combate, 150)
  assert.equal(history.results.length, 1)
  assert.equal(history.results[0].ol_sem_combate, 100)
  assert.equal(imports.results[0].total, 2)
})

test('arquivo de metas respeita a linha do GD e não soma o GD novamente aos consultores', async () => {
  const database = testDatabase()
  const response = await onRequestPost({
    request: new Request('https://painel.local/api/admin/bases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({
        tipo: 'metas',
        nome_arquivo: 'EMS_TERRITORIO_METAS.xlsx',
        ano_mes: '2026-08',
        rows: [
          { colaborador: 'ALESSANDRA FREITAS SA', cargo: 'G DISTRITAL', escopo: 'gerente', ol_sem_combate: 1000, ol_prioritarios: 500, ol_lancamentos: 200, demanda_sem_combate: 900 },
          { colaborador: 'MAURICIO BARROS DE AGUIAR', cargo: 'CONSULTOR VENDAS', escopo: 'consultor', ol_sem_combate: 400, ol_prioritarios: 180, ol_lancamentos: 70, demanda_sem_combate: 350 },
          { colaborador: 'RAIMUNDA MARTINS GOMES CARNEIRO', cargo: 'CONSULTOR VENDAS', escopo: 'consultor', ol_sem_combate: 600, ol_prioritarios: 320, ol_lancamentos: 130, demanda_sem_combate: 550 },
        ],
      }),
    }),
    env: { DB: database, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  assert.equal(result.consultores, 2)
  assert.equal(result.linhas_gd, 1)

  const gerente = await database.prepare("SELECT ol_sem_combate,ol_prioritarios,ol_lancamentos,demanda_sem_combate FROM metas WHERE ano_mes='2026-08' AND escopo='gerente'").first()
  const consultores = await database.prepare("SELECT COUNT(*) total,SUM(ol_sem_combate) soma FROM metas WHERE ano_mes='2026-08' AND escopo='consultor'").first()
  assert.deepEqual(gerente, { ol_sem_combate: 1000, ol_prioritarios: 500, ol_lancamentos: 200, demanda_sem_combate: 900 })
  assert.equal(Number(consultores.total), 2)
  assert.equal(Number(consultores.soma), 1000)
})

test('arquivo conjunto importa metas e classifica MIX pelo código SAP', async () => {
  const database = testDatabase()
  const response = await onRequestPost({
    request: new Request('https://painel.local/api/admin/bases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({
        tipo: 'metas_mix',
        nome_arquivo: '3. EMS_TERRITORIO_METAS FINAIS_AGO26.xlsx',
        ano_mes: '2026-08',
        rows: [
          { colaborador: 'ALESSANDRA FREITAS SA', cargo: 'G DISTRITAL', escopo: 'gerente', ol_sem_combate: 1181736.31, ol_prioritarios: 571915.53, ol_lancamentos: 192920.13, demanda_sem_combate: 1035977.59 },
          { colaborador: 'MAURICIO BARROS DE AGUIAR', cargo: 'CONSULTOR VENDAS', escopo: 'consultor', ol_sem_combate: 195027, ol_prioritarios: 96694.98, ol_lancamentos: 33622.94, demanda_sem_combate: 182566.97 },
        ],
        mix_rows: [
          { cod_sap: 10018, molecula: 'BACITRACINA + NEOMICINA', produto: 'POMADA 15G', tipo_mix: 'COMBATE' },
          { cod_sap: 10086, molecula: 'CLARITROMICINA', produto: 'CLARITROMICINA 500MG', tipo_mix: 'PRIORITARIOS' },
          { cod_sap: 37063, molecula: 'APIXABANA', produto: 'APIXABANA 2,5MG', tipo_mix: 'LANÇAMENTOS' },
          { cod_sap: 99999, molecula: 'NOVO PRODUTO', produto: 'AINDA SEM VENDA', tipo_mix: 'LANÇAMENTOS' },
        ],
      }),
    }),
    env: { DB: database, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  assert.equal(result.metas.consultores, 1)
  assert.equal(result.produtos_mix.total, 4)
  assert.equal(result.produtos_mix.classificados, 3)
  assert.equal(result.produtos_mix.nao_encontrados, 1)

  const products = await database.prepare("SELECT sku,tipo_mix FROM produtos WHERE sku IN ('10018','10086','37063') ORDER BY sku").all()
  assert.deepEqual(products.results, [
    { sku: '10018', tipo_mix: 'COMBATE' },
    { sku: '10086', tipo_mix: 'PRIORITARIO' },
    { sku: '37063', tipo_mix: 'LANCAMENTO' },
  ])
  const mapping = await database.prepare('SELECT COUNT(*) total FROM produtos_mix_sap WHERE ativo=1').first()
  assert.equal(Number(mapping.total), 4)
})
