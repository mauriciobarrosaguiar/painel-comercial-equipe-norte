import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { testDatabase } from './d1-fixture.js'
import { onRequestGet } from '../functions/api/desafio-gigantes.js'
import { onRequestGet as onRequestGestao } from '../functions/api/desafio-gigantes-gestao.js'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/AppShell.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/DesafioGigantesPage.tsx', import.meta.url), 'utf8')
const card = readFileSync(new URL('../src/DesafioGigantesCard.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../functions/api/desafio-gigantes.js', import.meta.url), 'utf8')
const management = readFileSync(new URL('../functions/api/desafio-gigantes-gestao.js', import.meta.url), 'utf8')
const bases = readFileSync(new URL('../functions/api/admin/bases.js', import.meta.url), 'utf8')

async function inserirMeta(DB, { id='dg1', escopo='consultor', consultor='co1', nome='Ana', setor='m0043497', sku='10018', ean='111', metaPos=1, metaGiro=1 }={}) {
  await DB.prepare("INSERT INTO desafio_gigantes_produtos(sku,ean,produto,status,atualizado_em) VALUES(?,?,?,'IDENTIFICADO','2026-07-01') ON CONFLICT(sku) DO UPDATE SET ean=excluded.ean,status='IDENTIFICADO'").bind(sku,ean,'Linha').run()
  await DB.prepare("INSERT INTO desafio_gigantes_metas(id,ano_mes,escopo,consultor_id,nome_colaborador,setor,sku,produto_planilha,meta_positivacao,meta_giro,ean,produto_identificado,status_identificacao,atualizado_em) VALUES(?,'2026-07',?,?,?,?,?,'Linha',?,?,?,'Linha','IDENTIFICADO','2026-07-01')").bind(id,escopo,consultor,nome,setor,sku,metaPos,metaGiro,ean).run()
}

async function carregar(DB, query='ano_mes=2026-07&consultor=co1') {
  const response = await onRequestGet({ request: new Request(`https://painel.test/api/desafio-gigantes?${query}`), env: { DB } })
  assert.equal(response.status, 200)
  return response.json()
}

test('Desafio de Gigantes fica em menu próprio, mostra consultores e importação aciona SAP', () => {
  assert.match(app, /Desafio de Gigantes/)
  assert.match(app, /'Desafio de Gigantes': 'desafio'/)
  assert.doesNotMatch(app, /<DesafioGigantesCard/)
  assert.match(shell, /DesafioGigantesPage/)
  assert.match(page, /Equipe Norte/)
  assert.match(page, /Consultores/)
  assert.match(page, /SapCorrectionPanel/)
  assert.match(management, /saps_problema/)
  assert.match(management, /corrigir_sap/)
  assert.match(bases, /acionarSapAposImportacao/)
  assert.match(bases, /desafio_gigantes/)
})

test('oportunidade prioriza o SKU mais perto de atingir 80 por cento', () => {
  assert.match(api, /a\.falta_pdv_80 - b\.falta_pdv_80/)
  assert.match(api, /alvo_positivacao_80/)
  assert.match(card, /Mais perto de destravar pontos/)
  assert.match(card, /faltam \{foco\.falta_pdv_80\} PDV/)
  assert.match(card, /data-label="Faltam p\/80%"/)
})

test('regras oficiais usam 80% na Positivação, 100% no Giro, teto 120 e máximo 240 por SKU', () => {
  assert.match(api, /GATILHO_POSITIVACAO = 80/)
  assert.match(api, /GATILHO_GIRO = 100/)
  assert.match(api, /TETO_PERCENTUAL = 120/)
  assert.match(api, /PONTOS_MAXIMOS_POR_SKU = 240/)
  assert.doesNotMatch(api, /atingGiro,\s*0\.4/)
  assert.match(card, /120 Positivação \+ 120 Giro/)
  assert.match(card, /acima de \{teto\}% continua valendo no máximo/)
  assert.match(card, /Giro atingido ≥100%/)
  assert.match(card, /Giro pontuando/)
  assert.match(page, /Giro ≥100%/)
  assert.match(page, /Giro pontuando/)
})

test('API calcula 100 pontos de Positivação + 100 de Giro quando ambas estão em 100%', async () => {
  const DB = testDatabase()
  await inserirMeta(DB)
  const body = await carregar(DB)
  assert.equal(body.skus, 1)
  assert.equal(body.identificados, 1)
  assert.equal(body.pos_80, 1)
  assert.equal(body.giro_bruto_100, 1)
  assert.equal(body.giro_100, 1)
  assert.equal(body.pontuacao_estimada, 200)
  assert.equal(body.maximo_estimado, 240)
  assert.equal(body.oportunidades.length, 0)
  assert.match(body.aviso, /CDD\/Close-Up/)
})

