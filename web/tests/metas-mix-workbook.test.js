import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const ui = readFileSync(new URL('../src/BaseManagement.tsx', import.meta.url), 'utf8')
const workflow = readFileSync(new URL('../../.github/workflows/bussola-d1.yml', import.meta.url), 'utf8')
const helper = readFileSync(new URL('../../scripts/aplicar_mix_sap_d1.py', import.meta.url), 'utf8')

test('tela aceita arquivo único com as três abas oficiais', () => {
  assert.match(ui, /readSheetNames/)
  assert.match(ui, /METAS/)
  assert.match(ui, /PRIORITÁRIOS_LANÇ/)
  assert.match(ui, /COMBATE/)
  assert.match(ui, /tipo: 'metas_mix'/)
  assert.match(ui, /mix_rows/)
  assert.match(ui, /COD SAP/)
})

test('parser separa os dois blocos de prioritários e lançamentos', () => {
  assert.match(ui, /parseMixBlocks/)
  assert.match(ui, /const starts = header\.reduce/)
  assert.match(ui, /\.\.\.parseMixBlocks\(prioritariosMatrix\)/)
  assert.match(ui, /\.\.\.parseMixBlocks\(combateMatrix, 'COMBATE'\)/)
})

test('classificação por SAP é reaplicada depois de cada extração do Bússola', () => {
  assert.match(workflow, /Aplicar classificação MIX por código SAP/)
  assert.match(workflow, /scripts\/aplicar_mix_sap_d1\.py/)
  assert.match(helper, /produtos_mix_sap/)
  assert.match(helper, /TRIM\(mapa\.sku\)=TRIM\(COALESCE\(produtos\.sku,''\)\)/)
})
