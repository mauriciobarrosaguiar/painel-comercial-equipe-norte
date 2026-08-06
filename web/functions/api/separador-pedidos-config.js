import { readSession } from '../_lib/credentials.js'
import { normalize } from '../_lib/order-separator.js'

const HEADERS = { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store,no-cache,must-revalidate' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const text = value => String(value ?? '').trim()
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0

const defaultMinimum = name => {
  const normalized = normalize(name)
  if (normalized.includes('TOTAL')) return 300
  if (normalized.includes('NAZARIA')) return 200
  if (normalized.includes('PROFARMA')) return 50
  if (normalized.includes('NORTE SUL')) return 300
  return 0
}

const desiredOrder = uf => {
  if (uf === 'TO') return ['TOTAL', 'PANPHARMA', 'NAZARIA', 'PROFARMA']
  if (uf === 'PA') return ['PANPHARMA', 'TOTAL', 'NAZARIA']
  if (uf === 'MT') return ['NORTE SUL', 'PANPHARMA', 'SANTA CRUZ', 'PROFARMA']
  return []
}

function buildDefaults(rows) {
  const grouped = new Map()
  for (const row of rows) {
    const uf = text(row.uf).toUpperCase()
    if (!grouped.has(uf)) grouped.set(uf, [])
    grouped.get(uf).push(text(row.distribuidora))
  }
  const estados = {}
  for (const [uf, names] of grouped.entries()) {
    const order = desiredOrder(uf)
    const unique = [...new Set(names)].sort((a, b) => {
      const na = normalize(a)
      const nb = normalize(b)
      const ia = order.findIndex(pattern => na.includes(pattern))
      const ib = order.findIndex(pattern => nb.includes(pattern))
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'pt-BR')
    })
    const knownMatches = unique.filter(name => order.some(pattern => normalize(name).includes(pattern))).length
    estados[uf] = {
      modo: 'prioridade',
      distribuidoras: unique.map((name, index) => ({
        distribuidora: name,
        utilizar: order.length ? (knownMatches ? order.some(pattern => normalize(name).includes(pattern)) : true) : true,
        prioridade: index + 1,
        pedido_minimo: defaultMinimum(name),
      })),
    }
  }
  return { versao: 1, estados }
}

function cleanConfig(input, available) {
  const allowed = new Map()
  for (const item of available) {
    const uf = text(item.uf).toUpperCase()
    if (!allowed.has(uf)) allowed.set(uf, new Set())
    allowed.get(uf).add(text(item.distribuidora))
  }
  const estados = {}
  for (const [ufRaw, config] of Object.entries(input?.estados || {})) {
    const uf = text(ufRaw).toUpperCase().slice(0, 2)
    if (!allowed.has(uf)) continue
    const mode = ['prioridade', 'melhor_preco', 'misto'].includes(config?.modo) ? config.modo : 'prioridade'
    const distributors = (Array.isArray(config?.distribuidoras) ? config.distribuidoras : [])
      .filter(item => allowed.get(uf).has(text(item?.distribuidora)))
      .map((item, index) => ({
        distribuidora: text(item.distribuidora),
        utilizar: item.utilizar !== false,
        prioridade: Math.max(1, Math.floor(number(item.prioridade) || index + 1)),
        pedido_minimo: Math.max(0, Number(number(item.pedido_minimo).toFixed(2))),
      }))
    estados[uf] = { modo: mode, distribuidoras: distributors }
  }
  return { versao: 1, estados }
}

async function loadContext(request, env) {
  const session = await readSession(request, env.PAINEL_ADMIN_KEY)
  if (!session?.login && !session?.consultor_id) return { error: json({ erro: 'Sessão não identificada.' }, 401) }
  const result = await env.DB.prepare(`
    SELECT UPPER(TRIM(uf)) uf, distribuidora, MAX(atualizado_em) atualizado_em
    FROM mercado_farma_precos
    WHERE TRIM(COALESCE(uf,''))<>'' AND TRIM(COALESCE(distribuidora,''))<>''
    GROUP BY UPPER(TRIM(uf)), distribuidora
    ORDER BY uf, distribuidora COLLATE NOCASE
  `).all()
  const available = result.results || []
  const key = `separador_pedidos_regras:${text(session.login || session.consultor_id)}`
  return { session, available, key }
}

export async function onRequestGet({ request, env }) {
  try {
    const context = await loadContext(request, env)
    if (context.error) return context.error
    const saved = await env.DB.prepare('SELECT valor_json, atualizado_em FROM configuracoes WHERE chave=? LIMIT 1').bind(context.key).first()
    let config = buildDefaults(context.available)
    if (saved?.valor_json) {
      try { config = cleanConfig(JSON.parse(saved.valor_json), context.available) } catch { /* mantém padrão */ }
    }
    const latest = context.available.map(item => item.atualizado_em).filter(Boolean).sort().at(-1) || null
    return json({
      configuracao: config,
      disponiveis: context.available.map(item => ({ uf: text(item.uf), distribuidora: text(item.distribuidora) })),
      atualizado_em: saved?.atualizado_em || null,
      mercado_farma_atualizado_em: latest,
    })
  } catch (error) {
    return json({ erro: 'Não foi possível carregar as regras do Separador de Pedidos.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const context = await loadContext(request, env)
    if (context.error) return context.error
    const body = await request.json()
    const config = cleanConfig(body?.configuracao || body, context.available)
    const now = new Date().toISOString()
    await env.DB.prepare(`
      INSERT INTO configuracoes(chave,valor_json,atualizado_em) VALUES(?,?,?)
      ON CONFLICT(chave) DO UPDATE SET valor_json=excluded.valor_json, atualizado_em=excluded.atualizado_em
    `).bind(context.key, JSON.stringify(config), now).run()
    return json({ ok: true, configuracao: config, atualizado_em: now })
  } catch (error) {
    return json({ erro: 'Não foi possível salvar as regras.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