test('resultado acima de 120% fica limitado a 120 pontos em cada indicador', async () => {
  const DB = testDatabase()
  await inserirMeta(DB,{metaPos:0.5,metaGiro:0.1})
  const body = await carregar(DB)
  assert.equal(body.giro_bruto_100, 1)
  assert.equal(body.giro_bruto_120, 1)
  assert.equal(body.pontuacao_estimada, 240)
  assert.equal(body.maximo_estimado, 240)
})

test('Giro acima de 100% aparece como atingido mas não pontua enquanto Positivação estiver abaixo de 80%', async () => {
  const DB = testDatabase()
  await inserirMeta(DB,{metaPos:2,metaGiro:0.1})
  const body = await carregar(DB)
  assert.equal(body.pos_80, 0)
  assert.equal(body.giro_bruto_100, 1)
  assert.equal(body.giro_100, 0)
  assert.equal(body.pontuacao_estimada, 0)
  assert.equal(body.oportunidades[0].atingimento_giro > 120, true)
  assert.equal(body.oportunidades[0].giro_atingido, true)
  assert.equal(body.oportunidades[0].pontos_giro, 0)
  assert.equal(body.oportunidades[0].atingimento_giro_considerado, 0)
})

test('quantidade atendida sem faturamento não positiva PDV nem aumenta Giro', async () => {
  const DB = testDatabase()
  await inserirMeta(DB)
  await DB.prepare("INSERT INTO pedidos VALUES('p-extra','PX','NFX','cl2','co1','2026-07-14','2026-07-14','FATURADO',0,'BUSSOLA',1,'2026-07-14')").run()
  await DB.prepare("INSERT INTO itens_pedido(id,pedido_id,produto_id,ean,descricao,quantidade_atendida,quantidade_faturada,valor_faturado,ativo) VALUES('i-extra','p-extra','linha','111','Linha',999,0,0,1)").run()
  const body = await carregar(DB)
  assert.equal(body.pos_80, 1)
  assert.equal(body.pontuacao_estimada, 200)
})

test('consolidado da GD considera apenas PDVs vinculados àquela GD', async () => {
  const DB = testDatabase()
  await inserirMeta(DB,{id:'dg-gd',escopo:'gerente',consultor:null,nome:'GD Norte',setor:'18150300',metaPos:1,metaGiro:1})
  await DB.prepare("INSERT INTO consultores VALUES('co2','Bia','PA',1,'PAINEL_EQUIPE','2026-07-01')").run()
  await DB.prepare("INSERT INTO clientes(id,cnpj,nome_fantasia,cidade,uf,consultor_id,nome_gd,ativo,carteira_importada,setor_rep) VALUES('cl3','33333333000133','Farmácia Sul','Belém','PA','co2','GD Sul',1,1,'m0043500')").run()
  await DB.prepare("INSERT INTO pedidos VALUES('p-sul','PS','NFS','cl3','co2','2026-07-15','2026-07-15','FATURADO',1000,'BUSSOLA',1,'2026-07-15')").run()
  await DB.prepare("INSERT INTO itens_pedido(id,pedido_id,produto_id,ean,descricao,quantidade_faturada,valor_faturado,ativo) VALUES('i-sul','p-sul','linha','111','Linha',100,1000,1)").run()
  const body = await carregar(DB,'ano_mes=2026-07')
  assert.equal(body.escopo, 'gerente')
  assert.equal(body.pos_80, 1)
  assert.equal(body.giro_bruto_100, 1)
  assert.equal(body.giro_100, 1)
  assert.equal(body.pontuacao_estimada, 200)
})

test('gestão sinaliza EAN vinculado a mais de um SAP para correção', async () => {
  const DB = testDatabase()
  await inserirMeta(DB,{id:'dup-1',sku:'11081',ean:'7896004732626'})
  await inserirMeta(DB,{id:'dup-2',sku:'37606',ean:'7896004732626'})
  const response = await onRequestGestao({ request:new Request('https://painel.test/api/desafio-gigantes-gestao?ano_mes=2026-07'), env:{DB} })
  assert.equal(response.status,200)
  const body = await response.json()
  assert.equal(body.identificacao.conflitos_ean,1)
  assert.equal(body.saps_problema.filter((item)=>item.status==='CONFLITO_EAN').length,2)
  assert.equal(body.alertas_qualidade.some((item)=>item.tipo==='EAN_DUPLICADO'),true)
})
