import { readSession } from '../_lib/credentials.js'
import { allocateCnpj, cleanCnpj, cleanEan, inferUf, numeric } from '../_lib/order-separator.js'

const HEADERS = { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store,no-cache,must-revalidate' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const text = value => String(value ?? '').trim()
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size))
const safeIndex = value => Number.isInteger(Number(value)) ? Number(value) : -1
const valueAt = (row, index) => index >= 0 ? row?.[index] : ''

function sanitizeConfig(input) {
  const estados = {}
  for (const [ufRaw, config] of Object.entries(input?.estados || {})) {
    const uf = text(ufRaw).toUpperCase().slice(0, 2)
    estados[uf] = {
      modo: ['prioridade','melhor_preco','misto'].includes(config?.modo) ? config.modo : 'prioridade',
      distribuidoras: (Array.isArray(config?.distribuidoras) ? config.distribuidoras : []).map((item, index) => ({
        distribuidora: text(item?.distribuidora),
        utilizar: item?.utilizar !== false,
        prioridade: Math.max(1, Math.floor(numeric(item?.prioridade) || index + 1)),
        pedido_minimo: Math.max(0, numeric(item?.pedido_minimo)),
      })).filter(item => item.distribuidora),
    }
  }
  return { estados }
}

async function loadClientUfs(env, cnpjs) {
  const map = new Map()
  for (const group of chunks(cnpjs, 80)) {
    if (!group.length) continue
    const placeholders = group.map(() => '?').join(',')
    const result = await env.DB.prepare(`
      SELECT REPLACE(REPLACE(REPLACE(REPLACE(cnpj,'.',''),'/',''),'-',''),' ','') cnpj,
             UPPER(TRIM(COALESCE(uf,''))) uf
      FROM clientes
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(cnpj,'.',''),'/',''),'-',''),' ','') IN (${placeholders})
    `).bind(...group).all()
    for (const item of result.results || []) if (item.cnpj && item.uf) map.set(cleanCnpj(item.cnpj), text(item.uf).toUpperCase())
  }
  return map
}

async function loadOffers(env, eans, ufs) {
  const map = new Map()
  for (const eanGroup of chunks(eans, 70)) {
    if (!eanGroup.length || !ufs.length) continue
    const eanPlaceholders = eanGroup.map(() => '?').join(',')
    const ufPlaceholders = ufs.map(() => '?').join(',')
    const result = await env.DB.prepare(`
      SELECT UPPER(TRIM(uf)) uf,
             REPLACE(REPLACE(REPLACE(TRIM(ean),'.0',''),' ',''),'-','') ean,
             produto, distribuidora, estoque, preco_sem_imposto, atualizado_em
      FROM mercado_farma_precos
      WHERE REPLACE(REPLACE(REPLACE(TRIM(ean),'.0',''),' ',''),'-','') IN (${eanPlaceholders})
        AND UPPER(TRIM(uf)) IN (${ufPlaceholders})
      ORDER BY atualizado_em DESC
    `).bind(...eanGroup, ...ufs).all()
    for (const item of result.results || []) {
      const key = `${text(item.uf).toUpperCase()}|${cleanEan(item.ean)}`
      if (!map.has(key)) map.set(key, [])
      const exists = map.get(key).some(row => row.distribuidora === text(item.distribuidora))
      if (!exists) map.get(key).push({
        produto: text(item.produto),
        distribuidora: text(item.distribuidora),
        estoque: numeric(item.estoque),
        preco: numeric(item.preco_sem_imposto),
        atualizado_em: item.atualizado_em || null,
      })
    }
  }
  return map
}

