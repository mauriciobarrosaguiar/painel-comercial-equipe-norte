import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../_lib/commercial.js'
import { authorized } from '../_lib/credentials.js'
import { loadConsultantReport, number, percentage, text } from '../_lib/consultant-report.js'
import { arquivarPeriodosEncerrados, consultarLinhasMissao, hojeSaoPaulo, listarHistoricosFoco } from '../_lib/focus-history.js'

const WIDTH = 2400
const HEIGHT = 1350
const MIX_PRIORITARIO = "UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='PRIORITARIO'"
const MIX_LANCAMENTO = "UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='LANCAMENTO'"
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const safe = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'relatorio'
const showDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : text(value)
const esc = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
const truncate = (value, max) => {
  const source = text(value)
  return source.length > max ? `${source.slice(0, Math.max(1, max - 1))}…` : source
}
const ratio = (value, goal) => number(goal) > 0 ? number(value) / number(goal) * 100 : 0
const statusFill = value => value >= 100 ? '#dff4e9' : value >= 80 ? '#fff1c2' : '#ffe1e1'
const statusColor = value => value >= 100 ? '#087455' : value >= 80 ? '#8a6200' : '#a02e2e'
const gapFill = value => number(value) < 0 ? '#ffe1e1' : '#dff4e9'
const gapColor = value => number(value) < 0 ? '#a02e2e' : '#087455'

function svgText(x, y, value, options = {}) {
  const { size = 30, fill = '#243449', weight = 400, anchor = 'start', family = 'Arial, Helvetica, sans-serif' } = options
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="middle">${esc(value)}</text>`
}

function rect(x, y, width, height, fill, radius = 0, stroke = 'none', strokeWidth = 1) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
}

function pageShell(title, subtitle, accent, content, footer) {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    ${rect(0, 0, WIDTH, HEIGHT, '#f4f7fa')}
    ${rect(0, 0, WIDTH, 18, accent)}
    ${rect(55, 45, 72, 72, '#0b3153', 18)}
    ${svgText(91, 82, 'N', { size: 38, fill: '#ffffff', weight: 800, anchor: 'middle' })}
    ${svgText(150, 65, title, { size: 46, fill: '#17233b', weight: 800 })}
    ${svgText(150, 108, subtitle, { size: 23, fill: '#627286', weight: 500 })}
    ${content}
    ${svgText(55, 1318, `Painel Comercial · Equipe Norte · ${footer}`, { size: 18, fill: '#748294' })}
  </svg>`
}

function summaryCards(items, y = 150) {
  const gap = 18
  const available = WIDTH - 110
  const width = (available - gap * (items.length - 1)) / items.length
  return items.map((item, index) => {
    const x = 55 + index * (width + gap)
    return [
      rect(x, y, width, 145, '#ffffff', 18, '#d9e2e8', 2),
      svgText(x + 22, y + 35, String(item.label).toUpperCase(), { size: 19, fill: '#627286', weight: 700 }),
      svgText(x + 22, y + 82, item.value, { size: 31, fill: item.color || '#0b3153', weight: 800 }),
      svgText(x + 22, y + 119, item.note || '', { size: 17, fill: '#748294' }),
    ].join('')
  }).join('')
}

function tableSvg({ x = 55, y = 330, widths, headers, rows, rowHeight = 72, headerHeight = 82, fontSize = 22, headerFill = '#0b3153', alignments = [], cellStyles = [] }) {
  let output = ''
  let currentX = x
  headers.forEach((header, index) => {
    output += rect(currentX, y, widths[index], headerHeight, headerFill, 0, '#ffffff', 2)
    output += svgText(currentX + (alignments[index] === 'left' ? 14 : widths[index] / 2), y + headerHeight / 2, header, {
      size: Math.min(21, fontSize), fill: '#ffffff', weight: 800, anchor: alignments[index] === 'left' ? 'start' : 'middle',
    })
    currentX += widths[index]
  })
  rows.forEach((row, rowIndex) => {
    currentX = x
    row.forEach((cell, colIndex) => {
      const style = typeof cellStyles[colIndex] === 'function' ? cellStyles[colIndex](cell, row, rowIndex) : null
      const fill = style?.fill || (rowIndex % 2 ? '#f7f9fb' : '#ffffff')
      const color = style?.color || '#243449'
      const weight = style?.weight || (rowIndex === rows.length - 1 && row[0] === 'TOTAL' ? 800 : 500)
      output += rect(currentX, y + headerHeight + rowIndex * rowHeight, widths[colIndex], rowHeight, fill, 0, '#dce4ea', 2)
      const alignment = alignments[colIndex] || (colIndex ? 'right' : 'left')
      const textX = alignment === 'left' ? currentX + 14 : alignment === 'center' ? currentX + widths[colIndex] / 2 : currentX + widths[colIndex] - 14
      output += svgText(textX, y + headerHeight + rowIndex * rowHeight + rowHeight / 2, cell, {
        size: fontSize, fill: color, weight, anchor: alignment === 'left' ? 'start' : alignment === 'center' ? 'middle' : 'end',
      })
      currentX += widths[colIndex]
    })
  })
  return output
}

