import assert from'node:assert/strict'
import test from'node:test'
import{onRequestPost as login}from'../functions/api/auth/login.js'
import{onRequestGet as session}from'../functions/api/auth/session.js'
import{testDatabase}from'./d1-fixture.js'
const key='chave-administrativa-teste'
test('colaborador entra com código ou e-mail EMS',async()=>{for(const acesso of['m0043497','m0043497@ems.com.br']){const response=await login({request:new Request('https://painel.local/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:acesso})}),env:{DB:testDatabase(),PAINEL_ADMIN_KEY:key}});assert.equal(response.status,200);const body=await response.json();assert.equal(body.usuario.nome,'Ana');assert.match(response.headers.get('set-cookie')||'',/painel_session=/)}})
test('sessão assinada libera o painel',async()=>{const DB=testDatabase(),result=await login({request:new Request('https://painel.local/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:'m0043497'})}),env:{DB,PAINEL_ADMIN_KEY:key}}),cookie=(result.headers.get('set-cookie')||'').split(';')[0],response=await session({request:new Request('https://painel.local/api/auth/session',{headers:{cookie}}),env:{DB,PAINEL_ADMIN_KEY:key}});assert.equal(response.status,200);assert.equal((await response.json()).usuario.login,'m0043497')})
