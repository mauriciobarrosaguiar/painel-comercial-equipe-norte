import { authorized } from '../../_lib/credentials.js'
import { buildXlsx, currencyFormatCode, numberCell, stringCell } from '../../_lib/xlsx-compatible.js'
import { ufsVinculadasSip } from '../../_lib/sip-precos.js'

const texto = (valor) => String(valor ?? '').trim()
const numero = (valor) => Number.isFinite(Number(valor)) ? Number(valor) : 0
const descontoFracao = (item) => {
  const desconto = numero(item.desconto)
  if (desconto) return Math.abs(desconto) > 1 ? desconto / 100 : desconto
  const pf = numero(item.pf_distribuidora)
  const preco = numero(item.preco_com_imposto)
  return pf > 0 && preco > 0 && preco <= pf ? 1 - preco / pf : 0
}

function estilos() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="' + currencyFormatCode + '"/>' +
    '<numFmt numFmtId="165" formatCode="0.00%"/></numFmts>' +
    '<fonts count="2"><font><sz val="10"/><name val="Calibri"/></font>' +
    '<font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Calibri"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF087957"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF4F7F9"/></patternFill></fill></fills>' +
    '<borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"/>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"/>' +
    '<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
}

function planilha(registros, ufs) {
  // A mesma apresentação e os campos da extração padrão, EXCETO o CNPJ de referência.
  const colunas = ['UF', 'EAN', 'NOME DO PRODUTO', 'DISTRIBUIDORA', 'ESTOQUE', 'DESCONTO (%)',
    'PF DIST. (R$)', 'PREÇO FINAL (R$)', 'SEM IMPOSTO (R$)', 'DATA']
  const linhas = [
    '<row r="1" ht="28" customHeight="1">' +
      stringCell('A1', 'MERCADO FARMA — ' + ufs.join(', '), 1) + '</row>',
    '<row r="3" ht="34" customHeight="1">' +
      colunas.map((coluna, i) => stringCell(String.fromCharCode(65 + i) + '3', coluna, 1)).join('') +
      '</row>',
  ]
  registros.forEach((item, index) => {
    const r = index + 4
    linhas.push('<row r="' + r + '">' +
      stringCell('A' + r, item.uf, 2) +
      stringCell('B' + r, item.ean, 2) +
      stringCell('C' + r, item.produto, 2) +
      stringCell('D' + r, item.distribuidora, 2) +
      numberCell('E' + r, item.estoque, 2) +
      numberCell('F' + r, descontoFracao(item), 4) +
      numberCell('G' + r, item.pf_distribuidora, 3) +
      numberCell('H' + r, item.preco_com_imposto, 3) +
      numberCell('I' + r, item.preco_sem_imposto, 3) +
      stringCell('J' + r, item.atualizado_em, 2) +
      '</row>')
  })
  const ultima = Math.max(3, registros.length + 3)
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="A1:J' + ultima + '"/>' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="18"/>' +
    '<cols><col min="1" max="1" width="8" customWidth="1"/>' +
    '<col min="2" max="2" width="19" customWidth="1"/>' +
    '<col min="3" max="3" width="55" customWidth="1"/>' +
    '<col min="4" max="4" width="38" customWidth="1"/>' +
    '<col min="5" max="6" width="16" customWidth="1"/>' +
    '<col min="7" max="9" width="19" customWidth="1"/>' +
    '<col min="10" max="10" width="25" customWidth="1"/></cols>' +
    '<sheetData>' + linhas.join('') + '</sheetData>' +
    '<autoFilter ref="A3:J' + ultima + '"/>' +
    '<mergeCells count="1"><mergeCell ref="A1:J1"/></mergeCells>' +
    '<pageMargins left="0.2" right="0.2" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>' +
    '</worksheet>'
}

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams
  const id = texto(params.get('sip_id'))
  const publico = params.get('publico') === '1'
  if (!id) return new Response('SIP não informada.', { status: 400 })
  if (!publico && !(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return new Response('Acesso não autorizado.', { status: 401 })
  }
  try {
    const sip = await env.DB.prepare(
      'SELECT id, acesso_publico_ativo FROM sips WHERE id=? AND ativo=1'
    ).bind(id).first()
    if (!sip) return new Response('SIP não encontrada.', { status: 404 })
    if (publico && !Number(sip.acesso_publico_ativo || 0)) {
      return new Response('Acesso individual desativado.', { status: 403 })
    }
    // Filtragem obrigatória no servidor: nenhuma UF recebida na URL é aceita.
    const ufs = await ufsVinculadasSip(env.DB, id)
    if (!ufs.length) return new Response('SIP sem estados vinculados.', { status: 404 })

    const placeholders = ufs.map(() => '?').join(',')
    const registros = []
    const pagina = 800
    let deslocamento = 0
    while (true) {
      const consulta = await env.DB.prepare(
        'SELECT UPPER(TRIM(uf)) uf, COALESCE(ean, \'\') ean, ' +
        'COALESCE(produto, \'\') produto, COALESCE(distribuidora, \'\') distribuidora, ' +
        'COALESCE(estoque,0) estoque, COALESCE(desconto,0) desconto, ' +
        'COALESCE(pf_distribuidora,0) pf_distribuidora, ' +
        'COALESCE(preco_com_imposto,0) preco_com_imposto, ' +
        'COALESCE(preco_sem_imposto,0) preco_sem_imposto, ' +
        'COALESCE(atualizado_em, \'\') atualizado_em ' +
        'FROM mercado_farma_precos WHERE UPPER(TRIM(uf)) IN (' + placeholders + ') ' +
        'ORDER BY UPPER(TRIM(uf)), produto COLLATE NOCASE, distribuidora COLLATE NOCASE, ean, id ' +
        'LIMIT ? OFFSET ?'
      ).bind(...ufs, pagina, deslocamento).all()
      const itens = consulta.results || []
      registros.push(...itens)
      if (itens.length < pagina) break
      deslocamento += pagina
    }
    if (!registros.length) return new Response('Ainda não existem preços extraídos para os estados desta SIP.', { status: 404 })

    const arquivo = buildXlsx({
      sheetName: 'Preços Mercado Farma',
      title: 'Preços Mercado Farma - ' + ufs.join(', '),
      worksheetXml: planilha(registros, ufs),
      stylesXml: estilos(),
    })
    return new Response(arquivo, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': 'attachment; filename="mercado-farma-precos-sip.xlsx"',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('Falha ao exportar preços da SIP:', error)
    return new Response('Não foi possível gerar a planilha de preços.', {
      status: 500, headers: { 'cache-control': 'no-store' },
    })
  }
}
