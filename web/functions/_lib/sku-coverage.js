import { classificarMix } from './commercial.js'

const number = value => Math.max(0, Number(value) || 0)

// Rows are grouped by client, SKU and month in SQL; no monetary totals are used.
export function analisarSkus(catalogo, rows, clientes, inicio = '', fim = '', campanha = []) {
  const key = p => String(p.chave || p.ean || p.id)
  const catalog = new Map(catalogo.map(p => [key(p), { ...p, tipo: classificarMix(p.tipo_mix) }]))
  const porSap = new Map([...catalog].filter(([, p]) => p.codigo_sap).map(([k, p]) => [String(p.codigo_sap), k]))
  const porEan = new Map([...catalog].filter(([, p]) => p.ean).map(([k, p]) => [String(p.ean), k]))
  const desafio = new Map()
  const saleKeys = new Set(rows.map(r => r.sku))
  for (const p of campanha) {
    const chave = porSap.get(String(p.sku)) || porEan.get(String(p.ean)) ||
      (saleKeys.has(`sap:${p.sku}`) || !p.ean ? `sap:${p.sku}` : `ean:${p.ean}`)
    desafio.set(chave, catalog.get(chave) || { chave, codigo_sap: p.sku, ean: p.ean || '', descricao: p.descricao || `SAP ${p.sku}`, tipo: 'DESAFIO' })
  }
  const selected = rows.filter(r => (!inicio || r.mes >= inicio.slice(0, 7)) && (!fim || r.mes <= fim.slice(0, 7)))
  const summarize = items => {
    const groups = ['TOTAL', 'LANCAMENTO', 'PRIORITARIO', 'DESAFIO'].map(tipo => {
      const entries = tipo === 'DESAFIO' ? [...desafio] : [...catalog].filter(([, p]) => tipo === 'TOTAL' || p.tipo === tipo)
      const keys = new Set(entries.map(([k]) => k))
      const products = entries.map(([, p]) => p)
      const sales = items.filter(r => number(r.quantidade) > 0 && (tipo === 'TOTAL' || keys.has(r.sku)))
      const sold = new Set(sales.filter(r => keys.has(r.sku)).map(r => r.sku))
      return [tipo, { total: products.length, comprados: sold.size, faltantes: products.length - sold.size,
        percentual: products.length ? Math.round(sold.size / products.length * 1000) / 10 : 0,
        unidades: sales.reduce((sum, r) => sum + number(r.quantidade), 0) }]
    })
    return Object.fromEntries(groups)
  }
  const byClient = new Map(clientes.map(c => [String(c.id), []]))
  for (const row of selected) byClient.get(String(row.cliente_id))?.push(row)
  const bySku = new Map()
  for (const row of selected) {
    if (!row.sku || !number(row.quantidade)) continue
    if (!bySku.has(row.sku)) bySku.set(row.sku, [])
    bySku.get(row.sku).push(row)
  }
  const produtos = [...new Map([...catalog, ...desafio])].map(([sku, p]) => {
    const sales = bySku.get(sku) || []
    const orders = new Map()
    for (const r of sales) orders.set(r.cliente_id, (orders.get(r.cliente_id) || 0) + number(r.pedidos))
    return { sku, ean: p.ean || '', codigo_sap: p.codigo_sap || '', produto: p.descricao, tipo_mix: p.tipo, desafio: desafio.has(sku), no_catalogo: catalog.has(sku), unidades: sales.reduce((sum, r) => sum + number(r.quantidade), 0),
      clientes: orders.size, clientes_recompra: [...orders.values()].filter(n => n >= 2).length,
      ultima_compra: sales.map(r => r.ultima_compra).filter(Boolean).sort().at(-1) || null }
  }).sort((a, b) => b.unidades - a.unidades || a.produto.localeCompare(b.produto, 'pt-BR'))
  const monthly = new Map()
  for (const r of selected) {
    if (!monthly.has(r.mes)) monthly.set(r.mes, [])
    monthly.get(r.mes).push(r)
  }
  return { resumo: summarize(selected),
    clientes: clientes.map(c => ({ ...c, grupos: summarize(byClient.get(String(c.id)) || []) })),
    produtos, mensal: [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([mes, items]) => ({ mes, grupos: summarize(items) })),
    unidades_sem_catalogo: selected.filter(r => !catalog.has(r.sku)).reduce((sum, r) => sum + number(r.quantidade), 0) }
}
