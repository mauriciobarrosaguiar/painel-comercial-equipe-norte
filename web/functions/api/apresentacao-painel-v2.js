import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../_lib/commercial.js'
import { authorized } from '../_lib/credentials.js'
import { loadConsultantReport, number, percentage, text } from '../_lib/consultant-report.js'
import { arquivarPeriodosEncerrados, consultarLinhasMissao, hojeSaoPaulo, listarHistoricosFoco } from '../_lib/focus-history.js'
import { buildPptx, shape, slideXml } from '../_lib/pptx-compatible.js'

const MIX_PRIORITARIO = "UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='PRIORITARIO'"
const MIX_LANCAMENTO = "UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='LANCAMENTO'"
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value))
const showDate = value => validDate(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : text(value)
const safeFile = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'painel'
const ratio = (value, goal) => number(goal) > 0 ? number(value) / number(goal) * 100 : 0
const chunks = (rows, size) => rows.length ? Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size)) : [[]]

async function loadSips(env, period) {
  const dateWhere = period.inicio && period.fim
    ? 'AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)'
    : ''
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
      id: text(item.id), nome: text(item.nome), cnpjs: number(item.cnpjs), objetivo,
      sem_combate: semCombate,
      prioritarios: number(item.prioritarios),
      lancamentos: number(item.lancamentos),
      cobertura: percentage(semCombate, objetivo),
      gap100: semCombate - objetivo,
      gap90: semCombate - objetivo * 0.9,
      gap80: semCombate - objetivo * 0.8,
    }
  })
  const total = {
    objetivo: rows.reduce((sum, row) => sum + row.objetivo, 0),
    sem_combate: rows.reduce((sum, row) => sum + row.sem_combate, 0),
    prioritarios: rows.reduce((sum, row) => sum + row.prioritarios, 0),
    lancamentos: rows.reduce((sum, row) => sum + row.lancamentos, 0),
    cnpjs: rows.reduce((sum, row) => sum + row.cnpjs, 0),
  }
  total.cobertura = percentage(total.sem_combate, total.objetivo)
  total.gap100 = total.sem_combate - total.objetivo
  total.gap90 = total.sem_combate - total.objetivo * 0.9
  total.gap80 = total.sem_combate - total.objetivo * 0.8
  return { rows, total }
}

function aggregateFocus(period, lines, status) {
  const map = new Map()
  for (const item of lines || []) {
    const key = text(item.foco_id)
    const row = map.get(key) || {
      id: key,
      descricao: text(item.descricao),
      ean: text(item.ean),
      meta: 0,
      realizado: 0,
      cnpjs: 0,
      pedidos: 0,
      faturamento: 0,
    }
    row.meta += number(item.meta_quantidade)
    row.realizado += number(item.realizado_quantidade)
    row.cnpjs += number(item.cnpj_positivados)
    row.pedidos += number(item.pedidos)
    row.faturamento += number(item.faturamento)
    map.set(key, row)
  }
  const rows = [...map.values()].map(row => ({ ...row, cobertura: percentage(row.realizado, row.meta) }))
  const total = {
    produtos: rows.length,
    meta: rows.reduce((sum, row) => sum + row.meta, 0),
    realizado: rows.reduce((sum, row) => sum + row.realizado, 0),
    cnpjs: rows.reduce((sum, row) => sum + row.cnpjs, 0),
    faturamento: rows.reduce((sum, row) => sum + row.faturamento, 0),
  }
  total.cobertura = percentage(total.realizado, total.meta)
  return { inicio: period.inicio, fim: period.fim, status, rows, total }
}

