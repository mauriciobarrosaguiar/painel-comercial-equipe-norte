import {
  loadConsultantReport,
  number,
  percentage,
  safeName,
} from '../../_lib/consultant-report.js'
import {
  buildXlsx,
  columnName,
  currencyFormatCode,
  numberCell,
  stringCell,
} from '../../_lib/xlsx-compatible.js'

const delta = (realized, goal) => number(realized) - number(goal)
const coverageStyle = (value) => value >= 100 ? 16 : value >= 80 ? 15 : 14
const deltaStyle = (value, total = false) => total
  ? (value < 0 ? 20 : 21)
  : (value < 0 ? 12 : 13)

function dataCells(row, rowNumber, total = false) {
  const scDelta = delta(row.ol_sem_combate, row.meta_ol_sem_combate)
  const priorityDelta = delta(row.ol_prioritarios, row.meta_ol_prioritarios)
  const launchDelta = delta(row.ol_lancamentos, row.meta_ol_lancamentos)
  const textStyle = total ? 17 : 9
  const centerStyle = total ? 18 : 10
  const currencyStyle = total ? 19 : 11
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
      stringCell('A3', 'CONSULTOR', 3),
      stringCell('B3', 'SETOR', 3),
      stringCell('C3', 'REAL OL TOTAL', 3),
      stringCell('D3', 'OL SEM COMBATE', 4),
      stringCell('H3', 'PRIORITÁRIOS', 5),
      stringCell('L3', 'LANÇAMENTOS', 6),
      stringCell('P3', 'ATENDIDOS E AINDA NÃO FATURADOS', 7),
    ].join('')}</row>`,
    `<row r="4" ht="28" customHeight="1">${[
      ...['META', 'REAL', 'Δ META', '%'].map((label, index) => stringCell(`${columnName(3 + index)}4`, label, 8)),
      ...['META', 'REAL', 'Δ META', '%'].map((label, index) => stringCell(`${columnName(7 + index)}4`, label, 8)),
      ...['META', 'REAL', 'Δ META', '%'].map((label, index) => stringCell(`${columnName(11 + index)}4`, label, 8)),
      ...['TOTAL', 'SEM COMBATE', 'PRIORITÁRIOS', 'LANÇAMENTOS', 'COMBATE'].map((label, index) => stringCell(`${columnName(15 + index)}4`, label, 8)),
    ].join('')}</row>`,
  ]

  rows.forEach((row, index) => {
    const rowNumber = index + 5
    lines.push(`<row r="${rowNumber}" ht="23" customHeight="1">${dataCells(row, rowNumber, index === rows.length - 1)}</row>`)
  })

  const lastRow = rows.length + 4
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:T${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="4" topLeftCell="C5" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="20" width="16" customWidth="1"/></cols>
  <sheetData>${lines.join('')}</sheetData>
  <mergeCells count="9"><mergeCell ref="A1:T1"/><mergeCell ref="A2:T2"/><mergeCell ref="A3:A4"/><mergeCell ref="B3:B4"/><mergeCell ref="C3:C4"/><mergeCell ref="D3:G3"/><mergeCell ref="H3:K3"/><mergeCell ref="L3:O3"/><mergeCell ref="P3:T3"/></mergeCells>
  <pageMargins left="0.2" right="0.2" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="8"/>
</worksheet>`
}

function styles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="${currencyFormatCode}"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
  <fonts count="5">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Calibri"/></font>
    <font><b/><color rgb="FF17202B"/><sz val="10"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFB42318"/><sz val="10"/><name val="Calibri"/></font>
    <font><b/><color rgb="FF0B7850"/><sz val="10"/><name val="Calibri"/></font>
  </fonts>
  <fills count="13">
    <fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF18283D"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF4C8FC0"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF62A69D"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF6FA76F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8C96E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFA9C3E8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFE0DD"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF1BD"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDFF4EB"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFB7C3CC"/></left><right style="thin"><color rgb="FFB7C3CC"/></right><top style="thin"><color rgb="FFB7C3CC"/></top><bottom style="thin"><color rgb="FFB7C3CC"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="22">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="8" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="3" fillId="10" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="2" fillId="11" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="4" fillId="12" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="9" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="9" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="9" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="9" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="9" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
}

export async function onRequestGet({ request, env }) {
  try {
    const data = await loadConsultantReport(request, env)
    if (data.error) return data.error
    const bytes = buildXlsx({
      sheetName: 'Consultores',
      title: 'Desempenho dos Consultores',
      worksheetXml: worksheet(data),
      stylesXml: styles(),
    })
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
