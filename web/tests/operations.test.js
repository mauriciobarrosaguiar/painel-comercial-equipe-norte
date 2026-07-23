import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { onRequestGet as listar, onRequestPost as criar } from '../functions/api/automacoes.js'
import { onRequestGet as mercado } from '../functions/api/mercado-farma.js'
import { onRequestPost as fechar } from '../functions/api/internal/fechamento-mensal.js'
import { onRequestGet as historico } from '../functions/api/historico.js'
import { testDatabase } from './d1-fixture.js'

const key = 'chave-administrativa-teste'
const req = (url, method = 'GET', body) => new Request(url, {
  method,
  headers: { 'content-type': 'application/json', 'x-admin-key': key },
  body: body ? JSON.stringify(body) : undefined,
})

test('registra automação, bloqueia somente duplicidade do mesmo tipo e permite outro processo', async () => {
  const DB = testDatabase()
  const env = { DB, PAINEL_ADMIN_KEY: key }
  assert.equal((await criar({ request: req('https://x/api/automacoes', 'POST', { tipo: 'BUSSOLA' }), env })).status, 202)
  assert.equal((await criar({ request: req('https://x/api/automacoes', 'POST', { tipo: 'BUSSOLA' }), env })).status, 409)
  assert.equal((await criar({ request: req('https://x/api/automacoes', 'POST', { tipo: 'MERCADO_FARMA' }), env })).status, 202)
  const body = await (await listar({ env })).json()
  assert.equal(body.comandos.length, 2)
})

test('dispara Bússola imediatamente no GitHub e mantém comando executando até o workflow finalizar', async () => {
  const DB = testDatabase()
  const env = { DB, PAINEL_ADMIN_KEY: key, GITHUB_ACTIONS_TOKEN: 'github_pat_token_de_teste_com_tamanho_valido' }
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url).includes('/runs?')) {
      return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (String(url).endsWith('/dispatches')) return new Response(null, { status: 204 })
    throw new Error(`URL inesperada: ${url}`)
  }
  try {
    const response = await criar({ request: req('https://x/api/automacoes', 'POST', { tipo: 'BUSSOLA' }), env })
    assert.equal(response.status, 202)
    const body = await response.json()
    assert.equal(body.imediato, true)
    assert.equal(body.status, 'executando')
    assert.ok(calls.some(item => item.url.includes('/actions/workflows/bussola-d1.yml/dispatches')))
    const stored = await DB.prepare("SELECT status,mensagem FROM comandos_automacao WHERE tipo='BUSSOLA'").first()
    assert.equal(stored.status, 'executando')
    assert.match(stored.mensagem, /GitHub Actions/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('mantém a solicitação na contingência e mostra orientação quando o token não tem acesso', async () => {
  const DB = testDatabase()
  const env = { DB, PAINEL_ADMIN_KEY: key, GITHUB_ACTIONS_TOKEN: 'github_pat_token_de_teste_com_tamanho_valido' }
  const originalFetch = globalThis.fetch
  let consultas = 0
  globalThis.fetch = async url => {
    if (String(url).includes('/runs?')) {
      consultas += 1
      return consultas === 1
        ? new Response(JSON.stringify({ workflow_runs: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ workflow_runs: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (String(url).endsWith('/dispatches')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`URL inesperada: ${url}`)
  }
  try {
    const response = await criar({ request: req('https://x/api/automacoes', 'POST', { tipo: 'BUSSOLA' }), env })
    assert.equal(response.status, 202)
    const body = await response.json()
    assert.equal(body.imediato, false)
    assert.match(body.detalhe, /selecione painel-comercial-equipe-norte/i)
    const stored = await DB.prepare("SELECT status,erro FROM comandos_automacao WHERE tipo='BUSSOLA'").first()
    assert.equal(stored.status, 'aguardando')
    assert.match(stored.erro, /HTTP 404/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('não cria novo comando quando o mesmo workflow já está rodando no GitHub', async () => {
  const DB = testDatabase()
  const env = { DB, PAINEL_ADMIN_KEY: key, GITHUB_ACTIONS_TOKEN: 'github_pat_token_de_teste_com_tamanho_valido' }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => {
    if (String(url).includes('/runs?')) {
      return new Response(JSON.stringify({ workflow_runs: [{ status: 'in_progress' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`URL inesperada: ${url}`)
  }
  try {
    const response = await criar({ request: req('https://x/api/automacoes', 'POST', { tipo: 'BUSSOLA' }), env })
    assert.equal(response.status, 409)
    const row = await DB.prepare("SELECT COUNT(*) total FROM comandos_automacao WHERE tipo='BUSSOLA'").first()
    assert.equal(Number(row.total), 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tela desabilita cada processo de forma independente', () => {
  const source = readFileSync(new URL('../src/AutomationsModule.tsx', import.meta.url), 'utf8')
  assert.match(source, /activeTypes\.has\(type\)/)
  assert.doesNotMatch(source, /disabled=\{Boolean\(busy\)\}/)
  assert.match(source, /Encaminhando/)
})

test('Mercado Farma calcula menor preço com estoque', async () => {
  const body = await (await mercado({ request: new Request('https://x/api/mercado-farma?uf=PA'), env: { DB: testDatabase() } })).json()
  assert.equal(body.resumo.produtos, 1)
  assert.equal(body.resultados.length, 2)
  assert.equal(body.resultados[0].melhor_preco, 10)
})

test('fechamento mensal grava fotografia consultável', async () => {
  const DB = testDatabase()
  const env = { DB, PAINEL_ADMIN_KEY: key }
  const response = await fechar({ request: req('https://x/api/internal/fechamento-mensal', 'POST', { ano_mes: '2026-07' }), env })
  assert.equal(response.status, 200)
  const fechado = await response.json()
  assert.ok(fechado.registros >= 4)
  const body = await (await historico({ request: new Request('https://x/api/historico?ano_mes=2026-07'), env })).json()
  assert.equal(body.geral.length, 1)
  assert.equal(body.geral[0].resultado.ol_total, 200)
  assert.equal(body.geral[0].resultado.ol_sem_combate, 150)
})