async function loadFocusSections(request, env) {
  await arquivarPeriodosEncerrados(env)
  const params = new URL(request.url).searchParams
  const consultant = text(params.get('consultor'))
  const today = hojeSaoPaulo()
  const periodsResult = await env.DB.prepare(`
    SELECT DISTINCT semana_inicio,semana_fim
    FROM foco_semanal
    WHERE ativo=1
      AND DATE(?) BETWEEN DATE(semana_inicio) AND DATE(semana_fim)
      AND EXISTS (
        SELECT 1 FROM foco_consultores fc
        WHERE fc.foco_id=foco_semanal.id AND fc.ativo=1 AND COALESCE(fc.meta_quantidade,0)>0
      )
    ORDER BY DATE(semana_inicio),DATE(semana_fim)
  `).bind(today).all()

  const ongoing = []
  for (const period of periodsResult.results || []) {
    let lines = await consultarLinhasMissao(env, text(period.semana_inicio), text(period.semana_fim))
    if (consultant) lines = lines.filter(line => text(line.consultor_id) === consultant)
    const section = aggregateFocus({ inicio: text(period.semana_inicio), fim: text(period.semana_fim) }, lines, 'EM ANDAMENTO')
    if (section.rows.length) ongoing.push(section)
  }

  const historyRaw = await listarHistoricosFoco(env, 12)
  const history = historyRaw.map(snapshot => {
    let lines = Array.isArray(snapshot.linhas) ? snapshot.linhas : []
    if (consultant) lines = lines.filter(line => text(line.consultor_id) === consultant)
    return aggregateFocus(snapshot.periodo || { inicio: '', fim: '' }, lines, 'ENCERRADO')
  }).filter(section => section.rows.length)

  return { ongoing, history }
}

function statusColor(value) {
  return value >= 100 ? '0B8F69' : value >= 80 ? 'C18A00' : 'C33D3D'
}
function statusFill(value) {
  return value >= 100 ? 'DDF4EB' : value >= 80 ? 'FFF1C2' : 'FFE1E1'
}
function gapFill(value) {
  return number(value) < 0 ? 'FFE1E1' : 'DDF4EB'
}
function addHeader(shapes, title, subtitle, accent = '0B8F69') {
  let id = 2
  shapes.push(shape({ id: id++, name: 'Top bar', x: 0, y: 0, w: 13.333, h: 0.18, fill: accent }))
  shapes.push(shape({ id: id++, name: 'Brand', x: 0.45, y: 0.38, w: 0.55, h: 0.55, text: 'N', size: 20, bold: true, align: 'ctr', color: 'FFFFFF', fill: '0B3153', radius: true, margin: 0 }))
  shapes.push(shape({ id: id++, name: 'Title', x: 1.12, y: 0.32, w: 8.4, h: 0.48, text: title, size: 24, bold: true, color: '17233B', margin: 0 }))
  shapes.push(shape({ id: id++, name: 'Subtitle', x: 1.13, y: 0.78, w: 11.2, h: 0.32, text: subtitle, size: 10.5, color: '627286', margin: 0 }))
  return id
}
function addFooter(shapes, id, page, generated) {
  shapes.push(shape({ id: id++, name: 'Footer', x: 0.48, y: 7.16, w: 12.35, h: 0.2, text: `Painel Comercial · Equipe Norte    |    Gerado em ${generated}    |    ${page}`, size: 8, color: '748294', margin: 0 }))
  return id
}
function metricCard(shapes, id, x, y, w, label, value, note = '', accent = '0B8F69') {
  shapes.push(shape({
    id: id++, name: label, x, y, w, h: 0.9, fill: 'FFFFFF', line: 'D9E2E8', radius: true,
    paragraphs: [
      { text: label.toUpperCase(), size: 9, color: '627286', bold: true, align: 'l' },
      { text: value, size: 18, color: accent, bold: true, align: 'l' },
      ...(note ? [{ text: note, size: 8.2, color: '748294', align: 'l' }] : []),
    ],
  }))
  return id
}
function table(shapes, id, { x, y, widths, headers, rows, rowHeight = 0.48, headerFill = '0B3153', fontSize = 9, alignments = [], fills = [] }) {
  let currentX = x
  headers.forEach((header, index) => {
    shapes.push(shape({ id: id++, name: `Header ${index + 1}`, x: currentX, y, w: widths[index], h: rowHeight, text: header, size: Math.min(9, fontSize + 0.4), bold: true, align: alignments[index] || 'ctr', color: 'FFFFFF', fill: headerFill, line: 'FFFFFF', lineWidth: 0.4, margin: 0.035 }))
    currentX += widths[index]
  })
  rows.forEach((row, rowIndex) => {
    currentX = x
    row.forEach((cell, colIndex) => {
      const cellFill = typeof fills[colIndex] === 'function' ? fills[colIndex](cell, row, rowIndex) : (rowIndex % 2 ? 'F7F9FB' : 'FFFFFF')
      const cellColor = cellFill === 'FFE1E1' ? 'A02E2E' : cellFill === 'DDF4EB' ? '0A6D4E' : cellFill === 'FFF1C2' ? '8A6200' : '243449'
      shapes.push(shape({ id: id++, name: `Cell ${rowIndex + 1}-${colIndex + 1}`, x: currentX, y: y + rowHeight * (rowIndex + 1), w: widths[colIndex], h: rowHeight, text: String(cell), size: fontSize, align: alignments[colIndex] || (colIndex ? 'r' : 'l'), color: cellColor, fill: cellFill, line: 'DCE4EA', lineWidth: 0.35, margin: 0.035 }))
      currentX += widths[colIndex]
    })
  })
  return id
}

