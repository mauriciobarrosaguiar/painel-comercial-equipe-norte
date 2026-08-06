import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { onRequestPost as agendarAutomacoes } from '../functions/api/internal/agendar-automacoes.js'

const workflow = readFileSync(new URL('../../.github/workflows/bussola-d1.yml', import.meta.url), 'utf8')
const processor = readFileSync(new URL('../../.github/workflows/processar-comandos-painel.yml', import.meta.url), 'utf8')
const workerConfig = readFileSync(new URL('../automation-worker/wrangler.jsonc', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../automation-worker/src/index.js', import.meta.url), 'utf8')
const contingencyScript = readFileSync(new URL('../../scripts/extrair_bussola_contingencia.py', import.meta.url), 'utf8')
const ADMIN_KEY = 'chave-teste-segura-123'

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
      ('BUSSOLA',1,30,'{}',NULL,'2020-01-01T00:00:00.000Z','Teste','2020-01-01T00:00:00.000Z');
    INSERT INTO comandos_automacao(
      id,tipo,parametros_json,status,solicitado_por,mensagem,solicitado_em,iniciado_em,atualizado_em
    ) VALUES(
      'cmd-travado','BUSSOLA','{}','executando','Teste','Travado','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z'
    );
  `)
  return {
    raw: db,
    prepare(sql) { return statement(db, sql) },
  }
}

test('Bússola usa o agendador central do Cloudflare Worker a cada 5 minutos', () => {
  assert.doesNotMatch(workflow, /schedule:/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(processor, /schedule:/)
  assert.match(processor, /workflow_dispatch:/)
  assert.match(processor, /contingência/)
  assert.match(workerConfig, /"crons"\s*:\s*\[\s*"\*\/5 \* \* \* \*"/)
  assert.match(worker, /async scheduled\s*\(/)
  assert.match(worker, /api\/internal\/agendar-automacoes/)
  assert.match(workflow, /concurrency:\s*\n\s*group: bussola-d1\s*\n\s*cancel-in-progress: false/)
})

test('extração permite concluir processamento longo com contingência e sincronização corrigida', () => {
  assert.match(workflow, /timeout-minutes: 60/)
  assert.match(workflow, /python scripts\/extrair_bussola_contingencia\.py/)
  assert.match(contingencyScript, /from scripts import extrair_bussola_d1_corrigido as sincronizador/)
  assert.match(contingencyScript, /sincronizador\.sincronizar\(\)/)
})

test('cada extração recalcula o mês anterior fechado', () => {
  assert.match(workflow, /Atualizar mês fechado com faturamentos retroativos/)
  assert.match(workflow, /api\/internal\/fechamento-mensal/)
  assert.match(workflow, /automatico:true/)
  assert.match(workflow, /somente_se_alterado:true/)
  assert.match(workflow, /apenas_fechado:true/)
})

test('execução antiga da Bússola é liberada e substituída no mesmo ciclo', async () => {
  const DB = database()
  const response = await agendarAutomacoes({
    request: new Request('https://painel.local/api/internal/agendar-automacoes', {
      method: 'POST',
      headers: { 'x-admin-key': ADMIN_KEY, 'content-type': 'application/json' },
      body: '{}',
    }),
    env: { DB, PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.execucoes_expiradas, 1)
  assert.equal(body.total_agendados, 1)
  assert.equal(body.agendados[0].tipo, 'BUSSOLA')
  assert.equal(DB.raw.prepare("SELECT status FROM comandos_automacao WHERE id='cmd-travado'").get().status, 'erro')
  assert.equal(DB.raw.prepare("SELECT COUNT(*) total FROM comandos_automacao WHERE tipo='BUSSOLA' AND status='aguardando'").get().total, 1)
})
