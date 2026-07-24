import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../../_lib/commercial.js'
import { authorized } from '../../_lib/credentials.js'

const texto = (value) => String(value ?? '').trim()
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const html = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const iso = (year, month, day) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

function periodo(params) {
  const start = texto(params.get('inicio'))
  const end = texto(params.get('fim'))
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { inicio: start, fim: end }
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  const year = Number(parts.year)
  const month = Number(parts.month)
  return {
    inicio: iso(year, month, 1),
    fim: iso(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()),
  }
}

function mesAno(value) {
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const [year, month] = texto(value).split('-').map(Number)
  return year && month ? `${months[month - 1]}/${String(year).slice(-2)}` : texto(value)
}

function money(value) {
  const amount = numero(value)
  const absolute = Math.abs(amount)
  const [integer, decimal] = absolute.toFixed(2).split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${amount < 0 ? '-' : ''}R$ ${grouped},${decimal}`
}

function percent(value) {
  return `${numero(value).toFixed(2).replace('.', ',')}%`
}

function withGaps(item) {
  const objective = numero(item.objetivo)
  const realized = numero(item.realizado)
  return {
    sip: texto(item.sip),
    cnpjs: numero(item.cnpjs),
    objetivo: objective,
    realizado: realized,
    cobertura: objective > 0 ? realized / objective * 100 : 0,
    gap_80: realized - objective * 0.8,
    gap_90: realized - objective * 0.9,
    gap_100: realized - objective,
  }
}

async function carregar(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return { error: new Response('Chave administrativa não configurada.', { status: 503 }) }
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return { error: new Response('Acesso não autorizado.', { status: 401 }) }
  }

  const params = new URL(request.url).searchParams
  const { inicio, fim } = periodo(params)
  const result = await env.DB.prepare(`
    WITH vendas AS (
      SELECT pe.cliente_id,
             COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) realizado
        FROM pedidos pe
        JOIN itens_pedido ip ON ip.pedido_id=pe.id
        LEFT JOIN produtos pr ON pr.id=ip.produto_id
       WHERE ${ITEM_FATURADO}
         AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)
       GROUP BY pe.cliente_id
    )
    SELECT s.nome sip,
           COUNT(DISTINCT sc.cnpj) cnpjs,
           COALESCE(s.meta_mes,0) objetivo,
           COALESCE(SUM(v.realizado),0) realizado
      FROM sips s
      LEFT JOIN sip_clientes sc ON sc.sip_id=s.id AND sc.ativo=1
      LEFT JOIN clientes cl
        ON cl.cnpj=sc.cnpj AND cl.carteira_importada=1 AND cl.ativo=1
      LEFT JOIN vendas v ON v.cliente_id=cl.id
     WHERE s.ativo=1
     GROUP BY s.id,s.nome,s.meta_mes
     ORDER BY s.nome COLLATE NOCASE
  `).bind(inicio, fim).all()

  const rows = (result.results || []).map(withGaps)
  const totalObjective = rows.reduce((total, row) => total + row.objetivo, 0)
  const totalRealized = rows.reduce((total, row) => total + row.realizado, 0)
  const total = withGaps({
    sip: 'TOTAL DISTRITAL',
    cnpjs: rows.reduce((sum, row) => sum + row.cnpjs, 0),
    objetivo: totalObjective,
    realizado: totalRealized,
  })
  return { inicio, fim, rows, total }
}

function excelResponse(data) {
  const rowHtml = [...data.rows, data.total].map((row, index, all) => {
    const isTotal = index === all.length - 1
    const coverageClass = row.cobertura >= 90 ? 'coverage-high' : row.cobertura >= 80 ? 'coverage-mid' : 'coverage-low'
    const gap = (value) => `<td class="gap ${value < 0 ? 'negative' : 'positive'}">${money(value)}</td>`
    return `<tr class="${isTotal ? 'total' : ''}">
      <td class="sip">${html(row.sip)}</td>
      <td class="count">${row.cnpjs}</td>
      <td>${money(row.objetivo)}</td>
      <td>${money(row.realizado)}</td>
      <td class="${coverageClass}">${percent(row.cobertura)}</td>
      ${gap(row.gap_100)}${gap(row.gap_90)}${gap(row.gap_80)}
    </tr>`
  }).join('')

  const document = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;margin:0;color:#142033}.report{border-collapse:collapse;width:100%}.report th,.report td{border:1px solid #2f3742;padding:7px 9px;text-align:right;white-space:nowrap}.report .title th{background:#202b3b;color:#fff;font-size:16px;text-align:center}.report .period th{background:#eef0f2;color:#111;font-size:14px;text-align:center}.report .subtitle th{background:#46566c;color:#fff;font-size:14px;text-align:center}.report .columns th{background:#1298e5;color:#fff;font-size:13px;text-align:center}.report td.sip{text-align:left;font-weight:700;color:#315a7d}.report td.count{text-align:center}.report td.coverage-low{background:#f7b28c;color:#c01818;font-weight:700}.report td.coverage-mid{background:#fff7ad;font-weight:700}.report td.coverage-high{background:#ccebd5;color:#116b3d;font-weight:700}.report td.gap.negative{color:#c01818;font-weight:700}.report td.gap.positive{color:#17202b;font-weight:700}.report tr.total td{background:#9bb9e6;font-weight:800;color:#111}.report tr.total td.negative{color:#b20d0d}
  </style></head><body><table class="report">
    <thead>
      <tr class="title"><th colspan="8">RESUMO SIP</th></tr>
      <tr class="period"><th colspan="8">${mesAno(data.inicio)}</th></tr>
      <tr class="subtitle"><th colspan="8">OBJETIVO PREÇO LÍQUIDO · RESULTADO CONSOLIDADO POR SIP</th></tr>
      <tr class="columns"><th>SIP</th><th>CNPJs</th><th>OBJETIVO</th><th>REALIZADO</th><th>COBERTURA</th><th>GAP 100%</th><th>GAP 90%</th><th>GAP 80%</th></tr>
    </thead>
    <tbody>${rowHtml}</tbody>
  </table></body></html>`

  return new Response(document, { headers: {
    'content-type': 'application/vnd.ms-excel; charset=UTF-8',
    'content-disposition': `attachment; filename="resumo-sips-${data.inicio.slice(0, 7)}.xls"`,
    'cache-control': 'no-store',
  } })
}

