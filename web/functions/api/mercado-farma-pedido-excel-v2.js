import { buildXlsx, currencyFormatCode, numberCell, stringCell } from '../_lib/xlsx-compatible.js'
import { authorized, readSession } from '../_lib/credentials.js'

const texto = value => String(value ?? '').trim()
const numero = value => Number.isFinite(Number(value)) ? Number(value) : 0
const cnpjLimpo = value => texto(value).replace(/\D/g, '')
const seguro = value => texto(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'pedido'

const styles = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="${currencyFormatCode}"/></numFmts>
  <fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF17233B"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF0B7850"/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF102F52"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F5"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDFF3EA"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFCCD7DE"/></left><right style="thin"><color rgb="FFCCD7DE"/></right><top style="thin"><color rgb="FFCCD7DE"/></top><bottom style="thin"><color rgb="FFCCD7DE"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="5" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function worksheet({ cliente, consultor, itens, totais }) {
  const lines = [
    `<row r="1" ht="26" customHeight="1">${stringCell('A1', 'PEDIDO MERCADO FARMA', 1)}</row>`,
    `<row r="3">${stringCell('A3', 'Nome do Cliente:', 2)}${stringCell('B3', cliente.nome, 3)}</row>`,
    `<row r="4">${stringCell('A4', 'CNPJ:', 2)}${stringCell('B4', cliente.cnpj, 3)}</row>`,
    `<row r="5">${stringCell('A5', 'UF do Cliente:', 2)}${stringCell('B5', cliente.uf, 3)}</row>`,
    `<row r="6">${stringCell('A6', 'Nome do Consultor:', 2)}${stringCell('B6', consultor, 3)}</row>`,
    `<row r="8" ht="24" customHeight="1">${['PRODUTO','EAN','QNTDE','DISTRIBUIDORA ESCOLHIDA'].map((label,index) => stringCell(`${String.fromCharCode(65+index)}8`,label,1)).join('')}</row>`,
  ]
  itens.forEach((item, index) => {
    const row = index + 9
    lines.push(`<row r="${row}">${stringCell(`A${row}`, item.produto, 3)}${stringCell(`B${row}`, item.ean, 4)}${numberCell(`C${row}`, item.quantidade, 4)}${stringCell(`D${row}`, item.distribuidora_rotulo, 3)}</row>`)
  })
  const summaryStart = 10 + itens.length
  lines.push(`<row r="${summaryStart}" ht="24" customHeight="1">${stringCell(`A${summaryStart}`, 'TOTAL POR DISTRIBUIDORA', 1)}</row>`)
  totais.forEach((item, index) => {
    const row = summaryStart + index + 1
    lines.push(`<row r="${row}">${stringCell(`A${row}`, item.distribuidora, 6)}${numberCell(`B${row}`, item.valor, 7)}</row>`)
  })
  const totalRow = summaryStart + totais.length + 2
  lines.push(`<row r="${totalRow}">${stringCell(`A${totalRow}`, 'TOTAL DO PEDIDO', 6)}${numberCell(`B${totalRow}`, totais.reduce((sum,item)=>sum+item.valor,0), 7)}</row>`)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:D${totalRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="8" topLeftCell="A9" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="48" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/><col min="4" max="4" width="38" customWidth="1"/></cols>
  <sheetData>${lines.join('')}</sheetData><mergeCells count="6"><mergeCell ref="A1:D1"/><mergeCell ref="B3:D3"/><mergeCell ref="B4:D4"/><mergeCell ref="B5:D5"/><mergeCell ref="B6:D6"/><mergeCell ref="A${summaryStart}:D${summaryStart}"/></mergeCells>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`
}

export async function onRequestPost({ request, env }) {
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) return new Response('Acesso não autorizado.', { status: 401 })
  try {
    const session = await readSession(request, env.PAINEL_ADMIN_KEY)
    if (!session?.consultor_id) return new Response('Consultor não identificado na sessão.', { status: 401 })
    const body = await request.json()
    const cnpj = cnpjLimpo(body?.cliente_cnpj)
    const solicitados = (Array.isArray(body?.itens) ? body.itens : []).map(item => ({
      ean: texto(item?.ean).replace(/\D/g, ''), quantidade: Math.max(0, Math.floor(numero(item?.quantidade))), distribuidora: texto(item?.distribuidora),
    })).filter(item => item.ean && item.quantidade > 0 && item.distribuidora)
    if (cnpj.length !== 14 || !solicitados.length) return new Response('Selecione o cliente e inclua ao menos um produto no carrinho.', { status: 400 })

    const cliente = await env.DB.prepare(`
      SELECT REPLACE(REPLACE(REPLACE(REPLACE(cnpj,'.',''),'/',''),'-',''),' ','') cnpj,
             COALESCE(NULLIF(TRIM(nome_fantasia),''),NULLIF(TRIM(razao_social),''),cnpj) nome,
             UPPER(TRIM(COALESCE(uf,''))) uf
      FROM clientes
      WHERE carteira_importada=1 AND ativo=1 AND consultor_id=?
        AND REPLACE(REPLACE(REPLACE(REPLACE(cnpj,'.',''),'/',''),'-',''),' ','')=?
      LIMIT 1
    `).bind(session.consultor_id, cnpj).first()
    if (!cliente) return new Response('O CNPJ selecionado não pertence à carteira deste consultor.', { status: 403 })
    if (!cliente.uf) return new Response('O cliente selecionado não possui UF cadastrada.', { status: 400 })

    const consultas = solicitados.map(item => env.DB.prepare(`
      SELECT ean,produto,distribuidora,uf,preco_com_imposto,preco_sem_imposto
      FROM mercado_farma_precos
      WHERE REPLACE(REPLACE(REPLACE(TRIM(ean),'.0',''),' ',''),'-','')=?
        AND distribuidora=? AND UPPER(TRIM(uf))=?
      ORDER BY atualizado_em DESC LIMIT 1
    `).bind(item.ean, item.distribuidora, cliente.uf))
    const resultados = await env.DB.batch(consultas)
    const itens = solicitados.map((solicitado, index) => {
      const oferta = resultados[index]?.results?.[0]
      if (!oferta) throw new Error(`A distribuidora escolhida para o EAN ${solicitado.ean} não atende a UF ${cliente.uf}. Atualize o Mercado Farma.`)
      const valorUnitario = numero(oferta.preco_com_imposto) || numero(oferta.preco_sem_imposto)
      return {
        produto: texto(oferta.produto), ean: texto(oferta.ean).replace(/\D/g, ''), quantidade: solicitado.quantidade,
        distribuidora_rotulo: `${texto(oferta.distribuidora)}${oferta.uf ? ` - atende ${texto(oferta.uf)}` : ''}`,
        valor_total: valorUnitario * solicitado.quantidade,
      }
    })
    const totaisMap = new Map()
    for (const item of itens) totaisMap.set(item.distribuidora_rotulo, (totaisMap.get(item.distribuidora_rotulo) || 0) + item.valor_total)
    const totais = [...totaisMap.entries()].map(([distribuidora, valor]) => ({ distribuidora, valor })).sort((a,b) => b.valor-a.valor)
    const bytes = buildXlsx({ sheetName: 'Pedido', title: `Pedido Mercado Farma - ${cliente.nome}`, worksheetXml: worksheet({ cliente, consultor: session.nome, itens, totais }), stylesXml: styles() })
    return new Response(bytes, { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="pedido-mercado-farma-${seguro(cliente.nome)}-${cnpj}.xlsx"`,
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    } })
  } catch (error) {
    return new Response(`Não foi possível gerar o pedido em Excel. ${error instanceof Error ? error.message : String(error)}`, { status: 500, headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' } })
  }
}
