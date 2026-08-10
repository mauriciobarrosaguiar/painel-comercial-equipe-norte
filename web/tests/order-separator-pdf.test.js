import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const bridge = readFileSync(new URL('../src/OrderSeparatorPdfBridge.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/AppShell.tsx', import.meta.url), 'utf8')

test('Separador de Pedidos aceita PDF além de Excel e colagem', () => {
  assert.match(shell, /OrderSeparatorPdfBridge/)
  assert.match(bridge, /accept="\.pdf,application\/pdf"/)
  assert.match(bridge, /pdf\.min\.mjs/)
  assert.match(bridge, /pdf\.worker\.min\.mjs/)
  assert.match(bridge, /texto selecionável/)
})

test('PDF permite confirmar e corrigir a ligação dos campos antes da análise', () => {
  assert.match(bridge, /Conferência obrigatória/)
  assert.match(bridge, /Confirme o que cada informação significa/)
  assert.match(bridge, /CNPJ do cliente/)
  assert.match(bridge, /EAN \/ Código de barras/)
  assert.match(bridge, /Quantidade/)
  assert.match(bridge, /Ref\.<\/b> → <b>EAN/)
  assert.match(bridge, /Quant\.<\/b> → <b>Quantidade/)
  assert.match(bridge, /Confirmar leitura do PDF/)
})

test('CNPJ não bloqueia mais a leitura quando não é reconhecido automaticamente', () => {
  assert.match(bridge, /CNPJ não identificado automaticamente/)
  assert.match(bridge, /Digite o CNPJ se não tiver sido identificado/)
  assert.match(bridge, /Encontrei mais de um CNPJ no PDF/)
  assert.doesNotMatch(bridge, /Os produtos foram encontrados, mas não consegui identificar o CNPJ no PDF/)
})

test('leitor reconhece modelos com Ref ou Código de Barras e Quant ou Qtd', () => {
  assert.match(bridge, /\\bREF\\b/)
  assert.match(bridge, /COD BARRAS/)
  assert.match(bridge, /\\bQUANT\\b/)
  assert.match(bridge, /\\bQTD\\b/)
  assert.match(bridge, /Cód\. Barras/)
})