function coverSlide(periodLabel, focusData, generated) {
  let id = 2
  const shapes = []
  shapes.push(shape({ id: id++, name: 'Background left', x: 0, y: 0, w: 8.5, h: 7.5, fill: '0B3153' }))
  shapes.push(shape({ id: id++, name: 'Accent', x: 8.5, y: 0, w: 4.833, h: 7.5, fill: '0B8F69' }))
  shapes.push(shape({ id: id++, name: 'Mark', x: 0.75, y: 0.7, w: 0.8, h: 0.8, text: 'N', size: 28, bold: true, align: 'ctr', color: '0B3153', fill: 'FFFFFF', radius: true, margin: 0 }))
  shapes.push(shape({ id: id++, name: 'Title', x: 0.75, y: 2.05, w: 7, h: 1.35, margin: 0, paragraphs: [
    { text: 'PAINEL COMERCIAL', size: 31, color: 'FFFFFF', bold: true, align: 'l' },
    { text: 'Equipe Norte', size: 24, color: 'A9E2CE', bold: true, align: 'l' },
  ] }))
  shapes.push(shape({ id: id++, name: 'Description', x: 0.78, y: 3.65, w: 6.8, h: 0.85, text: 'Apresentação automática das bases de Consultores, SIP e Foco Semanal.', size: 15, color: 'D8E5EE', margin: 0 }))
  shapes.push(shape({ id: id++, name: 'Period', x: 0.78, y: 5.3, w: 6.8, h: 0.7, margin: 0, paragraphs: [
    { text: `RESULTADOS: ${periodLabel}`, size: 11, color: 'A9E2CE', bold: true, align: 'l' },
    { text: `FOCOS: ${focusData.ongoing.length} em andamento · ${focusData.history.length} encerrados`, size: 11, color: 'D8E5EE', bold: true, align: 'l' },
  ] }))
  ;[
    ['CONSULTORES', 'Realizado, meta e cobertura por indicador'],
    ['SIP', 'GAP 100%, 90%, 80% e mix faturado'],
    ['FOCO SEMANAL', 'Vigentes e encerrados em páginas separadas'],
  ].forEach((item, index) => shapes.push(shape({ id: id++, name: item[0], x: 8.92, y: 1.4 + index * 1.55, w: 3.9, h: 1.05, fill: 'FFFFFF', line: 'FFFFFF', radius: true, paragraphs: [
    { text: item[0], size: 14, color: '0B3153', bold: true, align: 'l' },
    { text: item[1], size: 9.2, color: '627286', align: 'l' },
  ] })))
  shapes.push(shape({ id: id++, name: 'Generated', x: 8.95, y: 6.72, w: 3.8, h: 0.3, text: `Atualizado em ${generated}`, size: 9, color: 'DDF4EB', align: 'r', margin: 0 }))
  return slideXml(shapes, '0B3153')
}

