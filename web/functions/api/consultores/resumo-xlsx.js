import {
  loadConsultantReport,
  number,
  percentage,
  safeName,
  xmlEscape,
} from '../../_lib/consultant-report.js'

const encoder = new TextEncoder()
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const col = (index) => letters[index]
const delta = (realized, goal) => number(realized) - number(goal)

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value) {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

function u32(value) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true)
  return bytes
}

function concat(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(size)
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function zip(files) {
  const localParts = []
  const centralParts = []
  const { time, date } = dosDateTime()
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content
    const crc = crc32(data)
    const local = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ])
    localParts.push(local)
    centralParts.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]))
    offset += local.length
  }
  const central = concat(centralParts)
  return concat([
    ...localParts,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0),
  ])
}

function stringCell(ref, value, style) {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
}

function numberCell(ref, value, style) {
  return `<c r="${ref}" s="${style}"><v>${Number(value) || 0}</v></c>`
}

const coverageStyle = (value) => value >= 100 ? 16 : value >= 80 ? 15 : 14
const deltaStyle = (value, total = false) => total
  ? (value < 0 ? 24 : 25)
  : (value < 0 ? 12 : 13)

function dataCells(row, rowNumber, total = false) {
  const scDelta = delta(row.ol_sem_combate, row.meta_ol_sem_combate)
  const priorityDelta = delta(row.ol_prioritarios, row.meta_ol_prioritarios)
  const launchDelta = delta(row.ol_lancamentos, row.meta_ol_lancamentos)
  const textStyle = total ? 21 : 9
  const centerStyle = total ? 22 : 10
  const currencyStyle = total ? 23 : 11
  return [
    stringCell(`A${rowNumber}`, row.nome, textStyle),
    stringCell(`B${rowNumber}`, row.setor || '—', centerStyle),
    numberCell(`C${rowNumber}`, row.ol_total_faturado, currencyStyle),
    numberCell(`D${rowNumber}`, row.meta_ol_sem_combate, currencyStyle),
    numberCell(`E${rowNumber}`, row.ol_sem_combate, currencyStyle),
    numberCell(`F${rowNumber}`, scDelta, deltaStyle(scDelta, total)),
    numberCell(`G${rowNumber}`, percentage(row.ol_sem_combate, row.meta_ol_sem_combate) / 100, coverageStyle(percentage(row.ol_sem_combate, row.meta_ol_sem_combate))),
    numberCell(`H${rowNumber}`, row.meta_ol_prioritarios, currencyStyle),
    numberCell(`I${rowNumber}`, row.ol_prioritarios, currencyStyle),
    numberCell(`J${rowNumber}`, priorityDelta, deltaStyle(priorityDelta, total)),
    numberCell(`K${rowNumber}`, percentage(row.ol_prioritarios, row.meta_ol_prioritarios) / 100, coverageStyle(percentage(row.ol_prioritarios, row.meta_ol_prioritarios))),
    numberCell(`L${rowNumber}`, row.meta_ol_lancamentos, currencyStyle),
    numberCell(`M${rowNumber}`, row.ol_lancamentos, currencyStyle),
    numberCell(`N${rowNumber}`, launchDelta, deltaStyle(launchDelta, total)),
    numberCell(`O${rowNumber}`, percentage(row.ol_lancamentos, row.meta_ol_lancamentos) / 100, coverageStyle(percentage(row.ol_lancamentos, row.meta_ol_lancamentos))),
    numberCell(`P${rowNumber}`, row.valor_nao_faturado, currencyStyle),
    numberCell(`Q${rowNumber}`, row.valor_nao_faturado_sem_combate, currencyStyle),
    numberCell(`R${rowNumber}`, row.valor_nao_faturado_prioritarios, currencyStyle),
    numberCell(`S${rowNumber}`, row.valor_nao_faturado_lancamentos, currencyStyle),
    numberCell(`T${rowNumber}`, row.valor_nao_faturado_combate, currencyStyle),
  ].join('')
}

