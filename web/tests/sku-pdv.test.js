import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { monthlyQuery, queryFilters } from '../functions/_lib/sku-pdv.js'
function fixture() {
 const db=new DatabaseSync(':memory:')
 db.exec(`CREATE TABLE clientes(id TEXT,cnpj TEXT,nome_fantasia TEXT,razao_social TEXT,consultor_id TEXT,ativo INTEGER,carteira_importada INTEGER);
 CREATE TABLE produtos(id TEXT,ean TEXT,sku TEXT,tipo_mix TEXT,ativo INTEGER); CREATE TABLE produtos_mix_sap(sku TEXT,tipo_mix TEXT,ativo INTEGER);
 CREATE TABLE pedidos(id TEXT,cliente_id TEXT,consultor_id TEXT,origem TEXT,ativo INTEGER,status TEXT,data_faturamento TEXT,data_pedido TEXT);
 CREATE TABLE itens_pedido(pedido_id TEXT,ean TEXT,produto_id TEXT,quantidade_faturada REAL,ativo INTEGER);`)
 for(let i=1;i<=4;i++)db.prepare('INSERT INTO clientes VALUES(?,?,?,?,?,?,?)').run(`c${i}`,`12345678000${i}90`,`Cliente ${i}`,'','mauricio',1,1)
 db.prepare('INSERT INTO clientes VALUES(?,?,?,?,?,?,?)').run('outro','12345678000990','Outro','','outro',1,1)
 for(let i=0;i<15;i++)db.prepare('INSERT INTO produtos VALUES(?,?,?,?,1)').run(`p${i}`,`78912345678${String(i).padStart(2,'0')}`,`sap${i}`,i===14?'COMBATE':i===13?'LANCAMENTO':i===12?'PRIORITARIO':'LINHA')
 let id=0
 const sale=(client,sku,qty=1,date='2026-11-10',status='FATURADO',active=1,origin='BUSSOLA')=>{const n=String(id++);db.prepare('INSERT INTO pedidos VALUES(?,?,?,?,?,?,?,?)').run(n,client,client==='outro'?'outro':'mauricio',origin,active,status,date,date);db.prepare('INSERT INTO itens_pedido VALUES(?,?,?,?,1)').run(n,`78912345678${String(sku).padStart(2,'0')}`,`p${sku}`,qty)}
 const query=(suffix='SELECT * FROM resultado',params=[])=>db.prepare(monthlyQuery()+suffix).all('mauricio','mauricio','mauricio','2026-11-01','2026-12-01',...params)
 return {db,sale,query}
}
test('A/C/G: média 6,25, zerado no divisor e EAN por cliente',()=>{
 const f=fixture();[10,8,7,0].forEach((n,i)=>{for(let e=0;e<n;e++)f.sale(`c${i+1}`,e)})
 const rows=f.query();assert.equal(rows.length,4);assert.equal(rows.reduce((s,r)=>s+r.sem_combate,0)/rows.length,6.25);assert.equal(rows[3].total,0)
})
test('B/D/E/F/H/K: repetição, mês, carteira, combate, cancelamento, saldo e snapshot repetido',()=>{
 const f=fixture();for(let i=0;i<5;i++)f.sale('c1',0)
 f.sale('c1',1,5);f.sale('c1',1,-5);f.sale('c1',2,2);f.sale('c1',2,-1)
 f.sale('c1',3,1,'2026-10-30');f.sale('outro',4);f.sale('c1',5,1,'2026-11-10','CANCELADO')
 f.sale('c1',6,1,'2026-11-10','FATURADO',0);f.sale('c1',7,1,'2026-11-10','FATURADO',1,'HISTORICO');f.sale('c1',14)
 const before=f.query();assert.equal(before[0].sem_combate,2);assert.equal(before[0].total,3)
 f.db.exec('UPDATE itens_pedido SET quantidade_faturada=quantidade_faturada');assert.deepEqual(f.query(),before)
})
test('sobreposição, CNPJ completo normalizado e deduplicado',()=>{
 const f=fixture();f.db.exec("INSERT INTO produtos_mix_sap VALUES('sap12','LANCAMENTO',1); INSERT INTO produtos_mix_sap VALUES('sap12','PRIORITARIO',1)")
 f.db.exec("INSERT INTO clientes VALUES('alias','12.345.678/0001-90','Alias','','mauricio',1,1)")
 f.sale('c1',12);const r=f.query().find(r=>r.cnpj==='12345678000190');assert.equal(f.query().length,4);assert.equal(r.prioritarios,1);assert.equal(r.lancamentos,1);assert.equal(r.sem_combate,1)
})
test('filtros, paginação e exportação de todos os clientes filtrados',()=>{
 const f=fixture();f.sale('c1',0);const filters=queryFilters(new URLSearchParams({situacao:'zerados',ordem:'total;DROP TABLE clientes'}));assert.equal(filters.order,'sem_combate ASC,cnpj ASC')
 assert.equal(f.query(`SELECT * FROM resultado${filters.where}`,filters.binds).length,3)
 assert.equal(f.query(`SELECT * FROM resultado${filters.where} LIMIT 1`,filters.binds).length,1)
})

