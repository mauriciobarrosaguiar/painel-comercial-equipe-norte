import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { onRequestPost as editarSip } from '../functions/api/sips/editar.js'
import { onRequestGet as gerarExcelConsultores } from '../functions/api/consultores/resumo-xlsx.js'
import { onRequestGet as gerarPdfConsultores } from '../functions/api/consultores/resumo-pdf.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-teste-segura-123'
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('edição de SIP exige autenticação administrativa', async () => {
  const response = await editarSip({
    request: new Request('https://painel.local/api/sips/editar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sip_id: 'sip1', nome: 'SIP Atualizada', meta_mes: 1200 }),
    }),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })

  assert.equal(response.status, 401)
})

test('edição atualiza dados, remove e reativa CNPJs da SIP', async () => {
  const DB = testDatabase()
  await DB.prepare('UPDATE sip_clientes SET ativo=0 WHERE sip_id=? AND cnpj=?')
    .bind('sip1', '22222222000122').run()

  const response = await editarSip({
    request: new Request('https://painel.local/api/sips/editar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({
        sip_id: 'sip1',
        nome: 'SIP Norte Atualizada',
        meta_mes: 1200,
        pagamento_percentual: 85,
        acesso_publico_ativo: false,
        cnpjs_adicionar: ['22222222000122'],
        cnpjs_remover: ['11111111000111'],
      }),
    }),
    env: { DB, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.sucesso, true)
  assert.equal(body.cnpjs_vinculados, 1)

  const sip = await DB.prepare(
    'SELECT nome,meta_mes,pagamento_percentual,acesso_publico_ativo FROM sips WHERE id=?',
  ).bind('sip1').first()
  const removed = await DB.prepare(
    'SELECT ativo,objetivo_preco_liquido FROM sip_clientes WHERE sip_id=? AND cnpj=?',
  ).bind('sip1', '11111111000111').first()
  const added = await DB.prepare(
    'SELECT ativo,objetivo_preco_liquido FROM sip_clientes WHERE sip_id=? AND cnpj=?',
  ).bind('sip1', '22222222000122').first()

  assert.equal(sip.nome, 'SIP Norte Atualizada')
  assert.equal(Number(sip.meta_mes), 1200)
  assert.equal(Number(sip.pagamento_percentual), 85)
  assert.equal(Number(sip.acesso_publico_ativo), 0)
  assert.equal(Number(removed.ativo), 0)
  assert.equal(Number(removed.objetivo_preco_liquido), 0)
  assert.equal(Number(added.ativo), 1)
  assert.equal(Number(added.objetivo_preco_liquido), 1200)
})

test('Excel dos consultores é um XLSX real com visão agrupada', async () => {
  const response = await gerarExcelConsultores({
    request: new Request(
      'https://painel.local/api/consultores/resumo-xlsx?periodo=personalizado&inicio=2026-07-01&fim=2026-07-31',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    ),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })

  assert.equal(response.status, 200)
  assert.equal(
    response.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  assert.match(response.headers.get('content-disposition') || '', /desempenho-consultores-2026-07\.xlsx/)
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.equal(String.fromCharCode(...bytes.slice(0, 2)), 'PK')
  const content = new TextDecoder().decode(bytes)
  assert.match(content, /DESEMPENHO DOS CONSULTORES/)
  assert.match(content, /OL SEM COMBATE/)
  assert.match(content, /PRIORITÁRIOS/)
  assert.match(content, /ATENDIDOS E AINDA NÃO FATURADOS/)
  assert.match(content, /TOTAL EQUIPE NORTE/)
})

test('PDF dos consultores possui desempenho e atendidos não faturados em páginas legíveis', async () => {
  const response = await gerarPdfConsultores({
    request: new Request(
      'https://painel.local/api/consultores/resumo-pdf?periodo=personalizado&inicio=2026-07-01&fim=2026-07-31',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    ),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.match(response.headers.get('content-disposition') || '', /desempenho-consultores-2026-07\.pdf/)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const content = new TextDecoder('latin1').decode(bytes)
  assert.equal(content.slice(0, 8), '%PDF-1.4')
  assert.match(content, /DESEMPENHO DOS CONSULTORES/)
  assert.match(content, /ATENDIDOS E AINDA NAO FATURADOS/)
  assert.ok(bytes.length > 1500)
})

test('interfaces mostram edição de SIP e visão comparativa com downloads', () => {
  const sips = read('src/SipsModule.tsx')
  const edit = read('src/SipEditDialog.tsx')
  const consultants = read('src/ConsultantsModule.tsx')
  const report = read('src/ConsultantPerformanceReport.tsx')
  const reportStyles = read('src/consultant-performance.css')

  assert.match(sips, /Editar SIP/)
  assert.match(sips, /<SipEditDialog/)
  assert.match(edit, /Adicionar CNPJs/)
  assert.match(edit, /Remover/)
  assert.match(edit, /\/api\/sips\/editar/)
  assert.match(consultants, /<ConsultantPerformanceReport/)
  assert.match(consultants, /\/api\/consultores\/resumo-xlsx/)
  assert.match(consultants, /\/api\/consultores\/resumo-pdf/)
  for (const label of ['OL SEM COMBATE', 'PRIORITÁRIOS', 'LANÇAMENTOS', 'ATENDIDOS E AINDA NÃO FATURADOS', 'Baixar Excel', 'Baixar PDF']) {
    assert.match(report, new RegExp(label))
  }
  assert.match(report, /não possui o realizado de Demanda Sem Combate/)
  assert.match(reportStyles, /position:sticky/)
  assert.match(reportStyles, /consultant-report-percent/)
})