function consultantSemCombatSlides(data, generated) {
  const rows = data.rows || []
  const total = data.total || {}
  const blocks = chunks(rows, 8)
  return blocks.map((block, pageIndex) => {
    const shapes = []
    let id = addHeader(shapes, pageIndex ? 'Consultores — Sem Combate (continuação)' : 'Consultores — Sem Combate', `${data.period.rotulo}${data.uf ? ` · UF ${data.uf}` : ''}`, '2584C4')
    const sc = ratio(total.ol_sem_combate, total.meta_ol_sem_combate)
    id = metricCard(shapes, id, 0.5, 1.25, 3.0, 'OL total faturado', money.format(total.ol_total_faturado || 0), `${integer.format(rows.length)} consultores`, '0B3153')
    id = metricCard(shapes, id, 3.7, 1.25, 3.0, 'Real Sem Combate', money.format(total.ol_sem_combate || 0), 'Faturado no período', '2584C4')
    id = metricCard(shapes, id, 6.9, 1.25, 2.8, 'Meta Sem Combate', money.format(total.meta_ol_sem_combate || 0), 'Objetivo da equipe', '0B3153')
    id = metricCard(shapes, id, 9.9, 1.25, 2.9, '% Sem Combate', `${decimal.format(sc)}%`, 'Cobertura da meta', statusColor(sc))
    const tableRows = block.map(row => [row.nome, row.setor || '—', money.format(row.ol_total_faturado || 0), money.format(row.meta_ol_sem_combate || 0), money.format(row.ol_sem_combate || 0), `${decimal.format(ratio(row.ol_sem_combate, row.meta_ol_sem_combate))}%`])
    id = table(shapes, id, {
      x: 0.45, y: 2.42, widths: [3.0, 1.2, 1.8, 1.8, 1.8, 1.8],
      headers: ['CONSULTOR', 'SETOR', 'OL TOTAL', 'META SC', 'REAL SC', '% SC'], rows: tableRows,
      rowHeight: 0.46, headerFill: '2584C4', fontSize: 8.2,
      alignments: ['l', 'ctr', 'r', 'r', 'r', 'ctr'],
      fills: [null, null, null, null, null, cell => statusFill(Number(String(cell).replace('%', '').replace(',', '.')))],
    })
    addFooter(shapes, id, `Consultores SC ${pageIndex + 1}/${blocks.length}`, generated)
    return slideXml(shapes)
  })
}

