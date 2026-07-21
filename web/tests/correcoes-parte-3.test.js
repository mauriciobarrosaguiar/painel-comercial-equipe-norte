import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('login não exibe exemplos ou códigos corporativos reais', () => {
  const source = read('src/LoginPage.tsx')
  assert.doesNotMatch(source, /m0043497/i)
  assert.doesNotMatch(source, /@ems\.com\.br/i)
})

test('SIP destaca sem combate, projeção e CNPJs com vendas', () => {
  const view = read('src/SipDetailView.tsx')
  const api = read('functions/api/sips/detalhe.js')
  assert.match(view, /CNPJs com vendas/)
  assert.match(view, /OL Sem Combate/)
  assert.match(view, /Projeção/)
  assert.match(view, /Notas faturadas/)
  assert.match(view, /OL Total/)
  assert.match(api, /projecao_ol_sem_combate/)
  assert.match(api, /projecao_meta/)
})

test('Mercado Farma usa cartão suspenso e Excel xlsx real por UF', () => {
  const market = read('src/MarketFarmaModule.new.tsx')
  const workflow = read('../.github/workflows/mercadofarma.yml')
  assert.match(market, /<details className="market-product-card"/)
  assert.match(market, /market-product-preview/)
  assert.match(market, /\/exports\/mercadofarma\.xlsx/)
  assert.match(market, /Atualizar Mercado Farma/)
  assert.doesNotMatch(market, /Atualizar tela/)
  assert.match(workflow, /mercadofarma_consolidado\.xlsx web\/public\/exports\/mercadofarma\.xlsx/)
  assert.match(workflow, /Sincronizar consolidado no D1/)
})

test('ranking usa código do setor em vez da UF do consultor', () => {
  const view = read('src/ConsultantsModule.tsx')
  const api = read('functions/api/consultores.js')
  assert.match(view, /Setor \{x\.setor/)
  assert.doesNotMatch(view, /x\.uf\|\|/)
  for (const setor of ['18150300','18150301','18150302','18150303','18150304','18150305']) assert.match(api, new RegExp(setor))
})

test('conflitos da auditoria são clicáveis e possuem motivo', () => {
  const view = read('src/CalculationAudit.tsx')
  const details = read('functions/api/admin/auditoria-detalhes.js')
  assert.match(view, /Abrir detalhes/)
  assert.match(view, /itens_sem_classificacao/)
  assert.match(details, /Produtos sem classificação/)
  assert.match(details, /motivo/)
  assert.match(details, /ean/)
  assert.match(details, /produto/)
})
