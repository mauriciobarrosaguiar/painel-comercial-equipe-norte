import assert from 'node:assert/strict'
import test from 'node:test'

import { processarFila } from '../automation-worker/src/index.js'

const env = {
  PAINEL_URL: 'https://painel.local',
  PAINEL_ADMIN_KEY: 'chave-administrativa-segura',
  GITHUB_ACTIONS_TOKEN: 'token-teste',
  GITHUB_REPOSITORY: 'empresa/repositorio',
  GITHUB_REF: 'main',
}

function resposta(data, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: status === 204 ? {} : { 'content-type': 'application/json' },
  })
}

test('cron vazio verifica agendamentos sem abrir workflow do GitHub', async () => {
  const chamadas = []
  const fetchFn = async (url, options = {}) => {
    chamadas.push({ url, options })
    if (url.endsWith('/api/internal/agendar-automacoes')) return resposta({ sucesso: true, total_agendados: 0 })
    if (url.endsWith('/api/internal/automacoes')) return resposta({ comando: null })
    throw new Error(`URL inesperada: ${url}`)
  }

  const resumo = await processarFila(env, fetchFn)

  assert.equal(resumo.processados.length, 0)
  assert.equal(resumo.erros.length, 0)
  assert.equal(chamadas.length, 2)
  assert.ok(chamadas.every((item) => !item.url.includes('api.github.com')))
})

test('comando do Bússola dispara somente o workflow pesado e aguarda sua conclusão', async () => {
  const chamadas = []
  let consultasFila = 0

  const fetchFn = async (url, options = {}) => {
    chamadas.push({ url, options })
    if (url.endsWith('/api/internal/agendar-automacoes')) return resposta({ sucesso: true })
    if (url.endsWith('/api/internal/automacoes')) {
      const body = JSON.parse(options.body || '{}')
      if (body.acao === 'proxima') {
        consultasFila += 1
        return consultasFila === 1
          ? resposta({ comando: { id: 'cmd-1', tipo: 'BUSSOLA', parametros: {} } })
          : resposta({ comando: null })
      }
      throw new Error('O Worker não deve finalizar o Bússola antes do workflow pesado terminar.')
    }
    if (url.includes('/actions/workflows/bussola-d1.yml/dispatches')) return resposta(null, 204)
    throw new Error(`URL inesperada: ${url}`)
  }

  const resumo = await processarFila(env, fetchFn)
  const github = chamadas.find((item) => item.url.includes('api.github.com'))

  assert.equal(resumo.erros.length, 0)
  assert.equal(resumo.processados.length, 1)
  assert.equal(resumo.processados[0].acompanha_workflow, true)
  assert.ok(github)
  assert.deepEqual(JSON.parse(github.options.body), {
    ref: 'main',
    inputs: { command_id: 'cmd-1' },
  })
})

test('auditoria executa no Cloudflare e é finalizada sem GitHub Actions', async () => {
  const chamadas = []
  let consultasFila = 0

  const fetchFn = async (url, options = {}) => {
    chamadas.push({ url, options })
    if (url.endsWith('/api/internal/agendar-automacoes')) return resposta({ sucesso: true })
    if (url.endsWith('/api/admin/auditoria')) return resposta({ sucesso: true })
    if (url.endsWith('/api/internal/automacoes')) {
      const body = JSON.parse(options.body || '{}')
      if (body.acao === 'proxima') {
        consultasFila += 1
        return consultasFila === 1
          ? resposta({ comando: { id: 'cmd-2', tipo: 'AUDITORIA', parametros: {} } })
          : resposta({ comando: null })
      }
      if (body.acao === 'finalizar') {
        assert.equal(body.id, 'cmd-2')
        assert.equal(body.status, 'concluido')
        return resposta({ sucesso: true })
      }
    }
    throw new Error(`URL inesperada: ${url}`)
  }

  const resumo = await processarFila(env, fetchFn)

  assert.equal(resumo.erros.length, 0)
  assert.equal(resumo.processados.length, 1)
  assert.ok(chamadas.every((item) => !item.url.includes('api.github.com')))
})