function consultantMixSlides(data, generated) {
  const rows = data.rows || []
  const total = data.total || {}
  const blocks = chunks(rows, 8)
  return blocks.map((block, pageIndex) => {
    const shapes = []
    let id = addHeader(shapes, pageIndex ? 'Consultores — Prioritários e Lançamentos (continuação)' : 'Consultores — Prioritários e Lançamentos', `${data.period.rotulo}${data.uf ? ` · UF ${data.uf}` : ''}`, '0B8F69')
    const p = ratio(total.ol_prioritarios, total.meta_ol_prioritarios)
    const l = ratio(total.ol_lancamentos, total.meta_ol_lancamentos)
    id = metricCard(shapes, id, 0.5, 1.25, 3.0, 'Real Prioritários', money.format(total.ol_prioritarios || 0), `Meta ${money.format(total.meta_ol_prioritarios || 0)}`, '0B8F69')
    id = metricCard(shapes, id, 3.7, 1.25, 2.8, '% Prioritários', `${decimal.format(p)}%`, 'Cobertura da meta', statusColor(p))
    id = metricCard(shapes, id, 6.7, 1.25, 3.0, 'Real Lançamentos', money.format(total.ol_lancamentos || 0), `Meta ${money.format(total.meta_ol_lancamentos || 0)}`, '7A64B3')
    id = metricCard(shapes, id, 9.9, 1.25, 2.9, '% Lançamentos', `${decimal.format(l)}%`, 'Cobertura da meta', statusColor(l))
    const tableRows = block.map(row => [
      row.nome,
      money.format(row.meta_ol_prioritarios || 0), money.format(row.ol_prioritarios || 0), `${decimal.format(ratio(row.ol_prioritarios, row.meta_ol_prioritarios))}%`,
      money.format(row.meta_ol_lancamentos || 0), money.format(row.ol_lancamentos || 0), `${decimal.format(ratio(row.ol_lancamentos, row.meta_ol_lancamentos))}%`,
    ])
    id = table(shapes, id, {
      x: 0.45, y: 2.42, widths: [3.0, 1.55, 1.55, 1.1, 1.55, 1.55, 1.1],
      headers: ['CONSULTOR', 'META P', 'REAL P', '% P', 'META L', 'REAL L', '% L'], rows: tableRows,
      rowHeight: 0.46, headerFill: '0B8F69', fontSize: 8.0,
      alignments: ['l', 'r', 'r', 'ctr', 'r', 'r', 'ctr'],
      fills: [null, null, null, cell => statusFill(Number(String(cell).replace('%', '').replace(',', '.'))), null, null, cell => statusFill(Number(String(cell).replace('%', '').replace(',', '.')))],
    })
    addFooter(shapes, id, `Consultores P/L ${pageIndex + 1}/${blocks.length}`, generated)
    return slideXml(shapes)
  })
}

function sipGapSlides(data, period, generated) {
  const blocks = chunks(data.rows || [], 8)
  return blocks.map((block, pageIndex) => {
    const shapes = []
    let id = addHeader(shapes, pageIndex ? 'SIP — Objetivo e GAP (continuação)' : 'SIP — Objetivo e GAP', `${period.rotulo} · Resultado consolidado por SIP`, '0B8F69')
    id = metricCard(shapes, id, 0.5, 1.25, 3.0, 'Objetivo total', money.format(data.total.objetivo || 0), `${integer.format(data.total.cnpjs || 0)} CNPJs`, '0B3153')
    id = metricCard(shapes, id, 3.7, 1.25, 3.0, 'Real Sem Combate', money.format(data.total.sem_combate || 0), 'Resultado consolidado', '0B8F69')
    id = metricCard(shapes, id, 6.9, 1.25, 2.8, 'Cobertura', `${decimal.format(data.total.cobertura || 0)}%`, 'Objetivo preço líquido', statusColor(data.total.cobertura || 0))
    id = metricCard(shapes, id, 9.9, 1.25, 2.9, 'GAP 100%', money.format(data.total.gap100 || 0), `GAP 90% ${money.format(data.total.gap90 || 0)} · GAP 80% ${money.format(data.total.gap80 || 0)}`, data.total.gap100 < 0 ? 'C33D3D' : '0B8F69')
    const tableRows = block.map(row => [row.nome, integer.format(row.cnpjs), money.format(row.objetivo), money.format(row.sem_combate), `${decimal.format(row.cobertura)}%`, money.format(row.gap100), money.format(row.gap90), money.format(row.gap80)])
    id = table(shapes, id, {
      x: 0.35, y: 2.42, widths: [2.75, 0.65, 1.45, 1.45, 1.0, 1.45, 1.45, 1.45],
      headers: ['SIP', 'CNPJs', 'OBJETIVO', 'REAL SC', 'COBERT.', 'GAP 100%', 'GAP 90%', 'GAP 80%'], rows: tableRows,
      rowHeight: 0.46, headerFill: '0B8F69', fontSize: 7.5,
      alignments: ['l', 'ctr', 'r', 'r', 'ctr', 'r', 'r', 'r'],
      fills: [null, null, null, null, cell => statusFill(Number(String(cell).replace('%', '').replace(',', '.'))), (_, row) => gapFill(row[5]), (_, row) => gapFill(row[6]), (_, row) => gapFill(row[7])],
    })
    addFooter(shapes, id, `SIP GAP ${pageIndex + 1}/${blocks.length}`, generated)
    return slideXml(shapes)
  })
}