import { onRequestGet } from '../functions/api/sku-pdv.js'
import { createSessionToken } from '../functions/_lib/credentials.js'
import { MAURICIO_ID } from '../functions/_lib/personal-scope.js'
test('L: sem extração e extração de outro mês são indisponíveis, sem média artificial',async()=>{
 const secret='test-only-sku-pdv-session-key'
 const token=await createSessionToken({login:"m0043497",consultor_id:MAURICIO_ID},secret)
 for(const meta of [null,{itens:10,invalidos:0,primeiro_mes:'2026-10',ultimo_mes:'2026-10',finalizado_em:'2026-10-31T12:00:00Z'},{itens:10,invalidos:1,primeiro_mes:'2026-11',ultimo_mes:'2026-11'}]){
 const res=await onRequestGet({request:new Request('https://test/api/sku-pdv?mes=2026-11',{headers:{cookie:`painel_session=${token}`}}),env:{PAINEL_ADMIN_KEY:secret,DB:{prepare:()=>({bind(){return this},first:async()=>meta})}}})
 assert.equal(res.status,200);const b=await res.json();assert.equal(b.disponivel,false);assert.equal(b.resumo,undefined)
 }
})
test('acesso restrito ao Maurício e mês inválido',async()=>{
 const secret='test-only-sku-pdv-session-key'
 const token=await createSessionToken({consultor_id:'outro'},secret)
 assert.equal((await onRequestGet({request:new Request('https://test/api/sku-pdv',{headers:{cookie:`painel_session=${token}`}}),env:{PAINEL_ADMIN_KEY:secret}})).status,401)
})

test('consulta mensal repete CTE somente em falha temporária e mantém o cálculo', async () => {
 const secret='test-only-sku-pdv-session-key'
 const token=await createSessionToken({login:'test',consultor_id:MAURICIO_ID},secret)
 let attempts=0
 const summary={carteira:4,compradores:2,soma_sem_combate:10,sem_combate:2.5,soma_total:12,total:3}
 const DB={prepare:()=>({bind(){return this},first:async()=>({itens:10,invalidos:0,primeiro_mes:'2026-11',ultimo_mes:'2026-11',finalizado_em:'2026-11-16T12:00:00Z'})}),batch:async()=>{
  if(++attempts===1)throw Object.assign(new Error('Turso HTTP 502'),{tursoTransient:true})
  return [{results:[summary]},{results:[{total:4}]},{results:[]}]
 }}
 const response=await onRequestGet({request:new Request('https://test/api/sku-pdv?mes=2026-11',{headers:{cookie:`painel_session=${token}`}}),env:{DB,PAINEL_ADMIN_KEY:secret}})
 assert.equal(response.status,200);assert.equal(attempts,2)
 const body=await response.json();assert.equal(body.resumo.sem_combate,2.5);assert.equal(body.resumo.zerados,2)
})

test('falha persistente do SKU/PDV retorna indisponibilidade, sem médias inventadas', async t => {
 t.mock.method(console,'error',()=>{})
 const secret='test-only-sku-pdv-session-key'
 const token=await createSessionToken({login:'test',consultor_id:MAURICIO_ID},secret)
 let attempts=0
 const DB={prepare:()=>({bind(){return this},first:async()=>({itens:10,invalidos:0,primeiro_mes:'2026-11',ultimo_mes:'2026-11'})}),batch:async()=>{attempts++;throw Object.assign(new Error('Turso HTTP 502'),{tursoTransient:true})}}
 const response=await onRequestGet({request:new Request('https://test/api/sku-pdv?mes=2026-11',{headers:{cookie:`painel_session=${token}`}}),env:{DB,PAINEL_ADMIN_KEY:secret}})
 assert.equal(response.status,503);assert.equal(attempts,3)
 assert.equal((await response.json()).resumo,undefined)
})
