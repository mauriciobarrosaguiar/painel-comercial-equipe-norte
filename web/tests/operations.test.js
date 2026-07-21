import assert from 'node:assert/strict'
import test from 'node:test'
import {onRequestGet as listarAutomacoes,onRequestPost as criarAutomacao} from '../functions/api/automacoes.js'
import {onRequestGet as mercado} from '../functions/api/mercado-farma.js'
import {onRequestPost as fechar} from '../functions/api/internal/fechamento-mensal.js'
import {onRequestGet as historico} from '../functions/api/historico.js'
import {testDatabase} from './d1-fixture.js'

const chave='chave-administrativa-teste'
const request=(url,method='GET',body)=>new Request(url,{method,headers:{'content-type':'application/json','x-admin-key':chave},body:body?JSON.stringify(body):undefined})

test('central registra uma automação e impede duplicidade ativa',async()=>{
 const DB=testDatabase(),env={DB,PAINEL_ADMIN_KEY:chave}
 const primeira=await criarAutomacao({request:request('https://painel.local/api/automacoes','POST',{tipo:'BUSSOLA'}),env})
 assert.equal(primeira.status,202)
 const segunda=await criarAutomacao({request:request('https://painel.local/api/automacoes','POST',{tipo:'BUSSOLA'}),env})
 assert.equal(segunda.status,409)
 const lista=await listarAutomacoes({env}),body=await lista.json()
 assert.equal(body.comandos.length,1)
 assert.equal(body.comandos[0].tipo,'BUSSOLA')
})

test('Mercado Farma retorna preços e melhor preço com estoque',async()=>{
 const response=await mercado({request:new Request('https://painel.local/api/mercado-farma?uf=PA'),env:{DB:testDatabase()}})
 assert.equal(response.status,200)
 const body=await response.json()
 assert.equal(body.resumo.produtos,1)
 assert.equal(body.resultados.length,2)
 assert.equal(body.resultados[0].melhor_preco,10)
})

test('fechamento grava fotografia mensal e histórico a consulta',async()=>{
 const DB=testDatabase(),env={DB,PAINEL_ADMIN_KEY:chave}
 const response=await fechar({request:request('https://painel.local/api/internal/fechamento-mensal','POST',{ano_mes:'2026-07'}),env})
 assert.equal(response.status,200)
 const fechado=await response.json()
 assert.equal(fechado.ano_mes,'2026-07')
 assert.ok(fechado.registros>=4)
 const consulta=await historico({request:new Request('https://painel.local/api/historico?ano_mes=2026-07'),env})
 const body=await consulta.json()
 assert.equal(body.geral.length,1)
 assert.equal(body.geral[0].resultado.ol_total,200)
 assert.equal(body.geral[0].resultado.ol_sem_combate,150)
})