async function loadSips(env, period) {
  const dateWhere = period.inicio && period.fim ? 'AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)' : ''
  const params = period.inicio && period.fim ? [period.inicio, period.fim] : []
  const result = await env.DB.prepare(`
    WITH vendas AS (
      SELECT pe.cliente_id,
        COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) sem_combate,
        COALESCE(SUM(CASE WHEN ${MIX_PRIORITARIO} THEN ip.valor_faturado ELSE 0 END),0) prioritarios,
        COALESCE(SUM(CASE WHEN ${MIX_LANCAMENTO} THEN ip.valor_faturado ELSE 0 END),0) lancamentos
      FROM pedidos pe
      JOIN itens_pedido ip ON ip.pedido_id=pe.id
      LEFT JOIN produtos pr ON pr.id=ip.produto_id
      WHERE ${ITEM_FATURADO} ${dateWhere}
      GROUP BY pe.cliente_id
    )
    SELECT s.id,s.nome,COUNT(DISTINCT sc.cnpj) cnpjs,COALESCE(s.meta_mes,0) objetivo,
      COALESCE(SUM(v.sem_combate),0) sem_combate,
      COALESCE(SUM(v.prioritarios),0) prioritarios,
      COALESCE(SUM(v.lancamentos),0) lancamentos
    FROM sips s
    LEFT JOIN sip_clientes sc ON sc.sip_id=s.id AND sc.ativo=1
    LEFT JOIN clientes cl ON cl.cnpj=sc.cnpj AND cl.carteira_importada=1 AND cl.ativo=1
    LEFT JOIN vendas v ON v.cliente_id=cl.id
    WHERE s.ativo=1
    GROUP BY s.id,s.nome,s.meta_mes
    ORDER BY s.nome COLLATE NOCASE
  `).bind(...params).all()
  const rows = (result.results || []).map(item => {
    const objetivo = number(item.objetivo)
    const semCombate = number(item.sem_combate)
    return {
      nome: text(item.nome), cnpjs: number(item.cnpjs), objetivo, sem_combate: semCombate,
      prioritarios: number(item.prioritarios), lancamentos: number(item.lancamentos),
      cobertura: percentage(semCombate, objetivo), gap100: semCombate - objetivo,
      gap90: semCombate - objetivo * 0.9, gap80: semCombate - objetivo * 0.8,
    }
  })
  const total = rows.reduce((acc, row) => ({
    cnpjs: acc.cnpjs + row.cnpjs, objetivo: acc.objetivo + row.objetivo, sem_combate: acc.sem_combate + row.sem_combate,
    prioritarios: acc.prioritarios + row.prioritarios, lancamentos: acc.lancamentos + row.lancamentos,
  }), { cnpjs: 0, objetivo: 0, sem_combate: 0, prioritarios: 0, lancamentos: 0 })
  return { rows, total: { ...total, cobertura: percentage(total.sem_combate, total.objetivo), gap100: total.sem_combate - total.objetivo, gap90: total.sem_combate - total.objetivo * 0.9, gap80: total.sem_combate - total.objetivo * 0.8 } }
}

