import { buildXlsx, currencyFormatCode, numberCell, stringCell } from '../_lib/xlsx-compatible.js'
import { authorized } from '../_lib/credentials.js'

const text = value => String(value ?? '').trim()
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const safe = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'todas-ufs'
const pct = value => `${(Math.abs(number(value)) <= 1 ? number(value) * 100 : number(value)).toFixed(2).replace('.', ',')}%`

const styles = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="${currencyFormatCode}"/></numFmts>
  <fonts count="3"><font><sz val="10"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Calibri"/></font><font><b/><color rgb="FF17233B"/><sz val="10"/><name val="Calibri"/></font></fonts>
  <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF087957"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F7F9"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFD7E0E5"/></left><right style="thin"><color rgb="FFD7E0E5"/></right><top style="thin"><color rgb="FFD7E0E5"/></top><bottom style="thin"><color rgb="FFD7E0E5"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function worksheet(rows, uf) {
  const headers = ['UF','CNPJ REFERÊNCIA','EAN','PRODUTO','DISTRIBUIDORA','ESTOQUE','DESCONTO','PF DISTRIBUIDORA','PF FÁBRICA','PREÇO COM IMPOSTO','PREÇO SEM IMPOSTO','ATUALIZADO EM']
  const lines = [
    `<row r="1" ht="28" customHeight="1">${stringCell('A1', `MERCADO FARMA — ${uf || 'TODAS AS UFs'}`, 1)}</row>`,
    `<row r="3" ht="34" customHeight="1">${headers.map((label,index) => stringCell(`${String.fromCharCode(65 + index)}3`, label, 1)).join('')}</row>`,
  ]
  rows.forEach((item, index) => {
    const row = index + 4
    const style = index % 2 ? 3 : 2
    lines.push(`<row r="${row}">` +
      stringCell(`A${row}`, item.uf, style) +
      stringCell(`B${row}`, item.cnpj_referencia, style) +
      stringCell(`C${row}`, item.ean, style) +
      stringCell(`D${row}`, item.produto, style) +
      stringCell(`E${row}`, item.distribuidora, style) +
      numberCell(`F${row}`, item.estoque, 4) +
      stringCell(`G${row}`, pct(item.desconto), style) +
      numberCell(`H${row}`, item.pf_distribuidora, 5) +
      numberCell(`I${row}`, item.pf_fabrica, 5) +
      numberCell(`J${row}`, item.preco_com_imposto, 5) +
      numberCell(`K${row}`, item.preco_sem_imposto, 5) +
      stringCell(`L${row}`, item.atualizado_em, style) + '</row>')
  })
  const last = Math.max(3, rows.length + 3)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:L${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/><cols>
    <col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="19" customWidth="1"/><col min="4" max="4" width="52" customWidth="1"/><col min="5" max="5" width="35" customWidth="1"/><col min="6" max="7" width="13" customWidth="1"/><col min="8" max="11" width="17" customWidth="1"/><col min="12" max="12" width="22" customWidth="1"/>
  </cols><sheetData>${lines.join('')}</sheetData><mergeCells count="1"><mergeCell ref="A1:L1"/></mergeCells>
  <autoFilter ref="A3:L${last}"/><pageMargins left="0.2" right="0.2" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) return new Response('Acesso não autorizado.', { status: 401 })
  try {
    const uf = text(new URL(request.url).searchParams.get('uf')).toUpperCase().slice(0, 2)
    const result = await env.DB.prepare(`
      SELECT UPPER(TRIM(COALESCE(uf,''))) uf,COALESCE(cnpj_referencia,'') cnpj_referencia,
             COALESCE(ean,'') ean,COALESCE(produto,'') produto,COALESCE(distribuidora,'') distribuidora,
             COALESCE(estoque,0) estoque,COALESCE(desconto,0) desconto,
             COALESCE(pf_distribuidora,0) pf_distribuidora,COALESCE(pf_fabrica,0) pf_fabrica,
             COALESCE(preco_com_imposto,0) preco_com_imposto,COALESCE(preco_sem_imposto,0) preco_sem_imposto,
             COALESCE(atualizado_em,'') atualizado_em
      FROM mercado_farma_precos
      WHERE (?='' OR UPPER(TRIM(uf))=?)
      ORDER BY UPPER(TRIM(uf)),produto COLLATE NOCASE,distribuidora COLLATE NOCASE,ean
    `).bind(uf, uf).all()
    const rows = (result.results || []).map(item => ({
      ...item,
      estoque: number(item.estoque), desconto: number(item.desconto), pf_distribuidora: number(item.pf_distribuidora),
      pf_fabrica: number(item.pf_fabrica), preco_com_imposto: number(item.preco_com_imposto), preco_sem_imposto: number(item.preco_sem_imposto),
    }))
    const bytes = buildXlsx({ sheetName: uf || 'Todas UFs', title: `Mercado Farma - ${uf || 'Todas as UFs'}`, worksheetXml: worksheet(rows, uf), stylesXml: styles() })
    return new Response(bytes, { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="mercado-farma-${safe(uf || 'todas-ufs')}.xlsx"`,
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    } })
  } catch (error) {
    return new Response(`Não foi possível gerar o Excel do Mercado Farma. ${error instanceof Error ? error.message : String(error)}`, { status: 500, headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' } })
  }
}
