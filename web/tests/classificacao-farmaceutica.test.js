import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionToken } from '../functions/_lib/credentials.js'
import { categoriaFarmaceutica } from '../functions/_lib/classificacao-farmaceutica.js'
import { onRequestPost as salvar } from '../functions/api/mercado-farma-classificacao.js'
import { onRequestGet as consultar } from '../functions/api/mercado-farma.js'
import { onRequestGet as excel } from '../functions/api/mercado-farma-excel.js'
import { testDatabase } from './d1-fixture.js'

const KEY = 'chave-administrativa-segura'
const URL = 'https://painel.local'
const EAN = '7896004718811'
const EAN2 = '7896004718828'

function adicionarOfertas(DB) {
  return Promise.all([EAN, EAN2].map((ean, index) => DB.prepare(`
    INSERT INTO mercado_farma_precos
    (id,uf,ean,produto,distribuidora,estoque,desconto,pf_distribuidora,pf_fabrica,preco_com_imposto,preco_sem_imposto,status,atualizado_em)
    VALUES(?,?,?,?,?,10,0,20,20,18,17,'OK','2026-11-13T10:00:00Z')
  `).bind(`farm-${index}`, 'TO', ean, `Produto Exemplo ${index}`, 'Distribuidora TO').run()))
}

async function token() {
  return createSessionToken({ login: 'm0043497', nome: 'Ana', consultor_id: 'co1' }, KEY)
}
function requestGet(path, session) {
  return new Request(URL + path, { headers: { cookie: `painel_session=${session}` } })
}
function requestPost(items, session) {
  return new Request(URL + '/api/mercado-farma-classificacao', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: `painel_session=${session}`, origin: URL },
    body: JSON.stringify({ itens: items }),
  })
}

test('classificacao nao depende de nome comercial nem do MIX', () => {
  assert.equal(categoriaFarmaceutica('mip'), 'OTC')
  assert.equal(categoriaFarmaceutica('sob prescrição'), 'PRESCRICAO')
  assert.equal(categoriaFarmaceutica('antibiótico'), 'ANTIMICROBIANO')
  assert.equal(categoriaFarmaceutica('combate'), null)
  assert.equal(categoriaFarmaceutica('lancamento'), null)
})

test('filtra controlados e OTC por EAN sem afetar estoque, UF e distribuidores', async () => {
  const DB = testDatabase()
  await adicionarOfertas(DB)
  const session = await token()
  const env = { DB, PAINEL_ADMIN_KEY: KEY }
  const initial = await consultar({ request: requestGet('/api/mercado-farma?uf=TO', session), env })
  assert.equal(initial.status, 200)
  const initialJson = await initial.json()
  assert.ok(initialJson.resultados.some(r => r.ean === EAN && r.categoria_farmaceutica === 'NAO_CLASSIFICADO'))

  const write = await salvar({ request: requestPost([
    { ean: EAN, categoria: 'CONTROLADO', fonte: 'Portaria 344/1998 — conferência da apresentação' },
    { ean: EAN2, categoria: 'OTC', fonte: 'LMIP — conferência da apresentação' },
  ], session), env })
  assert.equal(write.status, 200)
  assert.equal((await write.json()).atualizados, 2)

  const ctl = await consultar({ request: requestGet('/api/mercado-farma?uf=TO&categoria=CONTROLADO&estoque=1', session), env })
  const ctlBody = await ctl.json()
  assert.equal(ctl.status, 200)
  assert.deepEqual([...new Set(ctlBody.resultados.map(r => r.ean))], [EAN])
  assert.ok(ctlBody.resultados.every(r => r.uf === 'TO' && r.estoque > 0 && r.categoria_farmaceutica === 'CONTROLADO'))
  assert.equal(ctlBody.resumo.produtos, 1)

  const otc = await consultar({ request: requestGet('/api/mercado-farma?uf=TO&categoria=MIP', session), env })
  assert.deepEqual([...new Set((await otc.json()).resultados.map(r => r.ean))], [EAN2])
  const pendentes = await consultar({ request: requestGet('/api/mercado-farma?uf=PA&categoria=NAO_CLASSIFICADO', session), env })
  assert.ok((await pendentes.json()).resultados.length > 0)

  const exportado = await excel({ request: new Request(URL + '/api/mercado-farma-excel?uf=TO&categoria=CONTROLADO', { headers: { 'x-admin-key': KEY } }), env })
  assert.equal(exportado.status, 200)
  const conteudo = new TextDecoder().decode(new Uint8Array(await exportado.arrayBuffer()))
  assert.ok(conteudo.includes(EAN))
  assert.ok(!conteudo.includes(EAN2))
  assert.ok(conteudo.includes('CLASSIFICAÇÃO FARMACÊUTICA'))
})

test('impede gravar sem acesso, categoria desconhecida ou EAN malformado', async () => {
  const DB = testDatabase()
  const env = { DB, PAINEL_ADMIN_KEY: KEY }
  const session = await token()
  const semSessao = await salvar({ request: requestPost([{ ean: EAN, categoria: 'OTC', fonte: 'Teste' }], 'falso'), env })
  assert.equal(semSessao.status, 401)
  const categoria = await salvar({ request: requestPost([{ ean: EAN, categoria: 'LINHA', fonte: 'Teste' }], session), env })
  assert.equal(categoria.status, 400)
  const ean = await salvar({ request: requestPost([{ ean: '99', categoria: 'OTC', fonte: 'Teste' }], session), env })
  assert.equal(ean.status, 400)
  const desconhecida = await consultar({ request: requestGet('/api/mercado-farma?categoria=LINHA', session), env })
  assert.equal(desconhecida.status, 400)
})