function latin1Bytes(value) {
  const source = String(value)
  const bytes = new Uint8Array(source.length)
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    bytes[index] = code <= 255 ? code : 63
  }
  return bytes
}

function concatBytes(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function pdfEscape(value) {
  return String(value ?? '')
    .replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function pdfDocument(streams) {
  const objects = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  const kids = []

  streams.forEach((stream, index) => {
    const pageObject = 5 + index * 2
    const contentObject = pageObject + 1
    kids.push(`${pageObject} 0 R`)
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`
    const streamBytes = latin1Bytes(stream)
    objects[contentObject] = { stream, length: streamBytes.length }
  })
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${streams.length} >>`

  const parts = [latin1Bytes('%PDF-1.4\n%âãÏÓ\n')]
  const offsets = [0]
  let position = parts[0].length

  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = position
    const header = latin1Bytes(`${index} 0 obj\n`)
    const body = typeof objects[index] === 'string'
      ? latin1Bytes(objects[index])
      : concatBytes([
          latin1Bytes(`<< /Length ${objects[index].length} >>\nstream\n`),
          latin1Bytes(objects[index].stream),
          latin1Bytes('\nendstream'),
        ])
    const footer = latin1Bytes('\nendobj\n')
    parts.push(header, body, footer)
    position += header.length + body.length + footer.length
  }

  const xrefPosition = position
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let index = 1; index < objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF`
  parts.push(latin1Bytes(xref))
  return concatBytes(parts)
}

function buildPdf(data) {
  const pageWidth = 842
  const pageHeight = 595
  const margin = 18
  const rowHeight = 24
  const maxRows = 17
  const columns = [
    { label: 'SIP', width: 235, align: 'left' },
    { label: 'CNPJs', width: 55, align: 'right' },
    { label: 'OBJETIVO', width: 95, align: 'right' },
    { label: 'REALIZADO', width: 95, align: 'right' },
    { label: 'COBERTURA', width: 70, align: 'right' },
    { label: 'GAP 100%', width: 85, align: 'right' },
    { label: 'GAP 90%', width: 85, align: 'right' },
    { label: 'GAP 80%', width: 85, align: 'right' },
  ]

  const pages = []
  for (let index = 0; index < data.rows.length; index += maxRows) pages.push(data.rows.slice(index, index + maxRows))
  if (!pages.length) pages.push([])
  if (pages.at(-1).length >= maxRows) pages.push([])

  const rgb = (hex) => {
    const value = hex.replace('#', '')
    return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
      .map((part) => part.toFixed(3)).join(' ')
  }

  const streams = pages.map((rows, pageIndex) => {
    const commands = []
    const rect = (x, top, width, height, fill, stroke = '#27303c') => {
      commands.push(`${rgb(fill)} rg ${rgb(stroke)} RG 0.5 w ${x} ${pageHeight - top - height} ${width} ${height} re B`)
    }
    const text = (value, x, top, width, options = {}) => {
      const fontSize = options.size || 8
      const font = options.bold ? 'F2' : 'F1'
      const color = options.color || '#17202b'
      const clean = pdfEscape(value)
      const estimated = clean.length * fontSize * 0.48
      const drawX = options.align === 'right' ? x + width - estimated - 4
        : options.align === 'center' ? x + Math.max(4, (width - estimated) / 2) : x + 5
      commands.push(`BT /${font} ${fontSize} Tf ${rgb(color)} rg ${Math.max(x + 2, drawX).toFixed(2)} ${(pageHeight - top - fontSize - 5).toFixed(2)} Td (${clean}) Tj ET`)
    }
    const headerBar = (top, height, fill, label, size) => {
      rect(margin, top, pageWidth - margin * 2, height, fill, fill)
      text(label, margin, top + 1, pageWidth - margin * 2, { size, bold: true, color: fill === '#eef0f2' ? '#111111' : '#ffffff', align: 'center' })
    }

    headerBar(10, 22, '#202b3b', 'RESUMO SIP', 13)
    headerBar(32, 20, '#eef0f2', mesAno(data.inicio), 12)
    headerBar(52, 20, '#46566c', 'OBJETIVO PRECO LIQUIDO - RESULTADO CONSOLIDADO POR SIP', 10)

    let x = margin
    columns.forEach((column) => {
      rect(x, 72, column.width, 24, '#1298e5', '#27303c')
      text(column.label, x, 74, column.width, { size: 8, bold: true, color: '#ffffff', align: 'center' })
      x += column.width
    })

    rows.forEach((row, rowIndex) => {
      const top = 96 + rowIndex * rowHeight
      const values = [row.sip, String(row.cnpjs), money(row.objetivo), money(row.realizado), percent(row.cobertura), money(row.gap_100), money(row.gap_90), money(row.gap_80)]
      x = margin
      columns.forEach((column, columnIndex) => {
        let fill = rowIndex % 2 ? '#f7f8f9' : '#ffffff'
        let color = '#17202b'
        let bold = columnIndex === 0
        if (columnIndex === 4) {
          fill = row.cobertura >= 90 ? '#ccebd5' : row.cobertura >= 80 ? '#fff7ad' : '#f7b28c'
          color = row.cobertura < 80 ? '#c01818' : row.cobertura >= 90 ? '#116b3d' : '#17202b'
          bold = true
        }
        if (columnIndex >= 5 && numero([row.gap_100, row.gap_90, row.gap_80][columnIndex - 5]) < 0) {
          color = '#c01818'; bold = true
        }
        rect(x, top, column.width, rowHeight, fill, '#737b84')
        const shown = columnIndex === 0 && values[columnIndex].length > 38 ? `${values[columnIndex].slice(0, 35)}...` : values[columnIndex]
        text(shown, x, top + 2, column.width, { size: columnIndex === 0 ? 7.4 : 7.1, bold, color, align: column.align })
        x += column.width
      })
    })

    if (pageIndex === pages.length - 1) {
      const top = 96 + rows.length * rowHeight
      const row = data.total
      const values = [row.sip, String(row.cnpjs), money(row.objetivo), money(row.realizado), percent(row.cobertura), money(row.gap_100), money(row.gap_90), money(row.gap_80)]
      x = margin
      columns.forEach((column, columnIndex) => {
        const gapValue = columnIndex >= 5 ? [row.gap_100, row.gap_90, row.gap_80][columnIndex - 5] : 0
        rect(x, top, column.width, rowHeight + 2, '#9bb9e6', '#27303c')
        text(values[columnIndex], x, top + 3, column.width, { size: 7.4, bold: true, color: columnIndex >= 5 && gapValue < 0 ? '#b20d0d' : '#111111', align: column.align })
        x += column.width
      })
    }

    text(`Página ${pageIndex + 1}/${pages.length}`, margin, 572, pageWidth - margin * 2, { size: 7, color: '#5b6470', align: 'right' })
    return commands.join('\n')
  })

  return pdfDocument(streams)
}

function pdfResponse(data) {
  const bytes = buildPdf(data)
  return new Response(bytes, { headers: {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="resumo-sips-${data.inicio.slice(0, 7)}.pdf"`,
    'cache-control': 'no-store',
  } })
}

export async function onRequestGet({ request, env }) {
  try {
    const data = await carregar(request, env)
    if (data.error) return data.error
    const format = texto(new URL(request.url).searchParams.get('formato')).toLowerCase()
    return format === 'pdf' ? pdfResponse(data) : excelResponse(data)
  } catch (error) {
    return new Response(`Não foi possível gerar o resumo consolidado das SIPs. ${error instanceof Error ? error.message : String(error)}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' },
    })
  }
}
