import test from 'node:test'
import assert from 'node:assert/strict'
import readXlsxFile from 'read-excel-file/node'
import { createSessionToken } from '../functions/_lib/credentials.js'
import { testDatabase } from './d1-fixture.js'
import { prepararCatalogoMix, comporPlanilhaClientes, aplicarEstoquePorDistribuidora, workbookClientesMix } from '../functions/_lib/clientes-mix-excel.js'
import { periodoTresMesesBrasilia } from '../functions/_lib/mercado-farma-comercial.js'
import { onRequestGet as exportar } from '../functions/api/clientes/exportar-mix.js'
import { onRequestGet as listarDistribuidoras } from '../functions/api/clientes/distribuidoras.js'

const period = periodoTresMesesBrasilia(new Date('2026-11-16T14:00:00Z'))

test('resume SKUs e soma apenas estoque dos EANs NÃO comprados na UF do cliente', () => {
  const catalogo=prepararCatalogoMix([
    {id:'p1',ean:'7890000000001',sku:'1',descricao:'Pri',tipo_mix:'PRIORITARIO'},
    {id:'p2',ean:'7890000000002',sku:'2',descricao:'Lanc',tipo_mix:'LANCAMENTO'},
    {id:'p3',ean:'',sku:'3',descricao:'Sem EAN',tipo_mix:'PRIORITARIO'},
  ])
  const rows = comporPlanilhaClientes([
    {cnpj:'11111111000111',nome:'Cliente TO',uf:'TO',cidade:'Palmas'},
    {cnpj:'22222222000122',nome:'Cliente MT',uf:'MT',cidade:'Confresa'},
  ],catalogo,[
    {cnpj:'11111111000111',ean:'7890000000001',mes:'2026-10',quantidade:10,pedidos:1},
  ],period)
  aplicarEstoquePorDistribuidora(rows,[
    {uf:'TO',ean:'7890000000001',distribuidora:'Nazaria',estoque:100},
    {uf:'TO',ean:'7890000000002',distribuidora:'Nazaria',estoque:25},
    {uf:'TO',ean:'7890000000002',distribuidora:'Profarma',estoque:0},
    {uf:'MT',ean:'7890000000001',distribuidora:'Nazaria',estoque:800},
    {uf:'MT',ean:'7890000000002',distribuidora:'Nazaria',estoque:40},
  ],['Nazaria','Profarma'])
  assert.equal(rows[0].prioritarios.comprados,1)
  assert.equal(rows[0].prioritarios.faltantes,1) // produto sem EAN
  assert.equal(rows[0].lancamentos.faltantes,1)
  assert.equal(rows[0].estoqueOportunidades.Nazaria,25) // não soma produto comprado
  assert.equal(rows[1].estoqueOportunidades.Nazaria,840) // UF MT sem compras
  assert.equal(rows[0].estoqueOportunidades.Profarma,0) // cotação com estoque zero
  assert.equal(rows[1].estoqueOportunidades.Profarma,null) // sem cotação: não mostrar zero
  const zip=workbookClientesMix(rows,period,{},['Nazaria','Profarma'])
  const xml=new TextDecoder().decode(zip)
  assert.ok(xml.includes('PRIORITÁRIOS COMPRADOS (SKUs)'))
  assert.ok(xml.includes('PRIORITÁRIOS NÃO COMPRADOS (SKUs)'))
  assert.ok(xml.includes('ESTOQUE P/ SKUs NÃO COMPRADOS · Nazaria (UN.)'))
  assert.ok(xml.includes('ESTOQUE Nazaria (UN.)'))
  assert.ok(xml.includes('—'))
})

test('UI distribuidores: API só devolve distribuidoras das UFs da carteira autenticada',async() => {
  const env={DB:testDatabase(),PAINEL_ADMIN_KEY:'excel-dist-auth'}
  const no=await listarDistribuidoras({request:new Request('https://painel.local/api/clientes/distribuidoras'),env})
  assert.equal(no.status,401)
  const token=await createSessionToken({login:'ana',nome:'Ana',consultor_id:'co1'},env.PAINEL_ADMIN_KEY)
  const result=await listarDistribuidoras({request:new Request('https://painel.local/api/clientes/distribuidoras?uf=PA',{headers:{cookie:'painel_session='+token}}),env})
  assert.equal(result.status,200)
  const json=await result.json()
  assert.deepEqual(json.distribuidoras.map(x=>x.nome),['Distribuidora A','Distribuidora B'])
  assert.ok(json.distribuidoras.every(x=>x.ufs.includes('PA')))
})

test('Excel real: somente distribuidoras escolhidas, últimas cotações, UF correta e estrutura legível',async t=>{
  t.mock.timers.enable({ apis:['Date'], now:new Date('2026-11-16T14:00:00Z') })
  const DB=testDatabase()
  await DB.prepare("INSERT INTO produtos(id,ean,sku,descricao,tipo_mix,ativo) VALUES('p-lan','7892222222222','789','Genérico lançamento 30cp','LANCAMENTO',1)").run()
  await DB.prepare("INSERT INTO mercado_farma_precos VALUES ('pa-1','PA','',NULL,'222','Prioritário','Distribuidora A',20,0,0,0,0,0,'OK','','2026-11-10T12:00:00Z'),('pa-2','PA','',NULL,'222','Prioritário','Distribuidora A',30,0,0,0,0,0,'OK','','2026-11-15T12:00:00Z'),('pa-3','PA','',NULL,'7892222222222','Lanc','Distribuidora A',15,0,0,0,0,0,'OK','','2026-11-15T12:00:00Z'),('pa-4','TO','',NULL,'222','Prioritário','Distribuidora A',900,0,0,0,0,0,'OK','','2026-11-15T12:00:00Z')").run()
  const env={DB,PAINEL_ADMIN_KEY:'excel-dist-test'}
  const token=await createSessionToken({login:'ana',nome:'Ana',consultor_id:'co1'},env.PAINEL_ADMIN_KEY)
  const make=url=>new Request('https://painel.local/api/clientes/exportar-mix?'+url,{headers:{cookie:'painel_session='+token}})
  const ok=await exportar({request:make('busca=Farm%C3%A1cia%20A&uf=PA&distribuidora=Distribuidora%20A'),env})
  assert.equal(ok.status,200)
  const sheets=await readXlsxFile(Buffer.from(await ok.arrayBuffer()))
  const summary=sheets.find(x=>x.sheet==='RESUMO').data
  const first=sheets.find(x=>x.sheet.startsWith('01 ')).data
  const summaryHeaders=summary.find(row=>row[0]==='Nº')
  assert.equal(summaryHeaders[5],'PRIORITÁRIOS COMPRADOS (SKUs)')
  assert.equal(summaryHeaders[6],'PRIORITÁRIOS NÃO COMPRADOS (SKUs)')
  assert.equal(summaryHeaders[11],'ESTOQUE P/ SKUs NÃO COMPRADOS · Distribuidora A (UN.)')
  assert.equal(summary[summary.indexOf(summaryHeaders)+1][11],45) // usa 30, não 20+30; +15 lançamento
  const productHeaders=first.find(row=>row[0]==='TIPO MIX')
  assert.equal(productHeaders[11],'ESTOQUE Distribuidora A (UN.)')
  assert.ok(!productHeaders.some(c=>String(c).includes('Distribuidora B')))
  const forbidden=await exportar({request:make('busca=Farm%C3%A1cia%20A&uf=PA&distribuidora=Inexistente'),env})
  assert.equal(forbidden.status,422)
})
