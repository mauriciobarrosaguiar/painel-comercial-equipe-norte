const text = value => String(value ?? '').trim()
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
export const digits = value => text(value).replace(/\D/g, '')
export const normalize = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

export function inferUf(value) {
  const normalized = ` ${normalize(value).replace(/[^A-Z0-9]+/g, ' ')} `
  const matches = ['TO','PA','MT','MA','DF','GO','PI'].filter(uf => normalized.includes(` ${uf} `))
  return matches[0] || ''
}

export function cleanCnpj(value) {
  const result = digits(value)
  return result && result.length < 14 ? result.padStart(14, '0') : result.slice(-14)
}

export function cleanEan(value) {
  return digits(value)
}

export function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  let raw = text(value).replace(/R\$|\s/g, '')
  if (!raw) return 0
  if (raw.includes(',') && raw.includes('.')) raw = raw.replaceAll('.', '').replace(',', '.')
  else if (raw.includes(',')) raw = raw.replace(',', '.')
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

export function sortOffers(offers, rules, mode) {
  const ruleMap = new Map(rules.map((rule, index) => [rule.distribuidora, { ...rule, index }]))
  return [...offers].sort((a, b) => {
    const ra = ruleMap.get(a.distribuidora) || { prioridade: 999, index: 999 }
    const rb = ruleMap.get(b.distribuidora) || { prioridade: 999, index: 999 }
    if (mode === 'melhor_preco') return a.preco - b.preco || ra.prioridade - rb.prioridade || ra.index - rb.index
    if (mode === 'misto') return ra.prioridade - rb.prioridade || a.preco - b.preco || ra.index - rb.index
    return ra.prioridade - rb.prioridade || ra.index - rb.index || a.preco - b.preco
  })
}

const totalOf = (item, offer) => number(item.quantidade) * number(offer?.preco)

function totals(items) {
  const map = new Map()
  for (const item of items) {
    if (!item.offer) continue
    const dist = item.offer.distribuidora
    map.set(dist, (map.get(dist) || 0) + totalOf(item, item.offer))
  }
  return map
}

function canRemoveFromSource(item, sourceRule, currentTotals) {
  if (!item.offer) return false
  const current = currentTotals.get(item.offer.distribuidora) || 0
  const after = current - totalOf(item, item.offer)
  const minimum = number(sourceRule?.pedido_minimo)
  return after <= 0.005 || minimum <= 0 || after + 0.005 >= minimum
}

function selectCandidates(candidates, gap, mode) {
  const ordered = [...candidates].sort((a, b) => {
    if (mode === 'melhor_preco') {
      const deltaA = totalOf(a.item, a.target) - totalOf(a.item, a.item.offer)
      const deltaB = totalOf(b.item, b.target) - totalOf(b.item, b.item.offer)
      return deltaA - deltaB || totalOf(a.item, a.target) - totalOf(b.item, b.target) || a.item.index - b.item.index
    }
    return totalOf(a.item, a.target) - totalOf(b.item, b.target) || a.item.index - b.item.index
  })
  const chosen = []
  let value = 0
  for (const candidate of ordered) {
    chosen.push(candidate)
    value += totalOf(candidate.item, candidate.target)
    if (value + 0.005 >= gap) break
  }
  return value + 0.005 >= gap ? chosen : []
}

export function allocateCnpj(items, config) {
  const activeRules = (config?.distribuidoras || []).filter(rule => rule.utilizar !== false)
    .map((rule, index) => ({
      distribuidora: text(rule.distribuidora),
      prioridade: Math.max(1, Math.floor(number(rule.prioridade) || index + 1)),
      pedido_minimo: Math.max(0, number(rule.pedido_minimo)),
      index,
    }))
  const mode = ['prioridade','melhor_preco','misto'].includes(config?.modo) ? config.modo : 'prioridade'
  const ruleMap = new Map(activeRules.map(rule => [rule.distribuidora, rule]))
  const disabled = new Set()

  for (const item of items) {
    const eligible = item.offers.filter(offer => ruleMap.has(offer.distribuidora) && offer.estoque >= item.quantidade && offer.preco > 0)
    item.sortedOffers = sortOffers(eligible, activeRules, mode)
    item.offer = item.sortedOffers[0] || null
    if (!item.offer) item.status = item.eanExiste ? 'SEM ESTOQUE' : 'EAN NÃO LOCALIZADO'
  }

  for (let iteration = 0; iteration < activeRules.length * 3 + 3; iteration += 1) {
    const currentTotals = totals(items)
    const under = activeRules
      .filter(rule => !disabled.has(rule.distribuidora))
      .filter(rule => {
        const value = currentTotals.get(rule.distribuidora) || 0
        return value > 0.005 && rule.pedido_minimo > 0 && value + 0.005 < rule.pedido_minimo
      })
      .sort((a, b) => a.prioridade - b.prioridade || a.index - b.index)
    if (!under.length) break
    let changed = false

    for (const targetRule of under) {
      const beforeTotals = totals(items)
      const current = beforeTotals.get(targetRule.distribuidora) || 0
      const gap = targetRule.pedido_minimo - current
      const candidates = []
      for (const item of items) {
        if (!item.offer || item.offer.distribuidora === targetRule.distribuidora) continue
        const sourceRule = ruleMap.get(item.offer.distribuidora)
        if ((mode === 'prioridade' || mode === 'misto') && sourceRule && sourceRule.prioridade <= targetRule.prioridade) continue
        if (!canRemoveFromSource(item, sourceRule, beforeTotals)) continue
        const target = item.sortedOffers.find(offer => offer.distribuidora === targetRule.distribuidora)
        if (target) candidates.push({ item, target })
      }
      const chosen = selectCandidates(candidates, gap, mode)
      if (chosen.length) {
        const snapshot = chosen.map(({ item }) => [item, item.offer])
        for (const candidate of chosen) candidate.item.offer = candidate.target
        const afterTotals = totals(items)
        const validSources = [...new Set(snapshot.map(([, offer]) => offer?.distribuidora).filter(Boolean))]
          .every(dist => {
            const rule = ruleMap.get(dist)
            const value = afterTotals.get(dist) || 0
            return value <= 0.005 || !rule?.pedido_minimo || value + 0.005 >= rule.pedido_minimo
          })
        if ((afterTotals.get(targetRule.distribuidora) || 0) + 0.005 >= targetRule.pedido_minimo && validSources) {
          changed = true
          continue
        }
        for (const [item, offer] of snapshot) item.offer = offer
      }

      disabled.add(targetRule.distribuidora)
      for (const item of items) {
        if (item.offer?.distribuidora !== targetRule.distribuidora) continue
        item.offer = item.sortedOffers.find(offer => !disabled.has(offer.distribuidora)) || null
        if (!item.offer) item.status = 'PEDIDO MÍNIMO NÃO ATINGIDO'
      }
      changed = true
    }
    if (!changed) break
  }

  const finalTotals = totals(items)
  for (const item of items) {
    if (item.offer) item.status = 'DISTRIBUÍDO'
  }
  return { items, totals: finalTotals, disabled: [...disabled], mode, rules: activeRules }
}
