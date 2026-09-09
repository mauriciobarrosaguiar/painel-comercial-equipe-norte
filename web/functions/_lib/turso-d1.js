const text = (value) => String(value ?? '').trim()

function httpUrl(raw) {
  const value = text(raw)
  if (!value) throw new Error('TURSO_DATABASE_URL não configurada.')
  if (value.startsWith('libsql://')) return `https://${value.slice('libsql://'.length).replace(/\/+$/, '')}`
  if (value.startsWith('turso://')) return `https://${value.slice('turso://'.length).replace(/\/+$/, '')}`
  if (value.startsWith('https://')) return value.replace(/\/+$/, '')
  throw new Error('TURSO_DATABASE_URL inválida.')
}

function encodeBlob(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : null
  if (!bytes) return null
  let binary = ''
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step))
  }
  return btoa(binary)
}

function arg(value) {
  if (value === null || value === undefined) return { type: 'null' }
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() }
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { type: 'null' }
    return Number.isInteger(value)
      ? { type: 'integer', value: String(value) }
      : { type: 'float', value: String(value) }
  }
  const base64 = encodeBlob(value)
  if (base64 !== null) return { type: 'blob', base64 }
  return { type: 'text', value: String(value) }
}

function decodeBlob(base64) {
  const binary = atob(base64 || '')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function value(cell) {
  if (!cell || cell.type === 'null') return null
  if (cell.type === 'integer') {
    const numeric = Number(cell.value)
    return Number.isSafeInteger(numeric) ? numeric : String(cell.value)
  }
  if (cell.type === 'float') return Number(cell.value)
  if (cell.type === 'blob') return decodeBlob(cell.base64)
  return cell.value ?? ''
}

function rowsFrom(result) {
  const columns = (result?.cols || []).map((column) => String(column?.name || ''))
  return (result?.rows || []).map((row) => Object.fromEntries(columns.map((name, index) => [name, value(row?.[index])])))
}

function d1Result(result) {
  return {
    success: true,
    results: rowsFrom(result),
    meta: {
      duration: Number(result?.query_duration_ms || 0),
      changes: Number(result?.affected_row_count || 0),
      last_row_id: result?.last_insert_rowid === null || result?.last_insert_rowid === undefined
        ? null
        : Number(result.last_insert_rowid),
      rows_read: Number(result?.rows_read || 0),
      rows_written: Number(result?.rows_written || result?.affected_row_count || 0),
    },
  }
}

async function pipeline(client, statements) {
  const requests = statements.map((statement) => ({
    type: 'execute',
    stmt: {
      sql: statement.sql,
      ...(statement.args.length ? { args: statement.args.map(arg) } : {}),
    },
  }))
  requests.push({ type: 'close' })

  const response = await fetch(`${client.url}/v2/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${client.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ requests }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Turso HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`)

  const results = payload?.results || []
  return statements.map((_, index) => {
    const item = results[index]
    if (!item || item.type !== 'ok' || item.response?.type !== 'execute') {
      const detail = item?.error?.message || item?.error || item || 'resposta ausente'
      throw new Error(`Consulta Turso falhou: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    }
    return item.response.result || {}
  })
}

class TursoStatement {
  constructor(database, sql, args = []) {
    this.database = database
    this.sql = String(sql || '')
    this.args = args
  }

  bind(...args) {
    return new TursoStatement(this.database, this.sql, args)
  }

  async all() {
    const [result] = await pipeline(this.database.client, [this])
    return d1Result(result)
  }

  async first(column) {
    const result = await this.all()
    const row = result.results[0] ?? null
    if (row === null || column === undefined) return row
    return row?.[column] ?? null
  }

  async run() {
    const [result] = await pipeline(this.database.client, [this])
    return d1Result(result)
  }

  async raw(options = {}) {
    const [result] = await pipeline(this.database.client, [this])
    const columns = (result?.cols || []).map((column) => String(column?.name || ''))
    const rows = (result?.rows || []).map((row) => row.map(value))
    return options?.columnNames ? [columns, ...rows] : rows
  }
}

class TursoD1Database {
  constructor(url, token) {
    this.client = { url, token }
    this.__backend = 'turso'
  }

  prepare(sql) {
    return new TursoStatement(this, sql)
  }

  async batch(statements) {
    const normalized = (statements || []).map((statement) => {
      if (statement instanceof TursoStatement) return statement
      if (statement && typeof statement.sql === 'string') {
        return new TursoStatement(this, statement.sql, Array.isArray(statement.args) ? statement.args : [])
      }
      throw new TypeError('Turso batch recebeu uma instrução inválida.')
    })
    const results = await pipeline(this.client, normalized)
    return results.map(d1Result)
  }
}

export function createTursoD1(env) {
  const token = text(env?.TURSO_AUTH_TOKEN)
  if (!token) throw new Error('TURSO_AUTH_TOKEN não configurado.')
  return new TursoD1Database(httpUrl(env?.TURSO_DATABASE_URL), token)
}

export function databaseFor(env) {
  if (text(env?.TURSO_DATABASE_URL) && text(env?.TURSO_AUTH_TOKEN)) return createTursoD1(env)
  if (env?.DB) return env.DB
  throw new Error('Nenhum banco de dados configurado.')
}

export const __test = { arg, value, rowsFrom, d1Result, httpUrl }