function buildFocusSection(period, lines, status) {
  const products = []
  const productMap = new Map()
  const consultants = []
  const consultantMap = new Map()
  const lineMap = new Map()
  for (const line of lines || []) {
    if (!productMap.has(line.foco_id)) {
      const product = { foco_id: text(line.foco_id), descricao: text(line.descricao), ean: text(line.ean) }
      productMap.set(line.foco_id, product)
      products.push(product)
    }
    if (!consultantMap.has(line.consultor_id)) {
      const consultant = { consultor_id: text(line.consultor_id), consultor: text(line.consultor), setor: text(line.setor) }
      consultantMap.set(line.consultor_id, consultant)
      consultants.push(consultant)
    }
    lineMap.set(`${line.consultor_id}|${line.foco_id}`, line)
  }
  consultants.sort((a, b) => a.setor.localeCompare(b.setor) || a.consultor.localeCompare(b.consultor, 'pt-BR'))
  return { periodo: period, status, products, consultants, lineMap }
}

async function loadFocus(request, env) {
  await arquivarPeriodosEncerrados(env)
  const params = new URL(request.url).searchParams
  const selectedConsultant = text(params.get('consultor'))
  const selectedUf = text(params.get('uf')).toUpperCase().slice(0, 2)
  let allowedConsultants = null
  if (selectedUf) {
    const allowed = await env.DB.prepare("SELECT DISTINCT consultor_id FROM clientes WHERE carteira_importada=1 AND ativo=1 AND UPPER(TRIM(COALESCE(uf,'')))=?").bind(selectedUf).all()
    allowedConsultants = new Set((allowed.results || []).map(item => text(item.consultor_id)))
  }
  const filterLines = source => (source || []).filter(line => (!selectedConsultant || text(line.consultor_id) === selectedConsultant) && (!allowedConsultants || allowedConsultants.has(text(line.consultor_id))))
  const today = hojeSaoPaulo()
  const activePeriods = await env.DB.prepare(`
    SELECT DISTINCT semana_inicio,semana_fim FROM foco_semanal
    WHERE ativo=1 AND DATE(?) BETWEEN DATE(semana_inicio) AND DATE(semana_fim)
      AND EXISTS (SELECT 1 FROM foco_consultores fc WHERE fc.foco_id=foco_semanal.id AND fc.ativo=1 AND COALESCE(fc.meta_quantidade,0)>0)
    ORDER BY DATE(semana_inicio),DATE(semana_fim)
  `).bind(today).all()
  const ongoing = []
  for (const period of activePeriods.results || []) {
    const lines = filterLines(await consultarLinhasMissao(env, text(period.semana_inicio), text(period.semana_fim)))
    if (lines.length) ongoing.push(buildFocusSection({ inicio: text(period.semana_inicio), fim: text(period.semana_fim) }, lines, 'EM ANDAMENTO'))
  }
  const history = (await listarHistoricosFoco(env, 12)).map(snapshot => {
    const lines = filterLines(Array.isArray(snapshot.linhas) ? snapshot.linhas : [])
    return lines.length ? buildFocusSection(snapshot.periodo || { inicio: '', fim: '' }, lines, 'ENCERRADO') : null
  }).filter(Boolean)
  return { ongoing, history }
}

