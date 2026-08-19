import { authorized } from '../_lib/credentials.js'
import { ITEM_FATURADO } from '../_lib/commercial.js'
import { buildXlsx, columnName, currencyFormatCode, numberCell, stringCell } from '../_lib/xlsx-compatible.js'

const texto = (value) => String(value ?? '').trim()
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const cnpj = (value) => texto(value).replace(/\D/g, '')
const safe = (value) => texto(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'relatorio'

function mesAtual() {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((item) => [item.type, item.value]))
  return `${partes.year}-${partes.month}`
}

function faixaMes(anoMes) {
  const [ano, mes] = anoMes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return { inicio: `${anoMes}-01`, fim: `${anoMes}-${String(ultimo).padStart(2, '0')}` }
}

const styles = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="${currencyFormatCode}"/></numFmts>
  <fonts count="4"><font><sz val="10"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="12"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Calibri"/></font><font><i/><color rgb="FF475569"/><sz val="9"/><name val="Calibri"/></font></fonts>
  <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFDDE4EA"/></left><right style="thin"><color rgb="FFDDE4EA"/></right><top style="thin"><color rgb="FFDDE4EA"/></top><bottom style="thin"><color rgb="FFDDE4EA"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  </cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function worksheet(linhas, distribuidoras, anoMes, consultorNome) {
  const baseHeaders = ['CONSULTOR','SETOR','CNPJ','PDV','CIDADE','UF','SAP','EAN','PRODUTO']
  const distHeaders = distribuidoras.map((item) => `${item} (R$)`)
  const finalHeaders = ['MELHOR PREÇO (R$)','MELHOR DISTRIBUIDORA','BASE DOS PREÇOS','ATUALIZADO EM']
  const headers = [...baseHeaders, ...distHeaders, ...finalHeaders]
  const lastColumn = columnName(headers.length - 1)
  const rows = [
    `<row r="1" ht="28" customHeight="1">${stringCell('A1', 'DESAFIO DE GIGANTES — NÃO POSITIVADOS + PREÇOS', 1)}</row>`,
    `<row r="2" ht="34" customHeight="1">${stringCell('A2', `Mês ${anoMes} · ${consultorNome || 'Consultor'} · somente produtos ainda não positivados. Preços com imposto quando disponíveis; entram apenas ofertas com estoque. Base CNPJ quando houver captura exata e, na ausência, mesma UF do PDV.`, 7)}</row>`,
    `<row r="4" ht="34" customHeight="1">${headers.map((label,index) => stringCell(`${columnName(index)}4`, label, 2)).join('')}</row>`,
  ]
  linhas.forEach((item, index) => {
    const row = index + 5, textStyle = index % 2 ? 4 : 3, moneyStyle = index % 2 ? 6 : 5
    const cells = [
      stringCell(`A${row}`, item.consultor, textStyle), stringCell(`B${row}`, item.setor, textStyle), stringCell(`C${row}`, item.cnpj, textStyle),
      stringCell(`D${row}`, item.pdv, textStyle), stringCell(`E${row}`, item.cidade, textStyle), stringCell(`F${row}`, item.uf, textStyle),
      stringCell(`G${row}`, item.sku, textStyle), stringCell(`H${row}`, item.ean, textStyle), stringCell(`I${row}`, item.produto, textStyle),
    ]
    distribuidoras.forEach((dist, distIndex) => {
      const ref = `${columnName(baseHeaders.length + distIndex)}${row}`, preco = numero(item.precos?.[dist])
      cells.push(preco > 0 ? numberCell(ref, preco, moneyStyle) : stringCell(ref, '', textStyle))
    })
    const offset = baseHeaders.length + distribuidoras.length
    cells.push(item.melhor_preco > 0 ? numberCell(`${columnName(offset)}${row}`, item.melhor_preco, moneyStyle) : stringCell(`${columnName(offset)}${row}`, '', textStyle))
    cells.push(stringCell(`${columnName(offset + 1)}${row}`, item.melhor_distribuidora, textStyle))
    cells.push(stringCell(`${columnName(offset + 2)}${row}`, item.base_precos, textStyle))
    cells.push(stringCell(`${columnName(offset + 3)}${row}`, item.atualizado_em, textStyle))
    rows.push(`<row r="${row}">${cells.join('')}</row>`)
  })
  const lastRow = Math.max(4, linhas.length + 4)
  const cols = headers.map((_, index) => {
    const width = index === 3 ? 34 : index === 8 ? 48 : index >= baseHeaders.length && index < baseHeaders.length + distribuidoras.length ? 18 : index === 0 ? 26 : index === 2 ? 20 : 14
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A4:${lastColumn}${lastRow}"/><mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells><pageMargins left="0.2" right="0.2" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/></worksheet>`
}

function aplicarOfertas(item, ofertas) {
  const exatas = ofertas.filter((o) => cnpj(o.cnpj_referencia) && cnpj(o.cnpj_referencia) === item.cnpj)
  const candidatas = exatas.length ? exatas : ofertas.filter((o) => texto(o.uf).toUpperCase() === item.uf)
  for (const oferta of candidatas) {
    const dist = texto(oferta.distribuidora)
    const preco = numero(oferta.preco_com_imposto) > 0 ? numero(oferta.preco_com_imposto) : numero(oferta.preco_sem_imposto)
    if (!dist || preco <= 0 || numero(oferta.estoque) <= 0) continue
    if (!item.precos[dist] || preco < item.precos[dist]) item.precos[dist] = preco
    if (!item.melhor_preco || preco < item.melhor_preco) { item.melhor_preco = preco; item.melhor_distribuidora = dist }
    if (texto(oferta.atualizado_em) > item.atualizado_em) item.atualizado_em = texto(oferta.atualizado_em)
  }
  if (candidatas.length) item.base_precos = exatas.length ? 'CNPJ exato' : 'UF do PDV'
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) return new Response('Acesso não autorizado.', { status: 401, headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' } })
  try {
    const params = new URL(request.url).searchParams
    const anoMesRaw = texto(params.get('ano_mes')), anoMes = /^\d{4}-\d{2}$/.test(anoMesRaw) ? anoMesRaw : mesAtual()
    const consultor = texto(params.get('consultor')).slice(0, 180)
    if (!consultor) return new Response('Selecione um consultor para extrair os não positivados.', { status: 400 })
    const { inicio, fim } = faixaMes(anoMes)

    const [metasR, clientesR, vendasR, precosR] = await env.DB.batch([
      env.DB.prepare(`SELECT m.nome_colaborador,m.setor,m.sku,TRIM(COALESCE(m.ean,'')) ean,COALESCE(NULLIF(TRIM(m.produto_identificado),''),NULLIF(TRIM(m.produto_planilha),''),('SAP '||m.sku)) produto FROM desafio_gigantes_metas m WHERE m.ano_mes=? AND m.escopo='consultor' AND m.consultor_id=? AND COALESCE(m.status_identificacao,'')='IDENTIFICADO' AND TRIM(COALESCE(m.ean,''))<>'' ORDER BY m.sku`).bind(anoMes, consultor),
      env.DB.prepare(`SELECT cl.id cliente_id,REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(cl.cnpj,''),'.',''),'/',''),'-',''),' ','') cnpj,COALESCE(NULLIF(TRIM(cl.nome_fantasia),''),NULLIF(TRIM(cl.razao_social),''),cl.cnpj) pdv,COALESCE(cl.cidade,'') cidade,UPPER(TRIM(COALESCE(cl.uf,''))) uf FROM clientes cl WHERE cl.carteira_importada=1 AND cl.ativo=1 AND cl.consultor_id=? ORDER BY pdv COLLATE NOCASE`).bind(consultor),
      env.DB.prepare(`SELECT pe.cliente_id,TRIM(COALESCE(ip.ean,'')) ean,SUM(COALESCE(ip.quantidade_faturada,0)) unidades FROM pedidos pe JOIN itens_pedido ip ON ip.pedido_id=pe.id JOIN clientes cl ON cl.id=pe.cliente_id WHERE ${ITEM_FATURADO} AND cl.carteira_importada=1 AND cl.ativo=1 AND cl.consultor_id=? AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?) AND TRIM(COALESCE(ip.ean,'')) IN (SELECT TRIM(COALESCE(ean,'')) FROM desafio_gigantes_metas WHERE ano_mes=? AND escopo='consultor' AND consultor_id=? AND status_identificacao='IDENTIFICADO') GROUP BY pe.cliente_id,TRIM(COALESCE(ip.ean,'')) HAVING SUM(COALESCE(ip.quantidade_faturada,0))>0`).bind(consultor, inicio, fim, anoMes, consultor),
      env.DB.prepare(`SELECT mf.ean,mf.uf,mf.cnpj_referencia,mf.distribuidora,mf.estoque,mf.preco_com_imposto,mf.preco_sem_imposto,mf.atualizado_em FROM mercado_farma_precos mf WHERE COALESCE(mf.estoque,0)>0 AND (COALESCE(mf.preco_com_imposto,0)>0 OR COALESCE(mf.preco_sem_imposto,0)>0) AND TRIM(COALESCE(mf.ean,'')) IN (SELECT TRIM(COALESCE(ean,'')) FROM desafio_gigantes_metas WHERE ano_mes=? AND escopo='consultor' AND consultor_id=? AND status_identificacao='IDENTIFICADO')`).bind(anoMes, consultor),
    ])

    const metas = metasR.results || [], clientes = clientesR.results || [], vendas = new Set((vendasR.results || []).map((v) => `${v.cliente_id}|${texto(v.ean)}`))
    const ofertasPorEan = new Map()
    for (const oferta of precosR.results || []) { const ean = texto(oferta.ean); if (!ofertasPorEan.has(ean)) ofertasPorEan.set(ean, []); ofertasPorEan.get(ean).push(oferta) }

    const linhas = []
    for (const cliente of clientes) for (const meta of metas) {
      if (vendas.has(`${cliente.cliente_id}|${texto(meta.ean)}`)) continue
      const item = { consultor: texto(meta.nome_colaborador), setor: texto(meta.setor), cnpj: cnpj(cliente.cnpj), pdv: texto(cliente.pdv), cidade: texto(cliente.cidade), uf: texto(cliente.uf).toUpperCase(), sku: texto(meta.sku), ean: texto(meta.ean), produto: texto(meta.produto), precos: {}, melhor_preco: 0, melhor_distribuidora: '', base_precos: '', atualizado_em: '' }
      aplicarOfertas(item, ofertasPorEan.get(item.ean) || [])
      linhas.push(item)
    }
    linhas.sort((a,b) => a.pdv.localeCompare(b.pdv,'pt-BR') || a.sku.localeCompare(b.sku,'pt-BR'))
    const distribuidoras = [...new Set(linhas.flatMap((item) => Object.keys(item.precos)))].sort((a,b) => a.localeCompare(b,'pt-BR'))
    const consultorNome = metas[0]?.nome_colaborador || consultor
    const bytes = buildXlsx({ sheetName:'Não positivados', title:`Desafio de Gigantes - não positivados - ${anoMes}`, worksheetXml:worksheet(linhas,distribuidoras,anoMes,consultorNome), stylesXml:styles() })
    return new Response(bytes, { headers: { 'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition':`attachment; filename="desafio-gigantes-nao-positivados-${safe(anoMes)}-${safe(consultorNome)}.xlsx"`, 'cache-control':'no-store', 'x-content-type-options':'nosniff' } })
  } catch (error) {
    return new Response(`Não foi possível gerar a planilha de não positivados do Desafio de Gigantes. ${error instanceof Error ? error.message : String(error)}`, { status:500, headers:{'content-type':'text/plain; charset=UTF-8','cache-control':'no-store'} })
  }
}
