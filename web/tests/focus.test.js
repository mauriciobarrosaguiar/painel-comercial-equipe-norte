import assert from'node:assert/strict'
import test from'node:test'
import{onRequestGet,onRequestPost}from'../functions/api/foco-semanal.js'
import{testDatabase}from'./d1-fixture.js'
const key='chave-administrativa-teste'
test('Foco Semanal calcula clientes e faturamento pelo EAN',async()=>{const body=await(await onRequestGet({request:new Request('https://x/api/foco-semanal?inicio=2026-07-07&fim=2026-07-13'),env:{DB:testDatabase()}})).json();assert.equal(body.focos.length,1);assert.equal(body.focos[0].valor_faturado,100);assert.equal(body.focos[0].clientes_compraram,1);assert.equal(body.focos[0].clientes_sem_comprar,1);assert.equal(body.focos[0].cobertura_percentual,50)})
test('Foco Semanal exige chave e salva novo produto',async()=>{const DB=testDatabase(),env={DB,PAINEL_ADMIN_KEY:key},request=new Request('https://x/api/foco-semanal',{method:'POST',headers:{'content-type':'application/json','x-admin-key':key},body:JSON.stringify({semana_inicio:'2026-07-07',semana_fim:'2026-07-13',ean:'222',descricao:'Prioritário',meta_clientes:2,meta_valor:100})}),response=await onRequestPost({request,env});assert.equal(response.status,200);const body=await(await onRequestGet({request:new Request('https://x/api/foco-semanal?inicio=2026-07-07&fim=2026-07-13'),env})).json();assert.equal(body.focos.length,2)})
