import {
  loadConsultantReport,
  number,
  percentage,
  safeName,
} from '../../_lib/consultant-report.js'

const PAGE_WIDTH = 1191
const PAGE_HEIGHT = 842
const MARGIN = 18
const ROW_HEIGHT = 25

function money(value) {
  const amount = number(value)
  const absolute = Math.abs(amount)
  const [integer, decimal] = absolute.toFixed(2).split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${amount < 0 ? '-' : ''}R$ ${grouped},${decimal}`
}

const percent = (value) => `${number(value).toFixed(1).replace('.', ',')}%`
const delta = (realized, goal) => number(realized) - number(goal)

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
  for (const part of parts) { result.set(part, offset); offset += part.length }
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
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`
    objects[contentObject] = { stream, length: latin1Bytes(stream).length }
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

const rgb = (hex) => {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
    .map((part) => part.toFixed(3)).join(' ')
}

function pageBuilder() {
  const commands = []
  const rect = (x, top, width, height, fill, stroke = '#52606d') => {
    commands.push(`${rgb(fill)} rg ${rgb(stroke)} RG 0.45 w ${x} ${PAGE_HEIGHT - top - height} ${width} ${height} re B`)
  }
  const text = (value, x, top, width, options = {}) => {
    const size = options.size || 7
    const font = options.bold ? 'F2' : 'F1'
    const color = options.color || '#17202b'
    const clean = pdfEscape(value)
    const estimated = clean.length * size * 0.47
    const drawX = options.align === 'right' ? x + width - estimated - 4
      : options.align === 'center' ? x + Math.max(3, (width - estimated) / 2) : x + 4
    commands.push(`BT /${font} ${size} Tf ${rgb(color)} rg ${Math.max(x + 2, drawX).toFixed(2)} ${(PAGE_HEIGHT - top - size - 6).toFixed(2)} Td (${clean}) Tj ET`)
  }
  const bar = (top, height, fill, label, size, darkText = false) => {
    rect(MARGIN, top, PAGE_WIDTH - MARGIN * 2, height, fill, fill)
    text(label, MARGIN, top + 2, PAGE_WIDTH - MARGIN * 2, { size, bold: true, color: darkText ? '#17202b' : '#ffffff', align: 'center' })
  }
  return { commands, rect, text, bar }
}

function performancePages(data) {
  const columns = [
    { label: 'CONSULTOR', width: 170, align: 'left' },
    { label: 'SETOR', width: 65, align: 'center' },
    { label: 'REAL OL TOTAL', width: 80, align: 'right' },
    { label: 'META', width: 75, align: 'right', group: 'sc' },
    { label: 'REAL', width: 75, align: 'right', group: 'sc' },
    { label: 'DELTA', width: 75, align: 'right', group: 'sc' },
    { label: '%', width: 55, align: 'right', group: 'sc' },
    { label: 'META', width: 75, align: 'right', group: 'priority' },
    { label: 'REAL', width: 75, align: 'right', group: 'priority' },
    { label: 'DELTA', width: 75, align: 'right', group: 'priority' },
    { label: '%', width: 55, align: 'right', group: 'priority' },
    { label: 'META', width: 75, align: 'right', group: 'launch' },
    { label: 'REAL', width: 75, align: 'right', group: 'launch' },
    { label: 'DELTA', width: 75, align: 'right', group: 'launch' },
    { label: '%', width: 55, align: 'right', group: 'launch' },
  ]
  const chunks = []
  for (let index = 0; index < data.rows.length; index += 22) chunks.push(data.rows.slice(index, index + 22))
  if (!chunks.length) chunks.push([])
  return chunks.map((rows, pageIndex) => {
    const { commands, rect, text, bar } = pageBuilder()
    bar(10, 25, '#18283d', 'DESEMPENHO DOS CONSULTORES', 14)
    bar(35, 21, '#eaf0f4', `${data.period.rotulo}${data.uf ? ` - UF ${data.uf}` : ''}`, 11, true)
    bar(56, 20, '#344257', 'METAS, REALIZADO, DIFERENCA E ATINGIMENTO', 10)

    const groupTop = 76
    const subTop = 98
    rect(MARGIN, groupTop, 170, 44, '#344257')
    text('CONSULTOR', MARGIN, groupTop + 11, 170, { size: 7, bold: true, color: '#ffffff', align: 'center' })
    rect(MARGIN + 170, groupTop, 65, 44, '#344257')
    text('SETOR', MARGIN + 170, groupTop + 11, 65, { size: 7, bold: true, color: '#ffffff', align: 'center' })
    rect(MARGIN + 235, groupTop, 80, 44, '#344257')
    text('REAL OL TOTAL', MARGIN + 235, groupTop + 11, 80, { size: 6.4, bold: true, color: '#ffffff', align: 'center' })
    const groupX = MARGIN + 315
    const groups = [
      ['OL SEM COMBATE', '#4c8fc0'], ['PRIORITARIOS', '#62a69d'], ['LANCAMENTOS', '#6fa76f'],
    ]
    groups.forEach(([label, fill], index) => {
      rect(groupX + index * 280, groupTop, 280, 22, fill)
      text(label, groupX + index * 280, groupTop + 2, 280, { size: 7, bold: true, color: '#ffffff', align: 'center' })
    })
    let x = MARGIN + 315
    columns.slice(3).forEach((column) => {
      const fill = column.group === 'sc' ? '#4c8fc0' : column.group === 'priority' ? '#62a69d' : '#6fa76f'
      rect(x, subTop, column.width, 22, fill)
      text(column.label, x, subTop + 2, column.width, { size: 6.5, bold: true, color: '#ffffff', align: 'center' })
      x += column.width
    })

    const render = (row, rowIndex, total = false) => {
      const top = 120 + rowIndex * ROW_HEIGHT
      const scDelta = delta(row.ol_sem_combate, row.meta_ol_sem_combate)
      const priorityDelta = delta(row.ol_prioritarios, row.meta_ol_prioritarios)
      const launchDelta = delta(row.ol_lancamentos, row.meta_ol_lancamentos)
      const values = [
        row.nome, row.setor || '-', money(row.ol_total_faturado),
        money(row.meta_ol_sem_combate), money(row.ol_sem_combate), money(scDelta), percent(percentage(row.ol_sem_combate, row.meta_ol_sem_combate)),
        money(row.meta_ol_prioritarios), money(row.ol_prioritarios), money(priorityDelta), percent(percentage(row.ol_prioritarios, row.meta_ol_prioritarios)),
        money(row.meta_ol_lancamentos), money(row.ol_lancamentos), money(launchDelta), percent(percentage(row.ol_lancamentos, row.meta_ol_lancamentos)),
      ]
      x = MARGIN
      columns.forEach((column, columnIndex) => {
        let fill = total ? '#a9c3e8' : rowIndex % 2 ? '#f6f8fa' : '#ffffff'
        let color = '#17202b'
        let bold = total || columnIndex === 0
        if ([5, 9, 13].includes(columnIndex)) {
          const value = [scDelta, priorityDelta, launchDelta][[5, 9, 13].indexOf(columnIndex)]
          color = value < 0 ? '#b42318' : '#0b7850'; bold = true
        }
        if ([6, 10, 14].includes(columnIndex)) {
          const rate = [percentage(row.ol_sem_combate, row.meta_ol_sem_combate), percentage(row.ol_prioritarios, row.meta_ol_prioritarios), percentage(row.ol_lancamentos, row.meta_ol_lancamentos)][[6, 10, 14].indexOf(columnIndex)]
          fill = rate >= 100 ? '#dff4eb' : rate >= 80 ? '#fff1bd' : '#ffe0dd'
          color = rate >= 100 ? '#0b7850' : rate >= 80 ? '#886000' : '#a92525'; bold = true
        }
        rect(x, top, column.width, ROW_HEIGHT, fill, '#9eabb5')
        const shown = columnIndex === 0 && String(values[columnIndex]).length > 28 ? `${String(values[columnIndex]).slice(0, 25)}...` : values[columnIndex]
        text(shown, x, top + 3, column.width, { size: columnIndex === 0 ? 6.5 : 5.9, bold, color, align: column.align })
        x += column.width
      })
    }

    rows.forEach((row, index) => render(row, index))
    if (pageIndex === chunks.length - 1) render(data.total, rows.length, true)
    text(`Indicadores de OL - pagina ${pageIndex + 1}/${chunks.length}`, MARGIN, 818, PAGE_WIDTH - MARGIN * 2, { size: 7, color: '#5d6b7e', align: 'right' })
    return commands.join('\n')
  })
}

function pendingPages(data) {
  const columns = [
    { label: 'CONSULTOR', width: 250, align: 'left' },
    { label: 'SETOR', width: 105, align: 'center' },
    { label: 'TOTAL', width: 160, align: 'right' },
    { label: 'SEM COMBATE', width: 160, align: 'right' },
    { label: 'PRIORITARIOS', width: 160, align: 'right' },
    { label: 'LANCAMENTOS', width: 160, align: 'right' },
    { label: 'COMBATE', width: 160, align: 'right' },
  ]
  const chunks = []
  for (let index = 0; index < data.rows.length; index += 22) chunks.push(data.rows.slice(index, index + 22))
  if (!chunks.length) chunks.push([])
  return chunks.map((rows, pageIndex) => {
    const { commands, rect, text, bar } = pageBuilder()
    bar(10, 25, '#18283d', 'ATENDIDOS E AINDA NAO FATURADOS', 14)
    bar(35, 21, '#eaf0f4', `${data.period.rotulo}${data.uf ? ` - UF ${data.uf}` : ''}`, 11, true)
    bar(56, 20, '#8b6b13', 'ABERTURA POR CLASSIFICACAO DE MIX', 10)
    let x = MARGIN
    columns.forEach((column, index) => {
      rect(x, 76, column.width, 34, index < 2 ? '#344257' : '#e8c96e')
      text(column.label, x, 84, column.width, { size: 7, bold: true, color: index < 2 ? '#ffffff' : '#553d04', align: 'center' })
      x += column.width
    })
    const render = (row, rowIndex, total = false) => {
      const values = [row.nome, row.setor || '-', money(row.valor_nao_faturado), money(row.valor_nao_faturado_sem_combate), money(row.valor_nao_faturado_prioritarios), money(row.valor_nao_faturado_lancamentos), money(row.valor_nao_faturado_combate)]
      const top = 110 + rowIndex * ROW_HEIGHT
      x = MARGIN
      columns.forEach((column, index) => {
        rect(x, top, column.width, ROW_HEIGHT, total ? '#a9c3e8' : rowIndex % 2 ? '#f6f8fa' : '#ffffff', '#9eabb5')
        text(values[index], x, top + 3, column.width, { size: index === 0 ? 7 : 6.5, bold: total || index === 0, align: column.align })
        x += column.width
      })
    }
    rows.forEach((row, index) => render(row, index))
    if (pageIndex === chunks.length - 1) render(data.total, rows.length, true)
    text(`Atendidos nao faturados - pagina ${pageIndex + 1}/${chunks.length}`, MARGIN, 818, PAGE_WIDTH - MARGIN * 2, { size: 7, color: '#5d6b7e', align: 'right' })
    return commands.join('\n')
  })
}

export async function onRequestGet({ request, env }) {
  try {
    const data = await loadConsultantReport(request, env)
    if (data.error) return data.error
    const bytes = pdfDocument([...performancePages(data), ...pendingPages(data)])
    const periodName = data.period.inicio ? data.period.inicio.slice(0, 7) : 'todo-periodo'
    const suffix = data.uf ? `-${safeName(data.uf)}` : ''
    return new Response(bytes, { headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="desempenho-consultores-${periodName}${suffix}.pdf"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    } })
  } catch (error) {
    return new Response(`Não foi possível gerar o PDF dos consultores. ${error instanceof Error ? error.message : String(error)}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' },
    })
  }
}