function consultantPages(data, generated) {
  const maxRows = 12
  const source = data.rows || []
  const chunks = source.length ? Array.from({ length: Math.ceil(source.length / maxRows) }, (_, index) => source.slice(index * maxRows, (index + 1) * maxRows)) : [[]]
  return chunks.map((rows, pageIndex) => {
    const total = data.total || {}
    const bodyRows = rows.map(row => [
      truncate(row.nome, 28), row.setor || '—', money.format(row.ol_total_faturado || 0),
      money.format(row.meta_ol_sem_combate || 0), money.format(row.ol_sem_combate || 0), `${decimal.format(ratio(row.ol_sem_combate, row.meta_ol_sem_combate))}%`,
      money.format(row.meta_ol_prioritarios || 0), money.format(row.ol_prioritarios || 0), `${decimal.format(ratio(row.ol_prioritarios, row.meta_ol_prioritarios))}%`,
      money.format(row.meta_ol_lancamentos || 0), money.format(row.ol_lancamentos || 0), `${decimal.format(ratio(row.ol_lancamentos, row.meta_ol_lancamentos))}%`,
    ])
    if (pageIndex === chunks.length - 1) bodyRows.push([
      'TOTAL', '', money.format(total.ol_total_faturado || 0), money.format(total.meta_ol_sem_combate || 0), money.format(total.ol_sem_combate || 0), `${decimal.format(ratio(total.ol_sem_combate, total.meta_ol_sem_combate))}%`,
      money.format(total.meta_ol_prioritarios || 0), money.format(total.ol_prioritarios || 0), `${decimal.format(ratio(total.ol_prioritarios, total.meta_ol_prioritarios))}%`,
      money.format(total.meta_ol_lancamentos || 0), money.format(total.ol_lancamentos || 0), `${decimal.format(ratio(total.ol_lancamentos, total.meta_ol_lancamentos))}%`,
    ])
    const rowHeight = Math.min(72, Math.floor(800 / Math.max(1, bodyRows.length)))
    const content = summaryCards([
      { label: 'OL Total', value: money.format(total.ol_total_faturado || 0), note: `${integer.format(source.length)} consultores`, color: '#0b3153' },
      { label: 'Sem Combate', value: money.format(total.ol_sem_combate || 0), note: `Meta ${money.format(total.meta_ol_sem_combate || 0)} · ${decimal.format(ratio(total.ol_sem_combate, total.meta_ol_sem_combate))}%`, color: '#2584c4' },
      { label: 'Prioritários', value: money.format(total.ol_prioritarios || 0), note: `Meta ${money.format(total.meta_ol_prioritarios || 0)} · ${decimal.format(ratio(total.ol_prioritarios, total.meta_ol_prioritarios))}%`, color: '#0b8f69' },
      { label: 'Lançamentos', value: money.format(total.ol_lancamentos || 0), note: `Meta ${money.format(total.meta_ol_lancamentos || 0)} · ${decimal.format(ratio(total.ol_lancamentos, total.meta_ol_lancamentos))}%`, color: '#7a64b3' },
    ]) + tableSvg({
      widths: [360, 110, 190, 170, 170, 95, 170, 170, 95, 170, 170, 95],
      headers: ['CONSULTOR', 'SETOR', 'OL TOTAL', 'META SC', 'REAL SC', '% SC', 'META P', 'REAL P', '% P', 'META L', 'REAL L', '% L'],
      rows: bodyRows, rowHeight, fontSize: 19, headerFill: '#2584c4',
      alignments: ['left', 'center', 'right', 'right', 'right', 'center', 'right', 'right', 'center', 'right', 'right', 'center'],
      cellStyles: [null, null, null, null, null, cell => ({ fill: statusFill(Number(String(cell).replace('%', '').replace(',', '.'))), color: statusColor(Number(String(cell).replace('%', '').replace(',', '.'))) }), null, null, cell => ({ fill: statusFill(Number(String(cell).replace('%', '').replace(',', '.'))), color: statusColor(Number(String(cell).replace('%', '').replace(',', '.'))) }), null, null, cell => ({ fill: statusFill(Number(String(cell).replace('%', '').replace(',', '.'))), color: statusColor(Number(String(cell).replace('%', '').replace(',', '.'))) })],
    })
    return { name: `01-consultores${chunks.length > 1 ? `-${pageIndex + 1}` : ''}.png`, width: WIDTH, height: HEIGHT, svg: pageShell('Consultores', `${data.period.rotulo}${data.uf ? ` · UF ${data.uf}` : ''}${chunks.length > 1 ? ` · Página ${pageIndex + 1}/${chunks.length}` : ''}`, '#2584c4', content, `Gerado em ${generated}`) }
  })
}

