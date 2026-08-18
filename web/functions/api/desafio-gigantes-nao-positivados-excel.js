import { authorized } from '../_lib/credentials.js'
import { ITEM_FATURADO } from '../_lib/commercial.js'
import { buildXlsx, columnName, currencyFormatCode, numberCell, stringCell } from '../_lib/xlsx-compatible.js'

const texto = (value) => String(value ?? '').trim()
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const cnpjLimpoSql = (expr) => `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${expr},''),'.',''),'/',''),'-',''),' ','')`
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
    const row = index + 5
    const textStyle = index % 2 ? 4 : 3
    const moneyStyle = index % 2 ? 6 : 5
    const cells = [
      stringCell(`A${row}`, item.consultor, textStyle),
      stringCell(`B${row}`, item.setor, textStyle),
      stringCell(`C${row}`, item.cnpj, textStyle),
      stringCell(`D${row}`, item.pdv, textStyle),
      stringCell(`E${row}`, item.cidade, textStyle),
      stringCell(`F${row}`, item.uf, textStyle),
      stringCell(`G${row}`, item.sku, textStyle),
      stringCell(`H${row}`, item.ean, textStyle),
      stringCell(`I${row}`, item.produto, textStyle),
    ]
    distribuidoras.forEach((dist, distIndex) => {
      const ref = `${columnName(baseHeaders.length + distIndex)}${row}`
      const preco = numero(item.precos?.[dist])
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
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData>
  <autoFilter ref="A4:${lastColumn}${lastRow}"/><mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>
  <pageMargins left="0.2" right="0.2" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return new Response('Acesso não autorizado.', { status: 401, headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' } })
  }

  try {
    const params = new URL(request.url).searchParams
    const anoMesRaw = texto(params.get('ano_mes'))
    const anoMes = /^\d{4}-\d{2}$/.test(anoMesRaw) ? anoMesRaw : mesAtual()
    const consultor = texto(params.get('consultor')).slice(0, 180)
    if (!consultor) return new Response('Selecione um consultor para extrair os não positivados.', { status: 400 })
    const { inicio, fim } = faixaMes(anoMes)
    const cnpjCliente = cnpjLimpoSql('cl.cnpj')
    const cnpjOferta = cnpjLimpoSql('mf.cnpj_referencia')
    const cnpjExato = cnpjLimpoSql('ex.cnpj_referencia')

    const result = await env.DB.prepare(`
      WITH metas AS (
        SELECT m.consultor_id,m.nome_colaborador,m.setor,m.sku,
               TRIM(COALESCE(m.ean,'')) ean,
               COALESCE(NULLIF(TRIM(m.produto_identificado),''),NULLIF(TRIM(m.produto_planilha),''),('SAP '||m.sku)) produto
          FROM desafio_gigantes_metas m
         WHERE m.ano_mes=? AND m.escopo='consultor' AND m.consultor_id=?
           AND COALESCE(m.status_identificacao,'')='IDENTIFICADO'
           AND TRIM(COALESCE(m.ean,''))<>''
      ),
      carteira AS (
        SELECT cl.id cliente_id,cl.consultor_id,${cnpjCliente} cnpj,
               COALESCE(NULLIF(TRIM(cl.nome_fantasia),''),NULLIF(TRIM(cl.razao_social),''),cl.cnpj) pdv,
               COALESCE(cl.cidade,'') cidade,UPPER(TRIM(COALESCE(cl.uf,''))) uf
          FROM clientes cl
         WHERE cl.carteira_importada=1 AND cl.ativo=1 AND cl.consultor_id=?
      ),
      vendas AS (
        SELECT cl.id cliente_id,TRIM(COALESCE(ip.ean,'')) ean,
               SUM(COALESCE(ip.quantidade_faturada,0)) unidades
          FROM itens_pedido ip
          JOIN pedidos pe ON pe.id=ip.pedido_id
          JOIN clientes cl ON cl.id=pe.cliente_id
         WHERE ${ITEM_FATURADO}
           AND cl.carteira_importada=1 AND cl.ativo=1 AND cl.consultor_id=?
           AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)
         GROUP BY cl.id,TRIM(COALESCE(ip.ean,''))
      ),
      faltantes AS (
        SELECT c.cliente_id,c.cnpj,c.pdv,c.cidade,c.uf,
               m.nome_colaborador consultor,m.setor,m.sku,m.ean,m.produto
          FROM carteira c
          JOIN metas m ON m.consultor_id=c.consultor_id
          LEFT JOIN vendas v ON v.cliente_id=c.cliente_id AND v.ean=m.ean
         WHERE COALESCE(v.unidades,0)<=0
      )
      SELECT f.*,
             COALESCE(mf.distribuidora,'') distribuidora,
             COALESCE(mf.estoque,0) estoque,
             CASE WHEN COALESCE(mf.preco_com_imposto,0)>0 THEN mf.preco_com_imposto ELSE COALESCE(mf.preco_sem_imposto,0) END preco,
             COALESCE(mf.atualizado_em,'') atualizado_em,
             CASE WHEN ${cnpjOferta}=f.cnpj AND f.cnpj<>'' THEN 'CNPJ' WHEN mf.id IS NOT NULL THEN 'UF' ELSE '' END base_preco
        FROM faltantes f
        LEFT JOIN mercado_farma_precos mf
          ON TRIM(COALESCE(mf.ean,''))=f.ean
         AND COALESCE(mf.estoque,0)>0
         AND (COALESCE(mf.preco_com_imposto,0)>0 OR COALESCE(mf.preco_sem_imposto,0)>0)
         AND (
           (${cnpjOferta}=f.cnpj AND f.cnpj<>'')
           OR (
             UPPER(TRIM(COALESCE(mf.uf,'')))=f.uf
             AND NOT EXISTS (
               SELECT 1 FROM mercado_farma_precos ex
                WHERE TRIM(COALESCE(ex.ean,''))=f.ean
                  AND ${cnpjExato}=f.cnpj AND f.cnpj<>''
                  AND COALESCE(ex.estoque,0)>0
                  AND (COALESCE(ex.preco_com_imposto,0)>0 OR COALESCE(ex.preco_sem_imposto,0)>0)
             )
           )
         )
       ORDER BY f.pdv COLLATE NOCASE,f.sku,mf.distribuidora COLLATE NOCASE
    `).bind(anoMes, consultor, consultor, consultor, inicio, fim).all()

    const mapa = new Map()
    for (const raw of result.results || []) {
      const key = `${raw.cliente_id}|${raw.sku}`
      if (!mapa.has(key)) {
        mapa.set(key, {
          consultor: texto(raw.consultor), setor: texto(raw.setor), cnpj: texto(raw.cnpj), pdv: texto(raw.pdv),
          cidade: texto(raw.cidade), uf: texto(raw.uf), sku: texto(raw.sku), ean: texto(raw.ean), produto: texto(raw.produto),
          precos: {}, melhor_preco: 0, melhor_distribuidora: '', base_precos: '', atualizado_em: '',
        })
      }
      const item = mapa.get(key)
      const dist = texto(raw.distribuidora)
      const preco = numero(raw.preco)
      if (dist && preco > 0) {
        const atual = numero(item.precos[dist])
        if (!atual || preco < atual) item.precos[dist] = preco
        if (!item.melhor_preco || preco < item.melhor_preco) {
          item.melhor_preco = preco
          item.melhor_distribuidora = dist
        }
        if (texto(raw.base_preco) === 'CNPJ') item.base_precos = 'CNPJ exato'
        else if (!item.base_precos) item.base_precos = 'UF do PDV'
        if (texto(raw.atualizado_em) > item.atualizado_em) item.atualizado_em = texto(raw.atualizado_em)
      }
    }

    const linhas = [...mapa.values()]
    const distribuidoras = [...new Set(linhas.flatMap((item) => Object.keys(item.precos)))].sort((a,b) => a.localeCompare(b, 'pt-BR'))
    const consultorNome = linhas[0]?.consultor || consultor
    const bytes = buildXlsx({
      sheetName: 'Não positivados',
      title: `Desafio de Gigantes - não positivados - ${anoMes}`,
      worksheetXml: worksheet(linhas, distribuidoras, anoMes, consultorNome),
      stylesXml: styles(),
    })
    return new Response(bytes, { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="desafio-gigantes-nao-positivados-${safe(anoMes)}-${safe(consultorNome)}.xlsx"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    } })
  } catch (error) {
    return new Response(`Não foi possível gerar a planilha de não positivados do Desafio de Gigantes. ${error instanceof Error ? error.message : String(error)}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=UTF-8', 'cache-control': 'no-store' },
    })
  }
}
