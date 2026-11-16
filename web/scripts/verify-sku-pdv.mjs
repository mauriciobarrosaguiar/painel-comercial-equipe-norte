// Read-only production verification, run before publication using existing secrets.
import assert from 'node:assert/strict'
import { createTursoD1 } from '../functions/_lib/turso-d1.js'
import { createSessionToken } from '../functions/_lib/credentials.js'
import { MAURICIO_ID } from '../functions/_lib/personal-scope.js'
import { onRequestGet } from '../functions/api/sku-pdv.js'
const env={...process.env,DB:createTursoD1(process.env)}
const token=await createSessionToken({consultor_id:MAURICIO_ID,login:'m0043497'},env.PAINEL_ADMIN_KEY)
const mes=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date())
const request=new Request(`https://painel-equipe-norte.pages.dev/api/sku-pdv?mes=${mes}`,{headers:{cookie:`painel_session=${token}`}})
const response=await onRequestGet({request,env}); assert.equal(response.status,200)
const body=await response.json()
if(!body.disponivel) {
 console.log(JSON.stringify({mes,disponivel:false,mensagem:body.mensagem,atualizado_em:body.atualizado_em}))
} else {
 const s=body.resumo
 assert.equal(s.carteira,s.compradores+s.zerados)
 assert.ok(s.carteira>0)
 assert.ok(s.sem_combate<=s.total)
 for(const c of ['sem_combate','prioritarios','lancamentos','linha','total'])assert.ok(Math.abs(s[c]-s[`soma_${c}`]/s.carteira)<1e-9)
 const next=new Date(`${mes}-01T12:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1)
 // Independent raw CNPJ/EAN net grouping verifies that sum of client counts is the numerator.
 const net=await env.DB.prepare(`SELECT REPLACE(REPLACE(REPLACE(TRIM(cl.cnpj),'.',''),'/',''),'-','') cnpj,
 TRIM(COALESCE(NULLIF(TRIM(ip.ean),''),p.ean,'')) ean,SUM(ip.quantidade_faturada) unidades
 FROM pedidos pe JOIN clientes cl ON cl.id=pe.cliente_id JOIN itens_pedido ip ON ip.pedido_id=pe.id LEFT JOIN produtos p ON p.id=ip.produto_id
 WHERE cl.consultor_id=? AND cl.ativo=1 AND cl.carteira_importada=1 AND pe.consultor_id=? AND pe.origem='BUSSOLA' AND pe.ativo=1 AND ip.ativo=1
 AND UPPER(TRIM(pe.status)) IN ('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO') AND COALESCE(pe.data_faturamento,pe.data_pedido)>=? AND COALESCE(pe.data_faturamento,pe.data_pedido)<?
 GROUP BY 1,2 HAVING SUM(ip.quantidade_faturada)>0`).bind(MAURICIO_ID,MAURICIO_ID,`${mes}-01`,next.toISOString().slice(0,10)).all()
 const catalog=await env.DB.prepare('SELECT DISTINCT TRIM(ean) ean FROM produtos WHERE ativo=1').all()
 const eans=new Set(catalog.results.map(p=>p.ean));const valid=net.results.filter(r=>/^\d{14}$/.test(r.cnpj)&&r.cnpj!=='00000000000000'&&eans.has(r.ean))
 assert.equal(valid.length,s.soma_total)
 const exportResponse=await onRequestGet({request:new Request(`${request.url}&excel=1`,{headers:request.headers}),env})
 assert.equal(exportResponse.status,200);assert.equal(new Uint8Array(await exportResponse.arrayBuffer())[0],80)
 console.log(JSON.stringify({mes,atualizado_em:body.atualizado_em,...s,cruzamento_real:'aprovado',excel:'aprovado'}))
}