function sipPages(data, period, generated) {
  const maxRows = 12
  const source = data.rows || []
  const chunks = source.length ? Array.from({ length: Math.ceil(source.length / maxRows) }, (_, index) => source.slice(index * maxRows, (index + 1) * maxRows)) : [[]]
  return chunks.map((rows, pageIndex) => {
    const total = data.total
    const bodyRows = rows.map(row => [truncate(row.nome, 30), integer.format(row.cnpjs), money.format(row.objetivo), money.format(row.sem_combate), money.format(row.prioritarios), money.format(row.lancamentos), `${decimal.format(row.cobertura)}%`, money.format(row.gap100), money.format(row.gap90), money.format(row.gap80)])
    if (pageIndex === chunks.length - 1) bodyRows.push(['TOTAL', integer.format(total.cnpjs), money.format(total.objetivo), money.format(total.sem_combate), money.format(total.prioritarios), money.format(total.lancamentos), `${decimal.format(total.cobertura)}%`, money.format(total.gap100), money.format(total.gap90), money.format(total.gap80)])
    const rowHeight = Math.min(75, Math.floor(805 / Math.max(1, bodyRows.length)))
    const content = summaryCards([
      { label: 'Objetivo', value: money.format(total.objetivo), note: `${integer.format(total.cnpjs)} CNPJs`, color: '#0b3153' },
      { label: 'Sem Combate', value: money.format(total.sem_combate), note: `${decimal.format(total.cobertura)}% de cobertura`, color: '#2584c4' },
      { label: 'Prioritários', value: money.format(total.prioritarios), note: 'Faturado no período', color: '#0b8f69' },
      { label: 'Lançamentos', value: money.format(total.lancamentos), note: 'Faturado no período', color: '#7a64b3' },
    ]) + tableSvg({
      widths: [350, 100, 190, 190, 185, 185, 120, 200, 200, 200],
      headers: ['SIP', 'CNPJs', 'OBJETIVO', 'REAL SC', 'PRIORITÁRIOS', 'LANÇAMENTOS', 'COBERT.', 'GAP 100%', 'GAP 90%', 'GAP 80%'],
      rows: bodyRows, rowHeight, fontSize: 19, headerFill: '#0b8f69',
      alignments: ['left', 'center', 'right', 'right', 'right', 'right', 'center', 'right', 'right', 'right'],
      cellStyles: [null, null, null, null, null, null, cell => ({ fill: statusFill(Number(String(cell).replace('%', '').replace(',', '.'))), color: statusColor(Number(String(cell).replace('%', '').replace(',', '.'))) }), cell => ({ fill: gapFill(cell), color: gapColor(cell) }), cell => ({ fill: gapFill(cell), color: gapColor(cell) }), cell => ({ fill: gapFill(cell), color: gapColor(cell) })],
    })
    return { name: `02-sips${chunks.length > 1 ? `-${pageIndex + 1}` : ''}.png`, width: WIDTH, height: HEIGHT, svg: pageShell('SIP / Redes', `${period.rotulo} · Consolidado por SIP${chunks.length > 1 ? ` · Página ${pageIndex + 1}/${chunks.length}` : ''}`, '#0b8f69', content, `Gerado em ${generated}`) }
  })
}

