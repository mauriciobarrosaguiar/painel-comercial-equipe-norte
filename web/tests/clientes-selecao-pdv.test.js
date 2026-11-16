import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionToken } from '../functions/_lib/credentials.js'
import { testDatabase } from './d1-fixture.js'
import { onRequestGet as opcoes } from '../functions/api/clientes/opcoes-pdv.js'
import { onRequestGet as listar } from '../functions/api/clientes.js'
import { onRequestGet as exportar } from '../functions/api/clientes/exportar-mix.js'

const secret = 'secret-teste-seletor-pdv'
const prefix = 'https://painel.local'

async function ambiente() {
  const DB = testDatabase()
  await DB.prepare("UPDATE clientes SET nome_fantasia='DROGARIAS ULTRA POPULAR CONFIRESA' WHERE id='cl1'").run()
  await DB.prepare("UPDATE clientes SET nome_fantasia='DROGARIAS ULTRA POPULAR PORTO' WHERE id='cl2'").run()
  await DB.prepare("INSERT INTO consultores(id,nome,uf,ativo,origem) VALUES('co2','Outro','TO',1,'PAINEL_EQUIPE')").run()
  await DB.prepare("INSERT INTO clientes(id,cnpj,nome_fantasia,cidade,uf,consultor_id,ativo,carteira_importada) VALUES('cl3','33333333000133','DROGARIAS ULTRA POPULAR TERCEIRO','Palmas','TO','co2',1,1)").run()
  const cookie = await createSessionToken({login:'ana',nome:'Ana',consultor_id:'co1'},secret)
  const env = { DB, PAINEL_ADMIN_KEY: secret }
  const req = query => new Request(prefix + query, { headers: { cookie: 'painel_session=' + cookie } })
  return {DB,env,req}
}

test('busca exibe todos PDVs correspondentes da carteira com CNPJ, sem vazar terceiros',async()=>{
  const {env,req}=await ambiente()
  const semLogin=await opcoes({request:new Request(prefix+'/api/clientes/opcoes-pdv?busca=ULTRA'),env})
  assert.equal(semLogin.status,401)
  const result=await opcoes({request:req('/api/clientes/opcoes-pdv?busca=ULTRA%20POPU'),env})
  assert.equal(result.status,200)
  const body=await result.json()
  assert.equal(body.pdvs.length,2)
  assert.equal(body.truncado,false)
  assert.deepEqual(body.pdvs.map(item=>item.cnpj),['11111111000111','22222222000122'])
  assert.ok(body.pdvs.every(item=>item.nome.includes('ULTRA POPULAR')))
})

test('selecionar e retirar PDVs altera totais e paginação sem misturar outros CNPJs',async()=>{
  const {env,req}=await ambiente()
  const todos=await listar({request:req('/api/clientes?busca=ULTRA%20POPU'),env})
  assert.equal((await todos.json()).paginacao.total,3) // inclui terceiro no filtro geral legado
  const um=await listar({request:req('/api/clientes?selecionados=22222222000122&busca=OUTRA'),env})
  assert.equal(um.status,200)
  const body=await um.json()
  assert.equal(body.paginacao.total,1)
  assert.equal(body.resumo.clientes_ativos,1)
  assert.equal(body.clientes[0].cnpj,'22222222000122')
  const zero=await listar({request:req('/api/clientes?selecionados='),env})
  assert.equal(zero.status,200)
  assert.equal((await zero.json()).paginacao.total,0)
  const semPermissao=await listar({request:req('/api/clientes?selecionados=33333333000133'),env})
  assert.equal((await semPermissao.json()).paginacao.total,0)
  const invalido=await listar({request:req('/api/clientes?selecionados=1234'),env})
  assert.equal(invalido.status,400)
})

test('exportação de MIX gera somente aba do PDV escolhido após retirar outro',async t=>{
  t.mock.timers.enable({apis:['Date'], now:new Date('2026-11-16T15:00:00Z')})
  const {env,req}=await ambiente()
  const res=await exportar({request:req('/api/clientes/exportar-mix?busca=ULTRA%20POPU&selecionados=22222222000122&periodo=mes-atual'),env})
  assert.equal(res.status,200)
  const payload=new TextDecoder().decode(await res.arrayBuffer())
  assert.ok(payload.includes('22222222000122'))
  assert.ok(!payload.includes('11111111000111'))
  assert.ok(!payload.includes('33333333000133'))
  assert.ok(payload.includes('RESUMO'))
  const none=await exportar({request:req('/api/clientes/exportar-mix?selecionados='),env})
  assert.equal(none.status,404)
})
