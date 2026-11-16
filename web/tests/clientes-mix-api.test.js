import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionToken } from '../functions/_lib/credentials.js'
import { testDatabase } from './d1-fixture.js'
import { onRequestGet as getExcel } from '../functions/api/clientes/exportar-mix.js'

test('exportação exige sessão, aplica filtros e inclui Bússola dos três meses', async t => {
  t.mock.timers.enable({ apis:['Date'], now:new Date('2026-11-16T15:00:00Z') })
  const DB=testDatabase()
  await DB.prepare("INSERT INTO produtos(id,ean,sku,descricao,tipo_mix,ativo) VALUES ('novo','7892222222222','200','Genérico lançamento','LANCAMENTO',1)").run()
  await DB.prepare("INSERT INTO pedidos(id,pedido_origem,cliente_id,consultor_id,data_pedido,data_faturamento,status,valor_faturado,origem,ativo) VALUES ('set','S','cl1','co1','2026-09-15','2026-09-15','FATURADO',10,'BUSSOLA',0),('out','O','cl1','co1','2026-10-15','2026-10-15','FATURADO',8,'BUSSOLA',0),('nov','N','cl1','co1','2026-11-12','2026-11-12','FATURADO',2,'BUSSOLA',1),('not-paid','NP','cl1','co1','2026-11-12','2026-11-12','ENVIADO',500,'BUSSOLA',1)").run()
  await DB.prepare("INSERT INTO itens_pedido(id,pedido_id,produto_id,ean,descricao,quantidade_faturada,valor_faturado,ativo) VALUES ('is','set','prioritario','222','Prioritário',10,10,0),('io','out','prioritario','222','Prioritário',8,8,0),('in','nov','prioritario','222','Prioritário',2,2,1),('iu','not-paid','prioritario','222','Prioritário',500,500,1)").run()
  const env={DB,PAINEL_ADMIN_KEY:'excel-secret'}
  const url='https://painel.local/api/clientes/exportar-mix?busca=Farm%C3%A1cia%20A&uf=PA'
  const fail=await getExcel({request:new Request(url),env})
  assert.equal(fail.status,401)
  const cookie=await createSessionToken({login:'ana',nome:'Ana',consultor_id:'co1'},'excel-secret')
  const req=qs=>new Request(url+qs,{headers:{cookie:'painel_session='+cookie}})
  assert.equal((await getExcel({request:req('&consultor=outro'),env})).status,403)
  const ok=await getExcel({request:req(''),env})
  assert.equal(ok.status,200)
  assert.match(ok.headers.get('content-type'),/spreadsheetml/)
  const content=new TextDecoder().decode(await ok.arrayBuffer())
  assert.match(content,/Farmácia A/)
  assert.doesNotMatch(content,/Farmácia B/)
  assert.match(content,/01 11111111000111/)
  assert.doesNotMatch(content,/02 22222222000122/)
  assert.match(content,/<v>20<\/v>/)
  assert.doesNotMatch(content,/<v>520<\/v>/)
})