function summarize(groups) {
  const cnpjRows = []
  const stateMap = new Map()
  let distributed = 0
  let noStock = 0
  let notFound = 0
  let minFailed = 0
  for (const group of groups) {
    const distributorRows = [...group.allocation.totals.entries()].map(([distribuidora, total]) => {
      const rule = group.allocation.rules.find(item => item.distribuidora === distribuidora)
      const minimum = rule?.pedido_minimo || 0
      return {
        distribuidora,
        itens: group.items.filter(item => item.offer?.distribuidora === distribuidora).length,
        total: Number(total.toFixed(2)),
        pedido_minimo: minimum,
        situacao: minimum > 0 ? (total + 0.005 >= minimum ? 'ATINGIU' : 'NÃO ATINGIU') : 'SEM MÍNIMO',
      }
    }).sort((a, b) => b.total - a.total)
    const counts = group.items.reduce((acc, item) => {
      if (item.status === 'DISTRIBUÍDO') { acc.distribuidos += 1; distributed += 1 }
      else if (item.status === 'SEM ESTOQUE') { acc.sem_estoque += 1; noStock += 1 }
      else if (item.status === 'EAN NÃO LOCALIZADO') { acc.ean_nao_localizado += 1; notFound += 1 }
      else if (item.status === 'PEDIDO MÍNIMO NÃO ATINGIDO') { acc.minimo_nao_atingido += 1; minFailed += 1 }
      return acc
    }, { distribuidos: 0, sem_estoque: 0, ean_nao_localizado: 0, minimo_nao_atingido: 0 })
    cnpjRows.push({ cnpj: group.cnpj, uf: group.uf, modo: group.allocation.mode, distribuidoras: distributorRows, ...counts })
    if (!stateMap.has(group.uf)) stateMap.set(group.uf, { uf: group.uf, cnpjs: 0, produtos: 0, distribuidos: 0, sem_estoque: 0, ean_nao_localizado: 0, minimo_nao_atingido: 0 })
    const state = stateMap.get(group.uf)
    state.cnpjs += 1
    state.produtos += group.items.length
    state.distribuidos += counts.distribuidos
    state.sem_estoque += counts.sem_estoque
    state.ean_nao_localizado += counts.ean_nao_localizado
    state.minimo_nao_atingido += counts.minimo_nao_atingido
  }
  return {
    geral: { cnpjs: groups.length, produtos: groups.reduce((sum, group) => sum + group.items.length, 0), distribuidos: distributed, sem_estoque: noStock, ean_nao_localizado: notFound, minimo_nao_atingido: minFailed },
    estados: [...stateMap.values()].sort((a, b) => a.uf.localeCompare(b.uf)),
    cnpjs: cnpjRows.sort((a, b) => a.uf.localeCompare(b.uf) || a.cnpj.localeCompare(b.cnpj)),
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const session = await readSession(request, env.PAINEL_ADMIN_KEY)
    if (!session) return json({ erro: 'Sessão não identificada.' }, 401)
    const body = await request.json()
    const headers = Array.isArray(body?.headers) ? body.headers.slice(0, 120).map(text) : []
    const sourceRows = Array.isArray(body?.rows) ? body.rows.slice(0, 5000).filter(Array.isArray).map(row => row.slice(0, 120)) : []
    const mapping = {
      cnpj: safeIndex(body?.mapping?.cnpj),
      ean: safeIndex(body?.mapping?.ean),
      produto: safeIndex(body?.mapping?.produto),
      quantidade: safeIndex(body?.mapping?.quantidade),
      unidade: safeIndex(body?.mapping?.unidade),
      uf: safeIndex(body?.mapping?.uf),
    }
    if (!headers.length || !sourceRows.length || mapping.cnpj < 0 || mapping.ean < 0 || mapping.quantidade < 0) {
      return json({ erro: 'Informe uma planilha válida e confirme as colunas de CNPJ, EAN e quantidade.' }, 400)
    }
    const config = sanitizeConfig(body?.configuracao || {})
    const prepared = sourceRows.map((row, index) => {
      const cnpj = cleanCnpj(valueAt(row, mapping.cnpj))
      const ean = cleanEan(valueAt(row, mapping.ean))
      const quantidade = Math.max(0, numeric(valueAt(row, mapping.quantidade)))
      const product = text(valueAt(row, mapping.produto))
      const fallbackUf = text(valueAt(row, mapping.uf)).toUpperCase().slice(0, 2) || inferUf(valueAt(row, mapping.unidade))
      return { index, row, cnpj, ean, quantidade, produto: product, fallbackUf }
    })
    const validCnpjs = [...new Set(prepared.map(item => item.cnpj).filter(item => item.length === 14))]
    const clientUfs = await loadClientUfs(env, validCnpjs)
    for (const item of prepared) item.uf = clientUfs.get(item.cnpj) || item.fallbackUf
    const validEans = [...new Set(prepared.map(item => item.ean).filter(Boolean))]
    const ufs = [...new Set(prepared.map(item => item.uf).filter(Boolean))]
    const offerMap = await loadOffers(env, validEans, ufs)

    const invalidResults = []
    const groupMap = new Map()
    for (const item of prepared) {
      if (!item.cnpj || item.cnpj.length !== 14) {
        invalidResults.push({ index: item.index, cnpj: item.cnpj, uf: item.uf || '', ean: item.ean, produto: item.produto, quantidade: item.quantidade, distribuidora: 'CNPJ INVÁLIDO', status: 'CNPJ INVÁLIDO', preco_sem_imposto: null, total_linha: null })
        continue
      }
      if (!item.uf || !config.estados[item.uf]) {
        invalidResults.push({ index: item.index, cnpj: item.cnpj, uf: item.uf || '', ean: item.ean, produto: item.produto, quantidade: item.quantidade, distribuidora: 'UF SEM CONFIGURAÇÃO', status: 'UF SEM CONFIGURAÇÃO', preco_sem_imposto: null, total_linha: null })
        continue
      }
      if (!item.ean || item.quantidade <= 0) {
        invalidResults.push({ index: item.index, cnpj: item.cnpj, uf: item.uf, ean: item.ean, produto: item.produto, quantidade: item.quantidade, distribuidora: 'DADOS INVÁLIDOS', status: 'DADOS INVÁLIDOS', preco_sem_imposto: null, total_linha: null })
        continue
      }
      const key = `${item.uf}|${item.cnpj}`
      if (!groupMap.has(key)) groupMap.set(key, { cnpj: item.cnpj, uf: item.uf, items: [] })
      const allOffers = offerMap.get(`${item.uf}|${item.ean}`) || []
      groupMap.get(key).items.push({ ...item, offers: allOffers, eanExiste: allOffers.length > 0, offer: null, status: '' })
    }

    const groups = []
    for (const group of groupMap.values()) {
      group.allocation = allocateCnpj(group.items, config.estados[group.uf])
      groups.push(group)
    }
    const results = [...invalidResults]
    for (const group of groups) {
      for (const item of group.items) {
        results.push({
          index: item.index,
          cnpj: item.cnpj,
          uf: item.uf,
          ean: item.ean,
          produto: item.produto || item.offer?.produto || item.offers?.[0]?.produto || '',
          quantidade: item.quantidade,
          distribuidora: item.offer?.distribuidora || item.status,
          status: item.status,
          preco_sem_imposto: item.offer ? Number(item.offer.preco.toFixed(4)) : null,
          total_linha: item.offer ? Number((item.quantidade * item.offer.preco).toFixed(2)) : null,
          estoque_disponivel: item.offer ? item.offer.estoque : null,
        })
      }
    }
    results.sort((a, b) => a.index - b.index)
    const summary = summarize(groups)
    summary.geral.produtos += invalidResults.length
    return json({ ok: true, headers, resultados: results, resumo: summary, mercado_farma_atualizado_em: [...offerMap.values()].flat().map(item => item.atualizado_em).filter(Boolean).sort().at(-1) || null })
  } catch (error) {
    return json({ erro: 'Não foi possível analisar os pedidos.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
