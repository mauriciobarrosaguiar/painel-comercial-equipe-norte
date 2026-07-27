import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../_lib/commercial.js'
import { authorized } from '../_lib/credentials.js'
import { loadConsultantReport, number, percentage, text } from '../_lib/consultant-report.js'
import { buildPptx, shape, slideXml } from '../_lib/pptx-compatible.js'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value))
const showDate = value => validDate(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : text(value)
const safeFile = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'painel'
const ratio = (value, goal) => number(goal) > 0 ? number(value) / number(goal) * 100 : 0
const chunks = (rows, size) => rows.length
  ? Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size))
  : [[]]

function currentWeek() {
  const now = new Date()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { inicio: iso(monday), fim: iso(sunday) }
}

async function loadSips(env, period) {
  const dateWhere = period.inicio && period.fim
    ? 'AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)'
    : ''
  const params = period.inicio && period.fim ? [period.inicio, period.fim] : []
  const result = await env.DB.prepare(`
    WITH vendas AS (
      SELECT pe.cliente_id,
        COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) realizado
      FROM pedidos pe
      JOIN itens_pedido ip ON ip.pedido_id=pe.id
      LEFT JOIN produtos pr ON pr.id=ip.produto_id
      WHERE ${ITEM_FATURADO} ${dateWhere}
      GROUP BY pe.cliente_id
    )
    SELECT s.id,s.nome,COUNT(DISTINCT sc.cnpj) cnpjs,COALESCE(s.meta_mes,0) objetivo,
      COALESCE(SUM(v.realizado),0) realizado
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
    const realizado = number(item.realizado)
    return {
      id: text(item.id), nome: text(item.nome), cnpjs: number(item.cnpjs),
      objetivo, realizado, cobertura: percentage(realizado, objetivo), gap: realizado - objetivo,
    }
  })
  const total = {
    objetivo: rows.reduce((sum, row) => sum + row.objetivo, 0),
    realizado: rows.reduce((sum, row) => sum + row.realizado, 0),
    cnpjs: rows.reduce((sum, row) => sum + row.cnpjs, 0),
  }
  total.cobertura = percentage(total.realizado, total.objetivo)
  total.gap = total.realizado - total.objetivo
  return { rows, total }
}

async function loadFocus(request, env) {
  const params = new URL(request.url).searchParams
  const standard = currentWeek()
  const inicio = validDate(params.get('foco_inicio')) ? params.get('foco_inicio') : standard.inicio
  const fim = validDate(params.get('foco_fim')) ? params.get('foco_fim') : standard.fim
  const consultant = text(params.get('consultor'))
  const uf = text(params.get('uf')).toUpperCase().slice(0, 2)
  const sql = `
    WITH focos AS (
      SELECT f.id foco_id,f.semana_inicio,f.semana_fim,
        COALESCE(NULLIF(TRIM(f.produto_id),''),pr.id,'') produto_id,
        COALESCE(NULLIF(TRIM(f.ean),''),pr.ean,'') ean,
        COALESCE(NULLIF(TRIM(f.descricao),''),pr.descricao,'Produto foco') descricao
      FROM foco_semanal f
      LEFT JOIN produtos pr ON pr.id=NULLIF(TRIM(f.produto_id),'')
        OR (NULLIF(TRIM(f.produto_id),'') IS NULL AND pr.ean=f.ean)
      WHERE f.ativo=1 AND DATE(f.semana_inicio)=DATE(?) AND DATE(f.semana_fim)=DATE(?)
    ), metas AS (
      SELECT f.*,co.id consultor_id,co.nome consultor,COALESCE(fc.meta_quantidade,0) meta_quantidade
      FROM focos f
      JOIN foco_consultores fc ON fc.foco_id=f.foco_id AND fc.ativo=1 AND COALESCE(fc.meta_quantidade,0)>0
      JOIN consultores co ON co.id=fc.consultor_id AND co.ativo=1 AND co.origem='PAINEL_EQUIPE'
      WHERE (?='' OR co.id=?)
        AND (?='' OR EXISTS(
          SELECT 1 FROM clientes cu
          WHERE cu.consultor_id=co.id AND cu.carteira_importada=1 AND cu.ativo=1
            AND UPPER(TRIM(COALESCE(cu.uf,'')))=?
        ))
    ), vendas AS (
      SELECT COALESCE(NULLIF(TRIM(pe.consultor_id),''),cl.consultor_id) consultor_id,
        cl.id cliente_id,COALESCE(NULLIF(TRIM(ip.produto_id),''),pr.id,'') produto_id,
        COALESCE(NULLIF(TRIM(ip.ean),''),pr.ean,'') ean,pe.id pedido_id,
        COALESCE(ip.quantidade_faturada,0) quantidade_faturada,COALESCE(ip.valor_faturado,0) faturamento
      FROM itens_pedido ip
      JOIN pedidos pe ON pe.id=ip.pedido_id
      LEFT JOIN produtos pr ON pr.id=ip.produto_id
      JOIN clientes cl ON cl.id=pe.cliente_id AND cl.carteira_importada=1 AND cl.ativo=1
      WHERE ${ITEM_FATURADO}
        AND DATE(COALESCE(NULLIF(TRIM(pe.data_faturamento),''),NULLIF(TRIM(pe.data_pedido),''))) BETWEEN DATE(?) AND DATE(?)
        AND (?='' OR UPPER(TRIM(COALESCE(cl.uf,'')))=?)
    )
    SELECT m.foco_id,m.produto_id,m.ean,m.descricao,m.consultor_id,m.consultor,m.meta_quantidade,
      COUNT(DISTINCT CASE WHEN v.quantidade_faturada>0 THEN v.cliente_id END) cnpjs,
      COUNT(DISTINCT CASE WHEN v.quantidade_faturada>0 THEN v.pedido_id END) pedidos,
      COALESCE(SUM(v.quantidade_faturada),0) realizado,COALESCE(SUM(v.faturamento),0) faturamento
    FROM metas m
    LEFT JOIN vendas v ON v.consultor_id=m.consultor_id AND (
      (m.produto_id<>'' AND v.produto_id=m.produto_id) OR
      (m.ean<>'' AND REPLACE(REPLACE(REPLACE(TRIM(v.ean),'.0',''),' ',''),'-','')=
        REPLACE(REPLACE(REPLACE(TRIM(m.ean),'.0',''),' ',''),'-',''))
    )
    GROUP BY m.foco_id,m.consultor_id
    ORDER BY m.descricao COLLATE NOCASE,m.consultor COLLATE NOCASE
  `
  const result = await env.DB.prepare(sql).bind(inicio, fim, consultant, consultant, uf, uf, inicio, fim, uf, uf).all()
  const productMap = new Map()
  for (const item of result.results || []) {
    const key = text(item.foco_id)
    const row = productMap.get(key) || {
      id: key, descricao: text(item.descricao), ean: text(item.ean),
      meta: 0, realizado: 0, cnpjs: 0, pedidos: 0, faturamento: 0,
    }
    row.meta += number(item.meta_quantidade)
    row.realizado += number(item.realizado)
    row.cnpjs += number(item.cnpjs)
    row.pedidos += number(item.pedidos)
    row.faturamento += number(item.faturamento)
    productMap.set(key, row)
  }
  const rows = [...productMap.values()].map(row => ({ ...row, cobertura: percentage(row.realizado, row.meta) }))
  const total = {
    produtos: rows.length,
    meta: rows.reduce((sum, row) => sum + row.meta, 0),
    realizado: rows.reduce((sum, row) => sum + row.realizado, 0),
    cnpjs: rows.reduce((sum, row) => sum + row.cnpjs, 0),
    faturamento: rows.reduce((sum, row) => sum + row.faturamento, 0),
  }
  total.cobertura = percentage(total.realizado, total.meta)
  return { inicio, fim, rows, total }
}

function statusColor(value) {
  return value >= 100 ? '0B8F69' : value >= 80 ? 'C18A00' : 'C33D3D'
}
function statusFill(value) {
  return value >= 100 ? 'DDF4EB' : value >= 80 ? 'FFF1C2' : 'FFE1E1'
}
function addHeader(shapes, title, subtitle, accent = '0B8F69') {
  let id = 2
  shapes.push(shape({ id: id++, name: 'Top bar', x: 0, y: 0, w: 13.333, h: 0.18, fill: accent }))
  shapes.push(shape({ id: id++, name: 'Brand', x: 0.45, y: 0.38, w: 0.55, h: 0.55, text: 'N', size: 20, bold: true, align: 'ctr', color: 'FFFFFF', fill: '0B3153', radius: true, margin: 0 }))
  shapes.push(shape({ id: id++, name: 'Title', x: 1.12, y: 0.32, w: 7.8, h: 0.48, text: title, size: 25, bold: true, color: '17233B', margin: 0 }))
  shapes.push(shape({ id: id++, name: 'Subtitle', x: 1.13, y: 0.78, w: 10.7, h: 0.32, text: subtitle, size: 10.5, color: '627286', margin: 0 }))
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
      { text: value, size: 19, color: accent, bold: true, align: 'l' },
      ...(note ? [{ text: note, size: 8.5, color: '748294', align: 'l' }] : []),
    ],
  }))
  return id
}
function table(shapes, id, {
  x, y, widths, headers, rows, rowHeight = 0.48, headerFill = '0B3153',
  fontSize = 9, alignments = [], fills = [],
}) {
  let currentX = x
  headers.forEach((header, index) => {
    shapes.push(shape({
      id: id++, name: `Header ${index + 1}`, x: currentX, y, w: widths[index], h: rowHeight,
      text: header, size: 9, bold: true, align: alignments[index] || 'ctr', color: 'FFFFFF',
      fill: headerFill, line: 'FFFFFF', lineWidth: 0.4, margin: 0.04,
    }))
    currentX += widths[index]
  })
  rows.forEach((row, rowIndex) => {
    currentX = x
    row.forEach((cell, colIndex) => {
      const cellFill = typeof fills[colIndex] === 'function'
        ? fills[colIndex](cell, row, rowIndex)
        : (rowIndex % 2 ? 'F7F9FB' : 'FFFFFF')
      const cellColor = cellFill === 'FFE1E1'
        ? 'A02E2E'
        : cellFill === 'DDF4EB' ? '0A6D4E' : cellFill === 'FFF1C2' ? '8A6200' : '243449'
      shapes.push(shape({
        id: id++, name: `Cell ${rowIndex + 1}-${colIndex + 1}`,
        x: currentX, y: y + rowHeight * (rowIndex + 1), w: widths[colIndex], h: rowHeight,
        text: String(cell), size: fontSize, align: alignments[colIndex] || (colIndex ? 'r' : 'l'),
        color: cellColor, fill: cellFill, line: 'DCE4EA', lineWidth: 0.35, margin: 0.04,
      }))
      currentX += widths[colIndex]
    })
  })
  return id
}
function coverSlide(periodLabel, focusLabel, generated) {
  let id = 2
  const shapes = []
  shapes.push(shape({ id: id++, name: 'Background left', x: 0, y: 0, w: 8.5, h: 7.5, fill: '0B3153' }))
  shapes.push(shape({ id: id++, name: 'Accent', x: 8.5, y: 0, w: 4.833, h: 7.5, fill: '0B8F69' }))
  shapes.push(shape({ id: id++, name: 'Mark', x: 0.75, y: 0.7, w: 0.8, h: 0.8, text: 'N', size: 28, bold: true, align: 'ctr', color: '0B3153', fill: 'FFFFFF', radius: true, margin: 0 }))
  shapes.push(shape({
    id: id++, name: 'Title', x: 0.75, y: 2.05, w: 7, h: 1.35, margin: 0,
    paragraphs: [
      { text: 'PAINEL COMERCIAL', size: 31, color: 'FFFFFF', bold: true, align: 'l' },
      { text: 'Equipe Norte', size: 24, color: 'A9E2CE', bold: true, align: 'l' },
    ],
  }))
  shapes.push(shape({ id: id++, name: 'Description', x: 0.78, y: 3.65, w: 6.8, h: 0.85, text: 'Apresentação automática das bases de Consultores, SIP e Foco Semanal.', size: 15, color: 'D8E5EE', margin: 0 }))
  shapes.push(shape({
    id: id++, name: 'Period', x: 0.78, y: 5.3, w: 6.8, h: 0.7, margin: 0,
    paragraphs: [
      { text: `RESULTADOS: ${periodLabel}`, size: 11, color: 'A9E2CE', bold: true, align: 'l' },
      { text: `FOCO SEMANAL: ${focusLabel}`, size: 11, color: 'D8E5EE', bold: true, align: 'l' },
    ],
  }))
  ;[
    ['CONSULTORES', 'Metas, realizado e atingimento'],
    ['SIP', 'Objetivo, cobertura e GAP'],
    ['FOCO SEMANAL', 'Meta, realizado e positivação'],
  ].forEach((item, index) => {
    shapes.push(shape({
      id: id++, name: item[0], x: 8.92, y: 1.4 + index * 1.55, w: 3.9, h: 1.05,
      fill: 'FFFFFF', line: 'FFFFFF', radius: true,
      paragraphs: [
        { text: item[0], size: 14, color: '0B3153', bold: true, align: 'l' },
        { text: item[1], size: 9.5, color: '627286', align: 'l' },
      ],
    }))
  })
  shapes.push(shape({ id: id++, name: 'Generated', x: 8.95, y: 6.72, w: 3.8, h: 0.3, text: `Atualizado em ${generated}`, size: 9, color: 'DDF4EB', align: 'r', margin: 0 }))
  return slideXml(shapes, '0B3153')
}
function consultantSlides(data, generated) {
  const rows = data.rows || []
  const total = data.total || {}
  const blocks = chunks(rows, 7)
  return blocks.map((block, pageIndex) => {
    const shapes = []
    let id = addHeader(shapes, pageIndex ? 'Consultores — continuação' : 'Consultores', `${data.period.rotulo}${data.uf ? ` · UF ${data.uf}` : ''}`, '2584C4')
    id = metricCard(shapes, id, 0.5, 1.25, 3.0, 'OL total faturado', money.format(total.ol_total_faturado || 0), `${integer.format(rows.length)} consultores`, '0B3153')
    id = metricCard(shapes, id, 3.7, 1.25, 3.0, 'OL sem combate', money.format(total.ol_sem_combate || 0), `Meta ${money.format(total.meta_ol_sem_combate || 0)}`, statusColor(ratio(total.ol_sem_combate, total.meta_ol_sem_combate)))
    id = metricCard(shapes, id, 6.9, 1.25, 2.8, 'Cobertura SC', `${decimal.format(ratio(total.ol_sem_combate, total.meta_ol_sem_combate))}%`, 'Resultado da equipe', statusColor(ratio(total.ol_sem_combate, total.meta_ol_sem_combate)))
    id = metricCard(shapes, id, 9.9, 1.25, 2.9, 'Ainda não faturado', money.format(total.valor_nao_faturado || 0), 'Pedidos atendidos/enviados', 'C18A00')
    const tableRows = block.map(row => [
      row.nome, row.setor || '—', money.format(row.ol_total_faturado || 0),
      money.format(row.ol_sem_combate || 0),
      `${decimal.format(ratio(row.ol_sem_combate, row.meta_ol_sem_combate))}%`,
      `${decimal.format(ratio(row.ol_prioritarios, row.meta_ol_prioritarios))}%`,
      `${decimal.format(ratio(row.ol_lancamentos, row.meta_ol_lancamentos))}%`,
    ])
    id = table(shapes, id, {
      x: 0.45, y: 2.42, widths: [3.05, 1.3, 1.75, 1.85, 1.0, 1.0, 1.0],
      headers: ['CONSULTOR', 'SETOR', 'OL TOTAL', 'SEM COMBATE', '% SC', '% P', '% L'],
      rows: tableRows, rowHeight: 0.5, headerFill: '2584C4', fontSize: 8.6,
      alignments: ['l', 'ctr', 'r', 'r', 'ctr', 'ctr', 'ctr'],
      fills: [null, null, null, null,
        cell => statusFill(Number(String(cell).replace('%', '').replace(',', '.'))),
        cell => statusFill(Number(String(cell).replace('%', '').replace(',', '.'))),
        cell => statusFill(Number(String(cell).replace('%', '').replace(',', '.'))),
      ],
    })
    addFooter(shapes, id, `Consultores ${pageIndex + 1}/${blocks.length}`, generated)
    return slideXml(shapes)
  })
}
function sipSlides(data, period, generated) {
  const blocks = chunks(data.rows || [], 8)
  return blocks.map((block, pageIndex) => {
    const shapes = []
    let id = addHeader(shapes, pageIndex ? 'SIP / Redes — continuação' : 'SIP / Redes', `${period.rotulo} · Resultado consolidado por SIP`, '0B8F69')
    id = metricCard(shapes, id, 0.5, 1.25, 3.0, 'Objetivo total', money.format(data.total.objetivo || 0), `${integer.format(data.total.cnpjs || 0)} CNPJs`, '0B3153')
    id = metricCard(shapes, id, 3.7, 1.25, 3.0, 'Realizado total', money.format(data.total.realizado || 0), 'OL sem combate', '0B8F69')
    id = metricCard(shapes, id, 6.9, 1.25, 2.8, 'Cobertura', `${decimal.format(data.total.cobertura || 0)}%`, 'Objetivo preço líquido', statusColor(data.total.cobertura || 0))
    id = metricCard(shapes, id, 9.9, 1.25, 2.9, 'GAP 100%', money.format(data.total.gap || 0), data.total.gap < 0 ? 'Falta para 100%' : 'Acima do objetivo', data.total.gap < 0 ? 'C33D3D' : '0B8F69')
    const tableRows = block.map(row => [
      row.nome, integer.format(row.cnpjs), money.format(row.objetivo), money.format(row.realizado),
      `${decimal.format(row.cobertura)}%`, money.format(row.gap),
    ])
    id = table(shapes, id, {
      x: 0.45, y: 2.42, widths: [3.35, 0.85, 2.0, 2.0, 1.25, 2.05],
      headers: ['SIP', 'CNPJs', 'OBJETIVO', 'REALIZADO', 'COBERTURA', 'GAP 100%'],
      rows: tableRows, rowHeight: 0.46, headerFill: '0B8F69', fontSize: 8.8,
      alignments: ['l', 'ctr', 'r', 'r', 'ctr', 'r'],
      fills: [null, null, null, null,
        cell => statusFill(Number(String(cell).replace('%', '').replace(',', '.'))),
        cell => String(cell).startsWith('-') ? 'FFE1E1' : 'DDF4EB',
      ],
    })
    addFooter(shapes, id, `SIP ${pageIndex + 1}/${blocks.length}`, generated)
    return slideXml(shapes)
  })
}
function focusSlides(data, generated) {
  const blocks = chunks(data.rows || [], 7)
  return blocks.map((block, pageIndex) => {
    const shapes = []
    let id = addHeader(shapes, pageIndex ? 'Foco Semanal — continuação' : 'Foco Semanal', `${showDate(data.inicio)} a ${showDate(data.fim)} · Missão comercial`, '7A64B3')
    id = metricCard(shapes, id, 0.5, 1.25, 2.8, 'Produtos foco', integer.format(data.total.produtos || 0), 'Missão do período', '7A64B3')
    id = metricCard(shapes, id, 3.5, 1.25, 2.8, 'Meta total', integer.format(data.total.meta || 0), 'Quantidade', '0B3153')
    id = metricCard(shapes, id, 6.5, 1.25, 2.8, 'Realizado', integer.format(data.total.realizado || 0), `${decimal.format(data.total.cobertura || 0)}% da meta`, statusColor(data.total.cobertura || 0))
    id = metricCard(shapes, id, 9.5, 1.25, 3.3, 'Faturamento', money.format(data.total.faturamento || 0), `${integer.format(data.total.cnpjs || 0)} positivações somadas`, '0B8F69')
    if (!block.length) {
      shapes.push(shape({
        id: id++, name: 'Empty focus', x: 1.15, y: 3.0, w: 11.0, h: 1.65,
        text: 'Nenhum produto cadastrado no Foco Semanal deste período.', size: 21, bold: true,
        align: 'ctr', color: '627286', fill: 'FFFFFF', line: 'D9E2E8', radius: true,
      }))
    } else {
      const tableRows = block.map(row => [
        row.descricao, row.ean || '—', integer.format(row.meta), integer.format(row.realizado),
        `${decimal.format(row.cobertura)}%`, integer.format(row.cnpjs), money.format(row.faturamento),
      ])
      id = table(shapes, id, {
        x: 0.38, y: 2.42, widths: [3.35, 1.5, 1.1, 1.15, 1.2, 1.0, 2.45],
        headers: ['PRODUTO', 'EAN', 'META', 'REAL', 'COBERTURA', 'CNPJs', 'FATURAMENTO'],
        rows: tableRows, rowHeight: 0.5, headerFill: '7A64B3', fontSize: 8.6,
        alignments: ['l', 'ctr', 'r', 'r', 'ctr', 'ctr', 'r'],
        fills: [null, null, null, null,
          cell => statusFill(Number(String(cell).replace('%', '').replace(',', '.'))),
        ],
      })
    }
    addFooter(shapes, id, `Foco Semanal ${pageIndex + 1}/${blocks.length}`, generated)
    return slideXml(shapes)
  })
}

export async function onRequestGet({ request, env }) {
  try {
    if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
      return new Response('Acesso não autorizado.', { status: 401 })
    }
    const consultantData = await loadConsultantReport(request, env)
    if (consultantData.error) return consultantData.error

    const selectedConsultant = text(new URL(request.url).searchParams.get('consultor'))
    if (selectedConsultant) {
      consultantData.rows = consultantData.rows.filter(row => row.id === selectedConsultant)
      consultantData.total = consultantData.rows[0] || {
        ol_total_faturado: 0, ol_sem_combate: 0, ol_prioritarios: 0, ol_lancamentos: 0,
        meta_ol_sem_combate: 0, meta_ol_prioritarios: 0, meta_ol_lancamentos: 0,
        valor_nao_faturado: 0,
      }
    }

    const [sips, focus] = await Promise.all([
      loadSips(env, consultantData.period),
      loadFocus(request, env),
    ])
    const generated = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
    }).format(new Date())
    const focusLabel = `${showDate(focus.inicio)} a ${showDate(focus.fim)}`
    const slides = [
      coverSlide(consultantData.period.rotulo, focusLabel, generated),
      ...consultantSlides(consultantData, generated),
      ...sipSlides(sips, consultantData.period, generated),
      ...focusSlides(focus, generated),
    ]
    const bytes = buildPptx({
      slides,
      title: 'Painel Comercial Equipe Norte',
      subject: 'Consultores, SIP e Foco Semanal',
    })
    const periodName = consultantData.period.inicio ? consultantData.period.inicio.slice(0, 7) : 'todo-periodo'
    return new Response(bytes, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'content-disposition': `attachment; filename="painel-equipe-norte-${safeFile(periodName)}.pptx"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    return new Response(`Não foi possível gerar a apresentação. ${error instanceof Error ? error.message : String(error)}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' },
    })
  }
}
