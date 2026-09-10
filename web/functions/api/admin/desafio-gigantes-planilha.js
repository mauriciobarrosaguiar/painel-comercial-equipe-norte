import { authorized } from '../../_lib/credentials.js'
import { obterArquivoDesafioGigantes } from '../../_lib/desafio-gigantes-arquivo.js'
import { buildXlsx, columnName, numberCell, stringCell } from '../../_lib/xlsx-compatible.js'

const texto = (value) => String(value ?? '').trim()

function safeFileName(value, fallback) {
  const raw = texto(value) || fallback
  const withExtension = raw.toLowerCase().endsWith('.xlsx') ? raw : `${raw}.xlsx`
  return withExtension.replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 180)
}

function styles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="12"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
  </fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFDDE4EA"/></left><right style="thin"><color rgb="FFDDE4EA"/></right><top style="thin"><color rgb="FFDDE4EA"/></top><bottom style="thin"><color rgb="FFDDE4EA"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
}

function worksheet(rows, anoMes, nomeArquivo) {
  const headers = [
    'ESCOPO', 'SETOR', 'NOME COLABORADOR', 'SAP', 'PRODUTO DA PLANILHA',
    'META POSITIVAÇÃO', 'META GIRO', 'EAN', 'PRODUTO IDENTIFICADO', 'STATUS IDENTIFICAÇÃO',
  ]
  const lastColumn = columnName(headers.length - 1)
  const xmlRows = [
    `<row r="1" ht="28" customHeight="1">${stringCell('A1', `DESAFIO DE GIGANTES — METAS IMPORTADAS — ${anoMes}`, 1)}</row>`,
    `<row r="2" ht="28" customHeight="1">${stringCell('A2', `Cópia dos dados gravados. Arquivo informado na importação: ${nomeArquivo || 'não identificado'}`, 4)}</row>`,
    `<row r="4" ht="34" customHeight="1">${headers.map((label, index) => stringCell(`${columnName(index)}4`, label, 2)).join('')}</row>`,
  ]

  rows.forEach((item, index) => {
    const row = index + 5
    const style = index % 2 ? 4 : 3
    xmlRows.push(`<row r="${row}">${[
      stringCell(`A${row}`, item.escopo, style),
      stringCell(`B${row}`, item.setor, style),
      stringCell(`C${row}`, item.nome_colaborador, style),
      stringCell(`D${row}`, item.sku, style),
      stringCell(`E${row}`, item.produto_planilha, style),
      numberCell(`F${row}`, item.meta_positivacao, style),
      numberCell(`G${row}`, item.meta_giro, style),
      stringCell(`H${row}`, item.ean, style),
      stringCell(`I${row}`, item.produto_identificado, style),
      stringCell(`J${row}`, item.status_identificacao, style),
    ].join('')}</row>`)
  })

  const lastRow = Math.max(4, rows.length + 4)
  const widths = [14, 16, 30, 14, 46, 18, 14, 18, 46, 22]
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${cols}</cols>
  <sheetData>${xmlRows.join('')}</sheetData>
  <autoFilter ref="A4:${lastColumn}${lastRow}"/>
  <mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>
  <pageMargins left="0.2" right="0.2" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`
}

function attachmentHeaders(nome, mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  return {
    'content-type': mimeType,
    'content-disposition': `attachment; filename="${nome}"`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return new Response('Acesso não autorizado.', {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' },
    })
  }

  try {
    const params = new URL(request.url).searchParams
    const ultima = await env.DB.prepare('SELECT MAX(ano_mes) ano_mes FROM desafio_gigantes_metas').first()
    const anoMesParam = texto(params.get('ano_mes'))
    const anoMes = /^\d{4}-\d{2}$/.test(anoMesParam) ? anoMesParam : texto(ultima?.ano_mes)
    if (!anoMes) return new Response('Não há metas do Desafio de Gigantes para baixar.', { status: 404 })

    const original = await obterArquivoDesafioGigantes(env, anoMes).catch(() => null)
    if (original?.bytes?.length) {
      const nomeDownload = safeFileName(original.nome_arquivo, `desafio-gigantes-${anoMes}`)
      return new Response(original.bytes, {
        headers: attachmentHeaders(nomeDownload, texto(original.mime_type) || undefined),
      })
    }

    const [metasResult, importacaoResult] = await env.DB.batch([
      env.DB.prepare(`
        SELECT escopo,setor,nome_colaborador,sku,produto_planilha,
               meta_positivacao,meta_giro,COALESCE(ean,'') ean,
               COALESCE(produto_identificado,'') produto_identificado,
               COALESCE(status_identificacao,'') status_identificacao
          FROM desafio_gigantes_metas
         WHERE ano_mes=?
         ORDER BY CASE WHEN escopo='gerente' THEN 0 ELSE 1 END,
                  nome_colaborador COLLATE NOCASE,setor,sku
      `).bind(anoMes),
      env.DB.prepare(`
        SELECT nome_arquivo,criado_em
          FROM importacoes
         WHERE tipo='DESAFIO_GIGANTES_METAS'
         ORDER BY criado_em DESC
         LIMIT 1
      `),
    ])

    const rows = metasResult.results || []
    if (!rows.length) return new Response(`Não há metas gravadas para ${anoMes}.`, { status: 404 })

    const importacao = importacaoResult.results?.[0] || {}
    const nomeOriginal = texto(importacao.nome_arquivo)
    const base = safeFileName(nomeOriginal, `desafio-gigantes-${anoMes}`).replace(/\.xlsx$/i, '')
    const nomeDownload = safeFileName(`copia-dados-${base}`, `copia-dados-desafio-gigantes-${anoMes}`)
    const bytes = buildXlsx({
      sheetName: 'Metas importadas',
      title: `Desafio de Gigantes - metas importadas - ${anoMes}`,
      worksheetXml: worksheet(rows, anoMes, nomeOriginal),
      stylesXml: styles(),
    })

    return new Response(bytes, { headers: attachmentHeaders(nomeDownload) })
  } catch (error) {
    return new Response(`Não foi possível gerar a planilha: ${error instanceof Error ? error.message : String(error)}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' },
    })
  }
}
