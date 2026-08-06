import { buildXlsx, columnName, currencyFormatCode, numberCell, stringCell } from '../_lib/xlsx-compatible.js'
import { readSession } from '../_lib/credentials.js'

const text = value => String(value ?? '').trim()
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const safeName = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'pedidos-separados'

const styles = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="${currencyFormatCode}"/></numFmts>
  <fonts count="4"><font><sz val="10"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Calibri"/></font><font><b/><color rgb="FF102F52"/><sz val="10"/><name val="Calibri"/></font><font><b/><color rgb="FFB42318"/><sz val="10"/><name val="Calibri"/></font></fonts>
  <fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF102F52"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F7EF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1E8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE8E8"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFD7E0E7"/></left><right style="thin"><color rgb="FFD7E0E7"/></right><top style="thin"><color rgb="FFD7E0E7"/></top><bottom style="thin"><color rgb="FFD7E0E7"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="6" borderId="1" xfId="0"><alignment vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function cell(ref, value, style = 2, forceText = false) {
  if (!forceText && typeof value === 'number' && Number.isFinite(value)) return numberCell(ref, value, style)
  return stringCell(ref, value, style)
}

function worksheet(headers, rows, resultMap) {
  const extraHeaders = ['DISTRIBUIDORA PARA ENVIO', 'STATUS DA ANÁLISE', 'UF ATENDIDA', 'PREÇO SEM IMPOSTO', 'TOTAL DA LINHA']
  const finalHeaders = [...headers, ...extraHeaders]
  const lines = [`<row r="1" ht="30" customHeight="1">${finalHeaders.map((header, index) => stringCell(`${columnName(index)}1`, header, 1)).join('')}</row>`]
  const textHeaders = new Set(headers.map((header, index) => /EAN|CNPJ|CODIGO|CÓDIGO/i.test(header) ? index : -1).filter(index => index >= 0))
  rows.forEach((row, index) => {
    const result = resultMap.get(index) || {}
    const status = text(result.status)
    const statusStyle = status === 'DISTRIBUÍDO' ? 3 : status.includes('SEM ESTOQUE') || status.includes('NÃO LOCALIZADO') || status.includes('INVÁLIDO') ? 4 : 6
    const output = [
      ...row,
      result.distribuidora || '',
      status,
      result.uf || '',
      result.preco_sem_imposto ?? '',
      result.total_linha ?? '',
    ]
    const rowNumber = index + 2
    const cells = output.map((value, column) => {
      const ref = `${columnName(column)}${rowNumber}`
      if (column === headers.length) return stringCell(ref, value, statusStyle)
      if (column === headers.length + 1) return stringCell(ref, value, statusStyle)
      if (column === headers.length + 3 || column === headers.length + 4) return value === '' || value === null ? stringCell(ref, '', 2) : numberCell(ref, number(value), 5)
      return cell(ref, value, 2, textHeaders.has(column))
    }).join('')
    lines.push(`<row r="${rowNumber}">${cells}</row>`)
  })
  const lastColumn = columnName(finalHeaders.length - 1)
  const widths = finalHeaders.map((header, index) => {
    const sample = [header, ...rows.slice(0, 100).map(row => row[index])].map(value => text(value).length)
    const width = Math.min(48, Math.max(11, Math.max(...sample, 8) + 2))
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${rows.length + 1}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/><cols>${widths}</cols><sheetData>${lines.join('')}</sheetData>
  <autoFilter ref="A1:${lastColumn}${rows.length + 1}"/>
  <pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`
}

export async function onRequestPost({ request, env }) {
  const session = await readSession(request, env.PAINEL_ADMIN_KEY)
  if (!session) return new Response('Sessão não identificada.', { status: 401 })
  try {
    const body = await request.json()
    const headers = Array.isArray(body?.headers) ? body.headers.slice(0, 120).map(text) : []
    const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 5000).filter(Array.isArray).map(row => row.slice(0, 120)) : []
    const results = Array.isArray(body?.resultados) ? body.resultados : []
    if (!headers.length || !rows.length) return new Response('Não há dados para exportar.', { status: 400 })
    const resultMap = new Map(results.map(item => [Number(item.index), item]))
    const bytes = buildXlsx({
      sheetName: 'Pedidos Separados',
      title: 'Separação inteligente de pedidos',
      worksheetXml: worksheet(headers, rows, resultMap),
      stylesXml: styles(),
    })
    const filename = `${safeName(body?.nome_arquivo || 'pedidos-separados')}.xlsx`
    return new Response(bytes, { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    } })
  } catch (error) {
    return new Response(`Não foi possível exportar a planilha. ${error instanceof Error ? error.message : String(error)}`, { status: 500, headers: { 'content-type': 'text/plain; charset=UTF-8' } })
  }
}
