import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionToken } from '../functions/_lib/credentials.js'
import { mesAtualBrasilia, validarMix, validarRanking, aplicarRankingVendas } from '../functions/_lib/mercado-farma-comercial.js'
import { onRequestGet as mercadoFarma } from '../functions/api/mercado-farma-v2.js'
import { onRequestGet as excelMercadoFarma } from '../functions/api/mercado-farma-excel-v3.js'
import { testDatabase } from './d1-fixture.js'

const KEY = 'teste-mercado-farma-filtro-mix-ranking'
const HOST = 'https://painel.local'

async function setup() {
  const DB = testDatabase()
  const session = await createSessionToken({ login: 'm0043497', nome: 'Ana', consultor_id: 'co1' }, KEY)
  const env = { DB, PAINEL_ADMIN_KEY: KEY }
  await DB.prepare("INSERT INTO produto_classificacao_farmaceutica(ean,categoria,fonte,atualizado_por,atualizado_em) VALUES('111','CONTROLADO','TESTE','ana','2026-11-01'),('222','OTC','TESTE','ana','2026-11-01')").run()
  await DB.prepare("INSERT INTO mercado_farma_precos VALUES ('mf-pri','PA','111','prioritario','222','Prioritário','Distribuidora A',80,0,13,16,12,11,'OK','','2026-11-01'),('mf-comb','PA','111','combate','333','Combate','Distribuidora B',0,0,14,16,13,12,'OK','','2026-11-01'),('mf-lin2','TO','111','linha','111','Linha','Distribuidora TO',6,0,12,14,10,9,'OK','','2026-11-01')").run()
  const atual = mesAtualBrasilia()
  const anterior = new Date(Date.UTC(Number(atual.mes.slice(0,4)), Number(atual.mes.slice(5,7)) - 1, 0)).toISOString().slice(0,10)
  async function pedido(id, ean, units, valor, data, status='FATURADO', origem='BUSSOLA', ativo=1) {
    await DB.prepare("INSERT INTO pedidos(id,pedido_origem,nota_fiscal,cliente_id,consultor_id,data_pedido,data_faturamento,status,valor_faturado,origem,ativo,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,id,id,'cl1','co1',data,data,status,valor,origem,ativo,data).run()
    await DB.prepare("INSERT INTO itens_pedido(id,pedido_id,produto_id,ean,descricao,quantidade_faturada,valor_faturado,ativo) VALUES(?,?,?,?,?,?,?,1)")
      .bind('item-'+id,id,ean==='111'?'linha':ean==='222'?'prioritario':'combate',ean,'Item teste',units,valor).run()
  }
  await pedido('bo1','111',9,90,atual.inicio)
  await pedido('bo2','111',-4,-40,atual.inicio)
  await pedido('bo3','222',3,180,atual.inicio)
  await pedido('bo4','333',15,750,atual.inicio)
  await pedido('bo5','222',100,1000,anterior)
  await pedido('bo6','222',200,2000,atual.inicio,'ENVIADO')
  await pedido('bo7','111',300,3000,atual.inicio,'FATURADO','HISTORICO')
  await pedido('bo8','111',400,4000,atual.inicio,'FATURADO','BUSSOLA',0)
  return { DB, env, session, atual }
}

const req = (path, session) => new Request(HOST+path, {
  headers: { ...(session ? { cookie: `painel_session=${session}` } : {}) },
})

test('MIX vem do cadastro EMS/SAP, sem confundir tipo sanitário e respeitando UF/distribuidora', async () => {
  const { DB,env,session } = await setup()
  assert.equal(validarMix('PRIORITARIO'), 'PRIORITARIO')
  assert.equal(validarMix('invalid'), null)
  const linha = await mercadoFarma({ request: req('/api/mercado-farma?uf=PA&mix=LINHA&categoria=CONTROLADO&distribuidora=Distribuidora%20A', session), env })
  assert.equal(linha.status, 200)
  const linhaBody = await linha.json()
  assert.ok(linhaBody.resultados.length)
  assert.ok(linhaBody.resultados.every(item => item.ean === '111' && item.tipo_mix === 'LINHA' && item.categoria_farmaceutica === 'CONTROLADO'))
  const prior = await mercadoFarma({ request: req('/api/mercado-farma?uf=PA&mix=PRIORITARIO', session), env })
  assert.deepEqual([...new Set((await prior.json()).resultados.map(item => item.ean))], ['222'])
  const combate = await mercadoFarma({ request: req('/api/mercado-farma?uf=PA&mix=COMBATE&estoque=1', session), env })
  assert.equal((await combate.json()).resultados.length, 0)
  await DB.prepare("INSERT INTO produtos_mix_sap(sku,molecula,descricao,tipo_mix,ativo) VALUES ('10086','Teste','Prioritário','LANCAMENTO',1)").run()
  const lancamento = await mercadoFarma({ request: req('/api/mercado-farma?uf=PA&mix=LANCAMENTO', session), env })
  assert.ok((await lancamento.json()).resultados.some(item => item.ean === '222' && item.tipo_mix === 'LANCAMENTO'))
  const invalido = await mercadoFarma({ request: req('/api/mercado-farma?mix=controlado', session), env })
  assert.equal(invalido.status, 400)
})

test('Top 20 e top faturamento: apenas Bússola faturada do mês, unidades líquidas, sem duplicar ofertas', async () => {
  const { env, session, atual } = await setup()
  assert.equal(validarRanking('TOP50'), 'TOP50')
  assert.equal(validarRanking('GAP'), null)
  const top = await mercadoFarma({ request: req('/api/mercado-farma?uf=PA&mais_vendidos=TOP20&estoque=1', session), env })
  assert.equal(top.status, 200)
  const body = await top.json()
  assert.equal(body.ranking.mes, atual.mes)
  assert.deepEqual([...new Set(body.resultados.map(row => row.ean))], ['111','222'])
  assert.equal(body.resumo.produtos, 2)
  assert.equal(body.resumo.registros, 2)
  assert.equal(body.resultados[0].unidades_mes, 5)
  assert.equal(body.resultados[0].ranking_mes, 1)
  assert.equal(body.resultados[1].unidades_mes, 3)
  assert.equal(body.resultados[1].ranking_mes, 2)
  const porValor = await mercadoFarma({ request: req('/api/mercado-farma?uf=PA&mais_vendidos=TOP20_VALOR&estoque=1', session), env })
  const valorBody = await porValor.json()
  assert.deepEqual([...new Set(valorBody.resultados.map(row => row.ean))], ['222','111'])
  assert.equal(valorBody.resultados[0].valor_mes, 180)
  const combinados = await mercadoFarma({ request: req('/api/mercado-farma?uf=PA&categoria=OTC&mix=PRIORITARIO&mais_vendidos=TOP20',session), env })
  const combos = await combinados.json()
  assert.deepEqual([...new Set(combos.resultados.map(x=>x.ean))], ['222'])
  const semSessao = await mercadoFarma({ request: req('/api/mercado-farma?mais_vendidos=TOP20'), env })
  assert.equal(semSessao.status, 401)
})

test('ranking opera sobre EAN distintos, aplica Top 20 após os filtros e mantém ofertas dos selecionados', () => {
  const rows = Array.from({length:30}, (_,i)=>({ean:String(i+1),produto:`Produto ${i+1}`,uf:'PA',distribuidora:'A'}))
    .flatMap(x=>[x, {...x,distribuidora:'B'}])
  const sales = Array.from({length:30},(_,i)=>({ean:String(i+1),unidades_mes:i+1,valor_mes:(i+1)*3}))
  const selected = aplicarRankingVendas(rows,sales,'TOP20')
  assert.equal(new Set(selected.map(x=>x.ean)).size,20)
  assert.equal(selected.length,40)
  assert.equal(selected[0].ean,'30')
  assert.equal(selected[0].ranking_mes,1)
  assert.equal(selected.at(-1).ean,'11')
  const onlyLine = aplicarRankingVendas(rows.filter(x=>Number(x.ean)<=5),sales,'TOP20')
  assert.equal(new Set(onlyLine.map(x=>x.ean)).size,5)
})

test('Excel respeita UF, tipo sanitário, MIX, estoque e Mais vendidos', async () => {
  const {env, session} = await setup()
  const url = HOST + '/api/mercado-farma-excel?uf=PA&mix=PRIORITARIO&categoria=OTC&mais_vendidos=TOP20&estoque=1'
  const response = await excelMercadoFarma({ request: req(url.slice(HOST.length),session), env })
  assert.equal(response.status,200)
  const archive = new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()))
  assert.ok(archive.includes('MIX COMERCIAL'))
  assert.ok(archive.includes('UNIDADES VENDIDAS (MÊS)'))
  assert.ok(archive.includes('POSIÇÃO NO MÊS'))
  assert.ok(archive.includes('Prioritário'))
  assert.ok(!archive.includes('Distribuidora TO'))
  assert.ok(!archive.includes('Distribuidora B'))
  assert.ok(archive.includes('<autoFilter ref="A3:P'))
  const erroMix = await excelMercadoFarma({request:req('/api/mercado-farma-excel?mix=INDEFINIDO',session),env})
  assert.equal(erroMix.status,400)
})
