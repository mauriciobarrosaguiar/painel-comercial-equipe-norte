import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../../_lib/commercial.js'
import { authorized } from '../../_lib/credentials.js'
import {
  buildXlsx,
  columnName,
  currencyFormatCode,
  numberCell,
  stringCell,
} from '../../_lib/xlsx-compatible.js'

const texto = (value) => String(value ?? '').trim()
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
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
  return { inicio: iso(year, month, 1), fim: iso(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()) }
}

function mesAno(value) {
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const [year, month] = texto(value).split('-').map(Number)
  return year && month ? `${months[month - 1]}/${String(year).slice(-2)}` : texto(value)
}

function comGaps(item) {
  const objetivo = numero(item.objetivo)
  const realizado = numero(item.realizado)
  return {
    sip: texto(item.sip),
    cnpjs: numero(item.cnpjs),
    objetivo,
    realizado,
    cobertura: objetivo > 0 ? realizado / objetivo * 100 : 0,
    gap_100: realizado - objetivo,
    gap_90: realizado - objetivo * 0.9,
    gap_80: realizado - objetivo * 0.8,
  }
}

async function carregar(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return { error: new Response('Chave administrativa não configurada.', { status: 503 }) }
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return { error: new Response('Acesso não autorizado.', { status: 401 }) }
  }

  const { inicio, fim } = periodo(new URL(request.url).searchParams)
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
      LEFT JOIN clientes cl ON cl.cnpj=sc.cnpj AND cl.carteira_importada=1 AND cl.ativo=1
      LEFT JOIN vendas v ON v.cliente_id=cl.id
     WHERE s.ativo=1
     GROUP BY s.id,s.nome,s.meta_mes
     ORDER BY s.nome COLLATE NOCASE
  `).bind(inicio, fim).all()

  const rows = (result.results || []).map(comGaps)
  const total = comGaps({
    sip: 'TOTAL DISTRITAL',
    cnpjs: rows.reduce((sum, row) => sum + row.cnpjs, 0),
    objetivo: rows.reduce((sum, row) => sum + row.objetivo, 0),
    realizado: rows.reduce((sum, row) => sum + row.realizado, 0),
  })
  return { inicio, fim, rows, total }
}

const coberturaStyle = (value) => value >= 90 ? 10 : value >= 80 ? 9 : 8
const gapStyle = (value) => value < 0 ? 11 : 12

function worksheet(data) {
  const rows = [...data.rows, data.total]
  const lines = [
    `<row r="1" ht="24" customHeight="1">${stringCell('A1', 'RESUMO SIP', 1)}</row>`,
    `<row r="2" ht="21" customHeight="1">${stringCell('A2', mesAno(data.inicio), 2)}</row>`,
    `<row r="3" ht="21" customHeight="1">${stringCell('A3', 'OBJETIVO PREÇO LÍQUIDO · RESULTADO CONSOLIDADO POR SIP', 3)}</row>`,
    `<row r="4" ht="23" customHeight="1">${['SIP', 'CNPJs', 'OBJETIVO', 'REALIZADO', 'COBERTURA', 'GAP 100%', 'GAP 90%', 'GAP 80%'].map((label, index) => stringCell(`${columnName(index)}4`, label, 4)).join('')}</row>`,
  ]

  rows.forEach((row, index) => {
    const rowNumber = index + 5
    const total = index === rows.length - 1
    lines.push(`<row r="${rowNumber}" ht="22" customHeight="1">${[
      stringCell(`A${rowNumber}`, row.sip, total ? 13 : 5),
      numberCell(`B${rowNumber}`, row.cnpjs, total ? 14 : 6),
      numberCell(`C${rowNumber}`, row.objetivo, total ? 15 : 7),
      numberCell(`D${rowNumber}`, row.realizado, total ? 15 : 7),
      numberCell(`E${rowNumber}`, row.cobertura / 100, coberturaStyle(row.cobertura)),
      numberCell(`F${rowNumber}`, row.gap_100, total ? (row.gap_100 < 0 ? 17 : 16) : gapStyle(row.gap_100)),
      numberCell(`G${rowNumber}`, row.gap_90, total ? (row.gap_90 < 0 ? 17 : 16) : gapStyle(row.gap_90)),
      numberCell(`H${rowNumber}`, row.gap_80, total ? (row.gap_80 < 0 ? 17 : 16) : gapStyle(row.gap_80)),
    ].join('')}</row>`)
  })

  const lastRow = rows.length + 4
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:H${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols><col min="1" max="1" width="42" customWidth="1"/><col min="2" max="2" width="10" customWidth="1"/><col min="3" max="4" width="17" customWidth="1"/><col min="5" max="5" width="14" customWidth="1"/><col min="6" max="8" width="17" customWidth="1"/></cols>
  <sheetData>${lines.join('')}</sheetData>
  <mergeCells count="3"><mergeCell ref="A1:H1"/><mergeCell ref="A2:H2"/><mergeCell ref="A3:H3"/></mergeCells>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`
}

function styles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="${currencyFormatCode}"/><numFmt numFmtId="165" formatCode="0.00%"/></numFmts>
  <fonts count="5">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FF17202B"/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFC01818"/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FF116B3D"/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="10">
    <fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF202B3B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF0F2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF46566C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1298E5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7B28C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF7AD"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFCCEBD5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF9BB9E6"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FF737B84"/></left><right style="thin"><color rgb="FF737B84"/></right><top style="thin"><color rgb="FF737B84"/></top><bottom style="thin"><color rgb="FF737B84"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="18">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="3" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="2" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="4" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="9" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="9" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="9" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="9" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="9" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
}

export async function onRequestGet({ request, env }) {
  try {
    const data = await carregar(request, env)
    if (data.error) return data.error
    const bytes = buildXlsx({
      sheetName: 'Resumo SIP',
      title: 'Resumo SIP',
      worksheetXml: worksheet(data),
      stylesXml: styles(),
    })
    return new Response(bytes, { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="resumo-sips-${data.inicio.slice(0, 7)}.xlsx"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    } })
  } catch (error) {
    return new Response(`Não foi possível gerar o Excel consolidado das SIPs. ${error instanceof Error ? error.message : String(error)}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' },
    })
  }
}
