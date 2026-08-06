import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import {
  onRequestGet as listarConfiguracoes,
  onRequestPost as salvarConfiguracao,
} from '../functions/api/configuracoes-automacao.js'
import { onRequestPost as agendarAutomacoes } from '../functions/api/internal/agendar-automacoes.js'

const ADMIN_KEY = 'chave-teste-segura-123'
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function statement(db, sql, params = []) {
  return {
    bind(...values) { return statement(db, sql, values) },
    async all() { return { results: db.prepare(sql).all(...params) } },
    async first() { return db.prepare(sql).get(...params) || null },
    async run() {
      const result = db.prepare(sql).run(...params)
      return { success: true, meta: { changes: Number(result.changes || 0) } }
    },
  }
}

function database() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE configuracoes_automacao(
      tipo TEXT PRIMARY KEY,
      ativo INTEGER NOT NULL,
      intervalo_minutos INTEGER NOT NULL,
      parametros_json TEXT NOT NULL DEFAULT '{}',
      ultima_execucao_em TEXT,
      proxima_execucao_em TEXT,
      atualizado_por TEXT,
      atualizado_em TEXT
    );
    CREATE TABLE comandos_automacao(
      id TEXT PRIMARY KEY,
      tipo TEXT,
      parametros_json TEXT,
      status TEXT,
      solicitado_por TEXT,
      mensagem TEXT,
      erro TEXT,
      solicitado_em TEXT,
      iniciado_em TEXT,
      finalizado_em TEXT,
      atualizado_em TEXT
    );
    INSERT INTO configuracoes_automacao VALUES
      ('BUSSOLA',1,30,'{}',NULL,'2026-07-31T10:00:00.000Z','Teste','2026-07-31T10:00:00.000Z'),
      ('MERCADO_FARMA',1,30,'{"ufs":"MA,MT,PA,PI,TO"}',NULL,'2026-07-31T10:00:00.000Z','Teste','2026-07-31T10:00:00.000Z'),
      ('AUDITORIA',0,1440,'{}',NULL,NULL,'Teste','2026-07-31T10:00:00.000Z');
  `)
  return {
    raw: db,
    prepare(sql) { return statement(db, sql) },
  }
}

const request = (url, options = {}) => new Request(url, {
  ...options,
  headers: { 'x-admin-key': ADMIN_KEY, ...(options.headers || {}) },
})

test('Mercado Farma nasce ativo a cada 30 minutos e o intervalo pode ser alterado', async () => {
  const DB = database()
  const env = { DB, PAINEL_ADMIN_KEY: ADMIN_KEY }

  const listed = await listarConfiguracoes({
    request: request('https://painel.local/api/configuracoes-automacao'),
    env,
  })
  assert.equal(listed.status, 200)
  const body = await listed.json()
  const mercado = body.configuracoes.find(item => item.tipo === 'MERCADO_FARMA')
  assert.equal(mercado.ativo, true)
  assert.equal(mercado.intervalo_minutos, 30)

  const saved = await salvarConfiguracao({
    request: request('https://painel.local/api/configuracoes-automacao', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'MERCADO_FARMA', ativo: true, intervalo_minutos: 60 }),
    }),
    env,
  })
  assert.equal(saved.status, 200)
  const savedBody = await saved.json()
  assert.equal(savedBody.configuracao.intervalo_minutos, 60)
  assert.equal(savedBody.configuracao.ativo, true)
})

test('verificador enfileira somente uma execução vencida e calcula a próxima', async () => {
  const DB = database()
  DB.raw.prepare("UPDATE configuracoes_automacao SET ativo=0 WHERE tipo='BUSSOLA'").run()
  DB.raw.prepare("UPDATE configuracoes_automacao SET proxima_execucao_em='2020-01-01T00:00:00.000Z' WHERE tipo='MERCADO_FARMA'").run()
  const env = { DB, PAINEL_ADMIN_KEY: ADMIN_KEY }

  const first = await agendarAutomacoes({
    request: request('https://painel.local/api/internal/agendar-automacoes', { method: 'POST' }),
    env,
  })
  assert.equal(first.status, 200)
  const firstBody = await first.json()
  assert.equal(firstBody.total_agendados, 1)
  assert.equal(firstBody.agendados[0].tipo, 'MERCADO_FARMA')
  assert.equal(DB.raw.prepare("SELECT COUNT(*) total FROM comandos_automacao WHERE tipo='MERCADO_FARMA'").get().total, 1)

  const config = DB.raw.prepare("SELECT ultima_execucao_em,proxima_execucao_em FROM configuracoes_automacao WHERE tipo='MERCADO_FARMA'").get()
  assert.ok(config.ultima_execucao_em)
  assert.ok(new Date(config.proxima_execucao_em).getTime() > new Date(config.ultima_execucao_em).getTime())

  DB.raw.prepare("UPDATE configuracoes_automacao SET proxima_execucao_em='2020-01-01T00:00:00.000Z' WHERE tipo='MERCADO_FARMA'").run()
  const second = await agendarAutomacoes({
    request: request('https://painel.local/api/internal/agendar-automacoes', { method: 'POST' }),
    env,
  })
  const secondBody = await second.json()
  assert.equal(secondBody.total_agendados, 0)
  assert.equal(DB.raw.prepare("SELECT COUNT(*) total FROM comandos_automacao WHERE tipo='MERCADO_FARMA'").get().total, 1)
})

test('painel e Cloudflare Worker usam o agendador central configurável', () => {
  const component = read('src/AutomationScheduleSettings.tsx')
  const module = read('src/AutomationsModule.tsx')
  const migration = read('migrations/10020_configuracoes_automacao.sql')
  const processor = read('../.github/workflows/processar-comandos-painel.yml')
  const bussola = read('../.github/workflows/bussola-d1.yml')
  const workerConfig = read('automation-worker/wrangler.jsonc')
  const worker = read('automation-worker/src/index.js')

  assert.match(component, /Executar a cada/)
  assert.match(component, /Salvar intervalo/)
  assert.match(module, /<AutomationScheduleSettings \/>/)
  assert.match(migration, /'MERCADO_FARMA',1,30/)
  assert.match(migration, /'BUSSOLA',1,30/)
  assert.doesNotMatch(processor, /schedule:/)
  assert.match(processor, /workflow_dispatch:/)
  assert.match(processor, /contingência/)
  assert.match(workerConfig, /"crons"\s*:\s*\[\s*"\*\/5 \* \* \* \*"/)
  assert.match(worker, /async scheduled\s*\(/)
  assert.match(worker, /\/api\/internal\/agendar-automacoes/)
  assert.doesNotMatch(bussola, /schedule:/)
  assert.doesNotMatch(bussola, /\*\/30/)
})