function focusPages(sections, status, generated, startIndex) {
  const pages = []
  let fileIndex = startIndex
  if (!sections.length) {
    const content = rect(220, 360, 1960, 360, '#ffffff', 26, '#d9e2e8', 2) + svgText(1200, 515, status === 'EM ANDAMENTO' ? 'Nenhum foco em andamento.' : 'Nenhum foco encerrado no histórico.', { size: 44, fill: '#627286', weight: 800, anchor: 'middle' })
    pages.push({ name: `${String(fileIndex).padStart(2, '0')}-foco-${status === 'EM ANDAMENTO' ? 'em-andamento' : 'encerrado'}.png`, width: WIDTH, height: HEIGHT, svg: pageShell(`Foco Semanal — ${status}`, 'Sem dados disponíveis', status === 'EM ANDAMENTO' ? '#7a64b3' : '#627286', content, `Gerado em ${generated}`) })
    return pages
  }
  for (const [sectionIndex, section] of sections.entries()) {
    const productChunks = section.products.length ? Array.from({ length: Math.ceil(section.products.length / 3) }, (_, index) => section.products.slice(index * 3, (index + 1) * 3)) : [[]]
    const consultantChunks = section.consultants.length ? Array.from({ length: Math.ceil(section.consultants.length / 10) }, (_, index) => section.consultants.slice(index * 10, (index + 1) * 10)) : [[]]
    for (const [productPage, products] of productChunks.entries()) {
      for (const [consultantPage, consultants] of consultantChunks.entries()) {
        const widths = [370, 120]
        const headers = ['CONSULTOR', 'SETOR']
        const alignments = ['left', 'center']
        const styles = [null, null]
        products.forEach(product => {
          widths.push(170, 170, 120)
          headers.push(`${truncate(product.descricao, 16)} META`, 'REAL', '%')
          alignments.push('right', 'right', 'center')
          styles.push(null, null, cell => ({ fill: statusFill(Number(String(cell).replace('%', '').replace(',', '.'))), color: statusColor(Number(String(cell).replace('%', '').replace(',', '.'))) }))
        })
        const bodyRows = consultants.map(consultant => {
          const row = [truncate(consultant.consultor, 30), consultant.setor || '—']
          products.forEach(product => {
            const line = section.lineMap.get(`${consultant.consultor_id}|${product.foco_id}`)
            const meta = number(line?.meta_quantidade)
            const realized = number(line?.realizado_quantidade)
            row.push(integer.format(meta), integer.format(realized), `${decimal.format(ratio(realized, meta))}%`)
          })
          return row
        })
        const totals = products.map(product => consultants.reduce((acc, consultant) => {
          const line = section.lineMap.get(`${consultant.consultor_id}|${product.foco_id}`)
          return { meta: acc.meta + number(line?.meta_quantidade), realized: acc.realized + number(line?.realizado_quantidade) }
        }, { meta: 0, realized: 0 }))
        const totalRow = ['TOTAL', '']
        totals.forEach(total => totalRow.push(integer.format(total.meta), integer.format(total.realized), `${decimal.format(ratio(total.realized, total.meta))}%`))
        bodyRows.push(totalRow)
        const totalWidth = widths.reduce((sum, width) => sum + width, 0)
        const factor = 2290 / totalWidth
        const scaledWidths = widths.map(width => Math.floor(width * factor))
        const rowHeight = Math.min(76, Math.floor(780 / Math.max(1, bodyRows.length)))
        const subtitle = `${showDate(section.periodo.inicio)} a ${showDate(section.periodo.fim)} · ${sectionIndex + 1}/${sections.length}${productChunks.length > 1 || consultantChunks.length > 1 ? ` · Bloco ${productPage + 1}.${consultantPage + 1}` : ''}`
        const content = summaryCards(products.map(product => {
          const all = section.consultants.reduce((acc, consultant) => {
            const line = section.lineMap.get(`${consultant.consultor_id}|${product.foco_id}`)
            return { meta: acc.meta + number(line?.meta_quantidade), realized: acc.realized + number(line?.realizado_quantidade), billing: acc.billing + number(line?.faturamento) }
          }, { meta: 0, realized: 0, billing: 0 })
          return { label: truncate(product.descricao, 26), value: `${integer.format(all.realized)} / ${integer.format(all.meta)}`, note: `${decimal.format(ratio(all.realized, all.meta))}% · ${money.format(all.billing)}`, color: status === 'EM ANDAMENTO' ? '#7a64b3' : '#627286' }
        }), 150) + tableSvg({ widths: scaledWidths, headers, rows: bodyRows, rowHeight, fontSize: products.length >= 3 ? 18 : 21, headerFill: status === 'EM ANDAMENTO' ? '#7a64b3' : '#627286', alignments, cellStyles: styles })
        pages.push({ name: `${String(fileIndex++).padStart(2, '0')}-foco-${status === 'EM ANDAMENTO' ? 'em-andamento' : 'encerrado'}-${sectionIndex + 1}-${productPage + 1}-${consultantPage + 1}.png`, width: WIDTH, height: HEIGHT, svg: pageShell(`Foco Semanal — ${status}`, subtitle, status === 'EM ANDAMENTO' ? '#7a64b3' : '#627286', content, `Gerado em ${generated}`) })
      }
    }
  }
  return pages
}

export async function onRequestGet({ request, env }) {
  try {
    if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) return new Response('Acesso não autorizado.', { status: 401 })
    const consultantData = await loadConsultantReport(request, env)
    if (consultantData.error) return consultantData.error
    const selectedConsultant = text(new URL(request.url).searchParams.get('consultor'))
    if (selectedConsultant) {
      consultantData.rows = consultantData.rows.filter(row => row.id === selectedConsultant)
      consultantData.total = consultantData.rows[0] || {}
    }
    const [sips, focus] = await Promise.all([loadSips(env, consultantData.period), loadFocus(request, env)])
    const generated = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date())
    const consultant = consultantPages(consultantData, generated)
    const sip = sipPages(sips, consultantData.period, generated)
    const ongoing = focusPages(focus.ongoing, 'EM ANDAMENTO', generated, consultant.length + sip.length + 1)
    const history = focusPages(focus.history, 'ENCERRADO', generated, consultant.length + sip.length + ongoing.length + 1)
    const periodName = consultantData.period.inicio ? consultantData.period.inicio.slice(0, 7) : 'todo-periodo'
    return new Response(JSON.stringify({ filename: `relatorios-painel-${safe(periodName)}.zip`, pages: [...consultant, ...sip, ...ongoing, ...history] }), {
      headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    })
  } catch (error) {
    return new Response(`Não foi possível gerar as imagens. ${error instanceof Error ? error.message : String(error)}`, { status: 500, headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' } })
  }
}
