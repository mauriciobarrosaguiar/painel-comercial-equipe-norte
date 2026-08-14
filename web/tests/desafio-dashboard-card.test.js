import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { testDatabase } from './d1-fixture.js'
import { onRequestGet } from '../functions/api/desafio-gigantes.js'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/AppShell.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/DesafioGigantesPage.tsx', import.meta.url), 'utf8')
const card = readFileSync(new URL('../src/DesafioGigantesCard.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../functions/api/desafio-gigantes.js', import.meta.url), 'utf8')
const management = readFileSync(new URL('../functions/api/desafio-gigantes-gestao.js', import.meta.url), 'utf8')
const bases = readFileSync(new URL('../functions/api/admin/bases.js', import.meta.url), 'utf8')

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

test('API calcula parcial gerencial por SKU identificado', async () => {
  const DB = testDatabase()
  await DB.prepare("INSERT INTO desafio_gigantes_produtos(sku,ean,produto,status,atualizado_em) VALUES('10018','111','Linha','IDENTIFICADO','2026-07-01')").run()
  await DB.prepare("INSERT INTO desafio_gigantes_metas(id,ano_mes,escopo,consultor_id,nome_colaborador,setor,sku,produto_planilha,meta_positivacao,meta_giro,ean,produto_identificado,status_identificacao,atualizado_em) VALUES('dg1','2026-07','consultor','co1','Ana','m0043497','10018','Linha',1,1,'111','Linha','IDENTIFICADO','2026-07-01')").run()
  const response = await onRequestGet({ request: new Request('https://painel.test/api/desafio-gigantes?ano_mes=2026-07&consultor=co1'), env: { DB } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.skus, 1)
  assert.equal(body.identificados, 1)
  assert.equal(body.pos_80, 1)
  assert.equal(body.giro_80, 1)
  assert.equal(body.pontuacao_estimada, 140)
  assert.match(body.aviso, /CDD\/Close-Up/)
})