function sipMixSlides(data, period, generated) {
  const blocks = chunks(data.rows || [], 8)
  return blocks.map((block, pageIndex) => {
    const shapes = []
    let id = addHeader(shapes, pageIndex ? 'SIP — Mix faturado (continuação)' : 'SIP — Mix faturado', `${period.rotulo} · Sem Combate inclui Prioritários e Lançamentos`, '7A64B3')
    id = metricCard(shapes, id, 0.5, 1.25, 3.0, 'Sem Combate', money.format(data.total.sem_combate || 0), 'Resultado total da linha', '2584C4')
    id = metricCard(shapes, id, 3.7, 1.25, 3.0, 'Prioritários', money.format(data.total.prioritarios || 0), `${decimal.format(ratio(data.total.prioritarios, data.total.sem_combate))}% do Sem Combate`, '0B8F69')
    id = metricCard(shapes, id, 6.9, 1.25, 3.0, 'Lançamentos', money.format(data.total.lancamentos || 0), `${decimal.format(ratio(data.total.lancamentos, data.total.sem_combate))}% do Sem Combate`, '7A64B3')
    id = metricCard(shapes, id, 10.1, 1.25, 2.7, 'SIPs', integer.format(data.rows.length), `${integer.format(data.total.cnpjs || 0)} CNPJs`, '0B3153')
    const tableRows = block.map(row => [row.nome, integer.format(row.cnpjs), money.format(row.sem_combate), money.format(row.prioritarios), money.format(row.lancamentos)])
    id = table(shapes, id, {
      x: 0.55, y: 2.42, widths: [3.55, 0.9, 2.25, 2.25, 2.25],
      headers: ['SIP', 'CNPJs', 'SEM COMBATE', 'PRIORITÁRIOS', 'LANÇAMENTOS'], rows: tableRows,
      rowHeight: 0.48, headerFill: '7A64B3', fontSize: 8.6,
      alignments: ['l', 'ctr', 'r', 'r', 'r'],
    })
    addFooter(shapes, id, `SIP Mix ${pageIndex + 1}/${blocks.length}`, generated)
    return slideXml(shapes)
  })
}

