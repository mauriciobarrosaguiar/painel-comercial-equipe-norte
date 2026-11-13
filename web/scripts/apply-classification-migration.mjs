// Migração idempotente e isolada do catálogo farmacêutico no Turso principal.
// Executa antes do deploy; impede publicar código sem a tabela necessária.
import { readFile } from 'node:fs/promises'

const inputUrl = String(process.env.TURSO_DATABASE_URL || '').trim()
const token = String(process.env.TURSO_AUTH_TOKEN || '').trim()
if (!inputUrl || !token) throw new Error('Credenciais Turso ausentes; deploy bloqueado.')
const parsed = inputUrl.replace(/^libsql:\/\//, 'https://').replace(/^turso:\/\//, 'https://')
const url = new URL(parsed)
if (url.protocol !== 'https:') throw new Error('Turso deve utilizar HTTPS.')

const ddl = await readFile(new URL('../migrations/10026_classificacao_farmaceutica.sql', import.meta.url), 'utf8')
const statements = ddl.split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map(s => s.trim())
  .filter(Boolean)

async function execute(sql) {
  const response = await fetch(new URL('/v2/pipeline', url), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }),
  })
  if (!response.ok) throw new Error(`Turso recusou migração: HTTP ${response.status}`)
  const data = await response.json()
  const item = data?.results?.[0]
  if (item?.type !== 'ok' || item?.response?.type !== 'execute') {
    throw new Error('Turso não confirmou a execução da migração.')
  }
  return item.response.result
}

if (statements.length < 2) throw new Error('Arquivo de migração inválido ou incompleto.')
for (const sql of statements) await execute(sql)
const tables = await execute("SELECT name FROM sqlite_master WHERE type='table' AND name='produto_classificacao_farmaceutica'")
if (!tables?.rows?.length) throw new Error('A tabela da classificação não foi criada; deploy bloqueado.')
console.log('Migração farmacêutica conferida no Turso principal.')
