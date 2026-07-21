import assert from'node:assert/strict'
import test from'node:test'
import{onRequestGet as listar,onRequestPost as criar}from'../functions/api/automacoes.js'
import{onRequestGet as mercado}from'../functions/api/mercado-farma.js'
import{onRequestPost as fechar}from'../functions/api/internal/fechamento-mensal.js'
import{onRequestGet as historico}from'../functions/api/historico.js'
import{testDatabase}from'./d1-fixture.js'
const key='chave-administrativa-teste'
const req=(url,method='GET',body)=>new Request(url,{method,headers:{'content-type':'application/json','x-admin-key':key},body:body?JSON.stringify(body):undefined})
test('registra automação e impede duplicidade ativa',async()=>{const DB=testDatabase(),env={DB,PAINEL_ADMIN_KEY:key};assert.equal((await criar({request:req('https://x/api/automacoes','POST',{tipo:'BUSSOLA'}),env})).status,202);assert.equal((await criar({request:req('https://x/api/automacoes','POST',{tipo:'BUSSOLA'}),env})).status,409);const body=await(await listar({env})).json();assert.equal(body.comandos.length,1)})
test('Mercado Farma calcula menor preço com estoque',async()=>{const body=await(await mercado({request:new Request('https://x/api/mercado-farma?uf=PA'),env:{DB:testDatabase()}})).json();assert.equal(body.resumo.produtos,1);assert.equal(body.resultados.length,2);assert.equal(body.resultados[0].melhor_preco,10)})
test('fechamento mensal grava fotografia consultável',async()=>{const DB=testDatabase(),env={DB,PAINEL_ADMIN_KEY:key},r=await fechar({request:req('https://x/api/internal/fechamento-mensal','POST',{ano_mes:'2026-07'}),env});assert.equal(r.status,200);const fechado=await r.json();assert.ok(fechado.registros>=4);const body=await(await historico({request:new Request('https://x/api/historico?ano_mes=2026-07'),env})).json();assert.equal(body.geral.length,1);assert.equal(body.geral[0].resultado.ol_total,200);assert.equal(body.geral[0].resultado.ol_sem_combate,150)})