function focusSlides(sections, status, generated) {
  if (!sections.length) {
    const shapes = []
    let id = addHeader(shapes, `Foco Semanal — ${status}`, status === 'EM ANDAMENTO' ? 'Nenhuma missão vigente na data de geração' : 'Nenhuma missão encerrada disponível', status === 'EM ANDAMENTO' ? '7A64B3' : '627286')
    shapes.push(shape({ id: id++, name: 'Empty focus', x: 1.15, y: 2.55, w: 11.0, h: 1.65, text: status === 'EM ANDAMENTO' ? 'Nenhum foco em andamento.' : 'Nenhum foco encerrado no histórico.', size: 21, bold: true, align: 'ctr', color: '627286', fill: 'FFFFFF', line: 'D9E2E8', radius: true }))
    addFooter(shapes, id, `Foco ${status}`, generated)
    return [slideXml(shapes)]
  }
  const slides = []
  sections.forEach((section, sectionIndex) => {
    const blocks = chunks(section.rows, 7)
    blocks.forEach((block, pageIndex) => {
      const shapes = []
      const accent = status === 'EM ANDAMENTO' ? '7A64B3' : '627286'
      let id = addHeader(shapes, `Foco Semanal — ${status}${pageIndex ? ' (continuação)' : ''}`, `${showDate(section.inicio)} a ${showDate(section.fim)} · Período ${sectionIndex + 1}/${sections.length}`, accent)
      id = metricCard(shapes, id, 0.5, 1.25, 2.8, 'Produtos foco', integer.format(section.total.produtos || 0), status, accent)
      id = metricCard(shapes, id, 3.5, 1.25, 2.8, 'Meta total', integer.format(section.total.meta || 0), 'Quantidade', '0B3153')
      id = metricCard(shapes, id, 6.5, 1.25, 2.8, 'Realizado', integer.format(section.total.realizado || 0), `${decimal.format(section.total.cobertura || 0)}% da meta`, statusColor(section.total.cobertura || 0))
      id = metricCard(shapes, id, 9.5, 1.25, 3.3, 'Faturamento', money.format(section.total.faturamento || 0), `${integer.format(section.total.cnpjs || 0)} positivações`, '0B8F69')
      const tableRows = block.map(row => [row.descricao, row.ean || '—', integer.format(row.meta), integer.format(row.realizado), `${decimal.format(row.cobertura)}%`, integer.format(row.cnpjs), money.format(row.faturamento)])
      id = table(shapes, id, {
        x: 0.38, y: 2.42, widths: [3.35, 1.5, 1.1, 1.15, 1.2, 1.0, 2.45],
        headers: ['PRODUTO', 'EAN', 'META', 'REAL', 'COBERTURA', 'CNPJs', 'FATURAMENTO'], rows: tableRows,
        rowHeight: 0.5, headerFill: accent, fontSize: 8.5,
        alignments: ['l', 'ctr', 'r', 'r', 'ctr', 'ctr', 'r'],
        fills: [null, null, null, null, cell => statusFill(Number(String(cell).replace('%', '').replace(',', '.')))],
      })
      addFooter(shapes, id, `Foco ${status} ${sectionIndex + 1}.${pageIndex + 1}`, generated)
      slides.push(slideXml(shapes))
    })
  })
  return slides
}

export async function onRequestGet({ request, env }) {
  try {
    if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) return new Response('Acesso não autorizado.', { status: 401 })
    const consultantData = await loadConsultantReport(request, env)
    if (consultantData.error) return consultantData.error
    const selectedConsultant = text(new URL(request.url).searchParams.get('consultor'))
    if (selectedConsultant) {
      consultantData.rows = consultantData.rows.filter(row => row.id === selectedConsultant)
      consultantData.total = consultantData.rows[0] || {
        ol_total_faturado: 0, ol_sem_combate: 0, ol_prioritarios: 0, ol_lancamentos: 0,
        meta_ol_sem_combate: 0, meta_ol_prioritarios: 0, meta_ol_lancamentos: 0, valor_nao_faturado: 0,
      }
    }
    const [sips, focusData] = await Promise.all([loadSips(env, consultantData.period), loadFocusSections(request, env)])
    const generated = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date())
    const slides = [
      coverSlide(consultantData.period.rotulo, focusData, generated),
      ...consultantSemCombatSlides(consultantData, generated),
      ...consultantMixSlides(consultantData, generated),
      ...sipGapSlides(sips, consultantData.period, generated),
      ...sipMixSlides(sips, consultantData.period, generated),
      ...focusSlides(focusData.ongoing, 'EM ANDAMENTO', generated),
      ...focusSlides(focusData.history, 'ENCERRADO', generated),
    ]
    const bytes = buildPptx({ slides, title: 'Painel Comercial Equipe Norte', subject: 'Consultores, SIP e Foco Semanal' })
    const periodName = consultantData.period.inicio ? consultantData.period.inicio.slice(0, 7) : 'todo-periodo'
    return new Response(bytes, { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'content-disposition': `attachment; filename="painel-equipe-norte-${safeFile(periodName)}.pptx"`,
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    } })
  } catch (error) {
    return new Response(`Não foi possível gerar a apresentação. ${error instanceof Error ? error.message : String(error)}`, { status: 500, headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' } })
  }
}
