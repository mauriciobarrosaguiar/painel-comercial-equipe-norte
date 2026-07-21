import assert from'node:assert/strict'
import test from'node:test'
import{onRequestGet as detalhe}from'../functions/api/sips/detalhe.js'
import{onRequestPost as cadastro}from'../functions/api/sips/cadastro.js'
import{testDatabase}from'./d1-fixture.js'
const ADMIN_KEY='chave-administrativa-teste'
test('ficha da SIP carrega clientes, notas e produtos',async()=>{const response=await detalhe({request:new Request('https://painel.local/api/sips/detalhe?id=sip1&inicio=2026-07-01&fim=2026-07-31'),env:{DB:testDatabase()}});assert.equal(response.status,200);const body=await response.json();assert.equal(body.sip.nome,'SIP Teste');assert.equal(body.totais.clientes_ativos,2);assert.equal(body.totais.clientes_com_venda,1);assert.equal(body.totais.ol_total,200);assert.equal(body.totais.notas_faturadas,1);assert.equal(body.totais.notas_canceladas,1);assert.equal(body.produtos.length,4);assert.match(body.link_exportacao,/sip_detalhado/)})
test('cadastro da SIP aceita acesso autenticado e salva registro',async()=>{const DB=testDatabase(),response=await cadastro({request:new Request('https://painel.local/api/sips/cadastro',{method:'POST',headers:{'content-type':'application/json','x-admin-key':ADMIN_KEY},body:JSON.stringify({nome:'SIP Nova',meta_mes:500,acesso_publico_ativo:true})}),env:{DB,PAINEL_ADMIN_KEY:ADMIN_KEY}});assert.equal(response.status,200);const body=await response.json(),saved=await DB.prepare('SELECT nome FROM sips WHERE id=?').bind(body.id).first();assert.equal(saved.nome,'SIP Nova')})