function worksheet(data) {
  const rows = [...data.rows, data.total]
  const lines = [
    `<row r="1" ht="26" customHeight="1">${stringCell('A1', 'DESEMPENHO DOS CONSULTORES', 1)}</row>`,
    `<row r="2" ht="22" customHeight="1">${stringCell('A2', `${data.period.rotulo}${data.uf ? ` · UF ${data.uf}` : ''}`, 2)}</row>`,
    `<row r="3" ht="28" customHeight="1">${[
      stringCell('A3', 'CONSULTOR', 3), stringCell('B3', 'SETOR', 3), stringCell('C3', 'REAL OL TOTAL', 3),
      stringCell('D3', 'OL SEM COMBATE', 4), stringCell('H3', 'PRIORITÁRIOS', 5),
      stringCell('L3', 'LANÇAMENTOS', 6), stringCell('P3', 'ATENDIDOS E AINDA NÃO FATURADOS', 7),
    ].join('')}</row>`,
    `<row r="4" ht="28" customHeight="1">${[
      ...['META', 'REAL', 'Δ META', '%'].map((label, index) => stringCell(`${col(3 + index)}4`, label, 8)),
      ...['META', 'REAL', 'Δ META', '%'].map((label, index) => stringCell(`${col(7 + index)}4`, label, 8)),
      ...['META', 'REAL', 'Δ META', '%'].map((label, index) => stringCell(`${col(11 + index)}4`, label, 8)),
      ...['TOTAL', 'SEM COMBATE', 'PRIORITÁRIOS', 'LANÇAMENTOS', 'COMBATE'].map((label, index) => stringCell(`${col(15 + index)}4`, label, 8)),
    ].join('')}</row>`,
  ]
  rows.forEach((row, index) => {
    const rowNumber = index + 5
    lines.push(`<row r="${rowNumber}" ht="23" customHeight="1">${dataCells(row, rowNumber, index === rows.length - 1)}</row>`)
  })
  const lastRow = rows.length + 4
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="4" topLeftCell="C5" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="20" width="16" customWidth="1"/>
  </cols>
  <sheetData>${lines.join('')}</sheetData>
  <mergeCells count="9">
    <mergeCell ref="A1:T1"/><mergeCell ref="A2:T2"/><mergeCell ref="A3:A4"/><mergeCell ref="B3:B4"/><mergeCell ref="C3:C4"/>
    <mergeCell ref="D3:G3"/><mergeCell ref="H3:K3"/><mergeCell ref="L3:O3"/><mergeCell ref="P3:T3"/>
  </mergeCells>
  <autoFilter ref="A4:T${lastRow}"/>
  <pageMargins left="0.2" right="0.2" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="8"/>
</worksheet>`
}

function styles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="R$ #,##0.00;[Red]-R$ #,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
  <fonts count="5">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Calibri"/></font>
    <font><b/><color rgb="FF17202B"/><sz val="10"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFB42318"/><sz val="10"/><name val="Calibri"/></font>
    <font><b/><color rgb="FF0B7850"/><sz val="10"/><name val="Calibri"/></font>
  </fonts>
  <fills count="13">
    <fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF18283D"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F4"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF4C8FC0"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF62A69D"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF6FA76F"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8C96E"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFA9C3E8"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFE0DD"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF1BD"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDFF4EB"/></patternFill></fill>
  </fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFB7C3CC"/></left><right style="thin"><color rgb="FFB7C3CC"/></right><top style="thin"><color rgb="FFB7C3CC"/></top><bottom style="thin"><color rgb="FFB7C3CC"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="26">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="6" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="8" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="8" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="8" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="8" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="3" fillId="10" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="2" fillId="11" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="4" fillId="12" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="8" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="8" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="8" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="9" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="9" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="9" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="9" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="9" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
}

function buildXlsx(data) {
  const now = new Date().toISOString()
  return zip([
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Painel Comercial Equipe Norte</dc:creator><dc:title>Desempenho dos Consultores</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Painel Comercial Equipe Norte</Application></Properties>` },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Consultores" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', content: styles() },
    { name: 'xl/worksheets/sheet1.xml', content: worksheet(data) },
  ])
}

export async function onRequestGet({ request, env }) {
  try {
    const data = await loadConsultantReport(request, env)
    if (data.error) return data.error
    const bytes = buildXlsx(data)
    const periodName = data.period.inicio ? data.period.inicio.slice(0, 7) : 'todo-periodo'
    const suffix = data.uf ? `-${safeName(data.uf)}` : ''
    return new Response(bytes, { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="desempenho-consultores-${periodName}${suffix}.xlsx"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    } })
  } catch (error) {
    return new Response(`Não foi possível gerar o Excel dos consultores. ${error instanceof Error ? error.message : String(error)}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' },
    })
  }
}
