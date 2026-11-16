import { buildMultiSheetXlsx, columnName, stringCell, numberCell, xmlEscape } from './xlsx-compatible.js'
import { classificarMix } from './commercial.js'

const inteiro = value => Number.isFinite(Number(value)) ? Number(value) : 0
const fmt = month => `${month.slice(5, 7)}/${month.slice(2, 4)}`
const chaveProduto = item => {
  const ean = String(item.ean || '').trim()
  const sku = String(item.sku || '').trim()
  return ean ? `ean:${ean}` : sku ? `sap:${sku}` : `id:${String(item.id || item.produto_id || '')}`
}
const dataSegura = v => String(v || '').slice(0, 10)

/** Um registro por apresentação (EAN); sem EAN, SKU SAP. MIX SAP tem prioridade. */
export function prepararCatalogoMix(linhas) {
  const mapa = new Map()
  for (const item of linhas || []) {
    const mix = classificarMix(item.tipo_mix)
    if (!['PRIORITARIO', 'LANCAMENTO'].includes(mix)) continue
    const key = chaveProduto(item)
    if (key === 'id:' || !key) continue
    const produto = {
      chave: key,
      id: String(item.id || ''),
      ean: String(item.ean || '').trim(),
      sku: String(item.sku || '').trim(),
      produto: String(item.descricao || item.produto || item.sku || item.ean || 'Produto não identificado').trim(),
      tipo_mix: mix,
    }
    if (!mapa.has(key) || (item.origem === 'PRODUTO' && mapa.get(key).origem !== 'PRODUTO')) {
      mapa.set(key, { ...produto, origem: item.origem || 'PRODUTO' })
    }
  }
  return [...mapa.values()].sort((a, b) =>
    (a.tipo_mix === 'PRIORITARIO' ? 0 : 1) - (b.tipo_mix === 'PRIORITARIO' ? 0 : 1) ||
    a.produto.localeCompare(b.produto, 'pt-BR') || a.ean.localeCompare(b.ean))
}

export function comporPlanilhaClientes(clientes, catalogo, compras, periodo) {
  const mapCatalogo = new Map(catalogo.map(item => [item.chave, item]))
  const porCnpj = new Map()
  for (const row of compras) {
    const cnpj = String(row.cnpj || '').replace(/\D/g, '')
    const chave = chaveProduto(row)
    if (!mapCatalogo.has(chave) || !periodo.meses.includes(String(row.mes || ''))) continue
    const key = `${cnpj}:${chave}`
    if (!porCnpj.has(key)) porCnpj.set(key, { meses: new Map(), pedidos: 0, ultima: '' })
    const target = porCnpj.get(key)
    target.meses.set(row.mes, (target.meses.get(row.mes) || 0) + inteiro(row.quantidade))
    target.pedidos += inteiro(row.pedidos)
    if (String(row.ultima_compra || '') > target.ultima) target.ultima = String(row.ultima_compra)
  }
  return clientes.map(cliente => {
    const cnpj = String(cliente.cnpj || '').replace(/\D/g, '')
    const produtos = catalogo.map(item => {
      const vendas = porCnpj.get(`${cnpj}:${item.chave}`)
      const meses = periodo.meses.map(mes => vendas?.meses.get(mes) || 0)
      const total = meses.reduce((s, value) => s + value, 0)
      return { ...item, meses, total, media: total / 3, comprou: total > 0, pedidos: vendas?.pedidos || 0, ultima: vendas?.ultima || '' }
    }).sort((a, b) =>
      (a.tipo_mix === 'PRIORITARIO' ? 0 : 1) - (b.tipo_mix === 'PRIORITARIO' ? 0 : 1) ||
      Number(a.comprou) - Number(b.comprou) ||
      b.total - a.total || a.produto.localeCompare(b.produto, 'pt-BR'))
    const grupo = tipo => {
      const lista = produtos.filter(item => item.tipo_mix === tipo)
      return { total: lista.length, comprados: lista.filter(item => item.comprou).length, faltantes: lista.filter(item => !item.comprou).length }
    }
    return { cliente: { ...cliente, cnpj }, produtos,
      prioritarios: grupo('PRIORITARIO'), lancamentos: grupo('LANCAMENTO'),
      unidades: produtos.reduce((sum, item) => sum + item.total, 0) }
  })
}

const styles = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
<fonts count="6">
<font><sz val="10"/><name val="Aptos"/></font>
<font><b/><color rgb="FFFFFFFF"/><sz val="13"/><name val="Aptos"/></font>
<font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/></font>
<font><b/><color rgb="FF194368"/><sz val="10"/><name val="Aptos"/></font>
<font><b/><color rgb="FF18744A"/><sz val="10"/><name val="Aptos"/></font>
<font><b/><color rgb="FFB03132"/><sz val="10"/><name val="Aptos"/></font>
</fonts>
<fills count="7">
<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF102E4B"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF156A72"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF0F5F8"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE3F5EA"/></patternFill></fill>
</fills>
<borders count="2"><border/><border><bottom style="hair"><color rgb="FFDFE8ED"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="5" borderId="0" xfId="0"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="3" fillId="5" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

const row = (n, cells, height) => `<row r="${n}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`
const merged = ranges => `<mergeCells count="${ranges.length}">${ranges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
const outer = (last, lines, merges, widths, filter = '', freeze = 8) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:K${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="19"/><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
<sheetData>${lines.join('')}</sheetData>${merged(merges)}${filter ? `<autoFilter ref="${filter}"/>` : ''}<pageMargins left="0.3" right="0.3" top="0.45" bottom="0.45" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1"/></worksheet>`

export function workbookClientesMix(analise, periodo, filtros = {}) {
  const summaryLines = []
  summaryLines.push(row(1, stringCell('A1', 'PAINEL COMERCIAL  |  COBERTURA DE MIX POR CLIENTE', 1), 34))
  summaryLines.push(row(2, stringCell('A2', `Prioritários e lançamentos · ${periodo.meses.map(fmt).join('  |  ')} · Quantidade líquida faturada`, 2), 26))
  summaryLines.push(row(3, stringCell('A3', `Filtros de clientes: ${[
    filtros.busca ? 'Busca: ' + filtros.busca : '',
    filtros.uf ? 'UF ' + filtros.uf : '',
    filtros.cidade ? 'Cidade ' + filtros.cidade : '',
    filtros.prioridade ? 'Prioridade ' + filtros.prioridade : '',
    filtros.periodo ? 'Período da carteira: ' + filtros.periodo : '',
  ].filter(Boolean).join(' · ') || 'Carteira sem restrições adicionais'}`, 3), 22))
  summaryLines.push(row(4, stringCell('A4', `CNPJs selecionados: ${analise.length} · Referência: Bússola detalhada, mês atual parcial · Em branco/zero = nenhuma quantidade líquida identificada`, 3), 21))
  summaryLines.push(row(5, stringCell('A5', 'Verde ● COMPROU = saldo positivo. Vermelho ● NÃO COMPROU = saldo zero/negativo. Compras agregadas sem EAN não permitem confirmar produto.', 3), 21))
  const labels = ['Nº', 'CNPJ', 'CLIENTE', 'UF', 'CIDADE', 'PRIOR. COMPROU', 'PRIOR. FALTOU', 'LANÇ. COMPROU', 'LANÇ. FALTOU', 'UNIDADES 3M', 'COBERTURA MIX']
  summaryLines.push(row(8, labels.map((name, i) => stringCell(`${columnName(i)}8`, name, 4)).join(''), 32))
  analise.forEach((a, i) => {
    const r = 9 + i
    const comprados = a.prioritarios.comprados + a.lancamentos.comprados
    const total = a.prioritarios.total + a.lancamentos.total
    const vals = [i + 1, a.cliente.cnpj, a.cliente.nome, a.cliente.uf, a.cliente.cidade, a.prioritarios.comprados,
      a.prioritarios.faltantes, a.lancamentos.comprados, a.lancamentos.faltantes, a.unidades]
    const st = i % 2 ? 6 : 5
    const cells = vals.map((v, j) => typeof v === 'number'
      ? numberCell(`${columnName(j)}${r}`, v, st === 5 ? 9 : 10)
      : stringCell(`${columnName(j)}${r}`, v, st)).join('') +
      numberCell(`K${r}`, total ? comprados / total : 0, 11)
    summaryLines.push(row(r, cells, 22))
  })
  const summaryXml = outer(Math.max(8, analise.length + 8), summaryLines,
    ['A1:K1','A2:K2','A3:K3','A4:K4','A5:K5'], [7,19,50,8,23,18,18,18,18,19,19],
    `A8:K${Math.max(8, analise.length + 8)}`)
  const sheets = [{ name: 'RESUMO', xml: summaryXml }]
  analise.forEach((a, index) => {
    const lines = []
    lines.push(row(1,stringCell('A1', `CLIENTE  |  ${a.cliente.nome}`,1),36))
    lines.push(row(2,stringCell('A2', `CNPJ: ${a.cliente.cnpj}  ·  ${a.cliente.cidade}/${a.cliente.uf}  ·  Consultor: ${a.cliente.consultor || 'Não informado'}`,2),27))
    lines.push(row(3,stringCell('A3', `PERÍODO: ${periodo.meses.map(fmt).join(' · ')}  |  Compras faturadas identificadas por apresentação (EAN ou SKU SAP)`,3),23))
    lines.push(row(4,stringCell('A4', `PRIORITÁRIOS: ${a.prioritarios.comprados} comprados / ${a.prioritarios.faltantes} não comprados  |  LANÇAMENTOS: ${a.lancamentos.comprados} comprados / ${a.lancamentos.faltantes} não comprados`,2),24))
    lines.push(row(5,stringCell('A5', `Unidades líquidas em 3 meses: ${a.unidades}  |  ● VERDE: COMPROU  |  ● VERMELHO: NÃO COMPROU`,3),22))
    lines.push(row(6,stringCell('A6', 'Critério: Bússola faturada; mês atual parcial. Devoluções descontadas. Históricos mensais agregados sem EAN não comprovam compra individual.',3),26))
    const cols = ['TIPO MIX','PRODUTO / APRESENTAÇÃO','EAN OU SKU SAP','STATUS',...periodo.meses.map(m=>`UN. ${fmt(m)}`),'TOTAL 3M','MÉDIA/MÊS','PEDIDOS','ÚLTIMA COMPRA']
    lines.push(row(8, cols.map((name,j)=>stringCell(`${columnName(j)}8`,name,4)).join(''),30))
    a.produtos.forEach((p,i) => {
      const pos = 9 + i, st = i % 2 ? 6 : 5
      const cells = stringCell(`A${pos}`,p.tipo_mix === 'PRIORITARIO'?'PRIORITÁRIO':'LANÇAMENTO',st) +
        stringCell(`B${pos}`,p.produto,st) +
        stringCell(`C${pos}`,p.ean || `SAP ${p.sku}`,st) +
        stringCell(`D${pos}`,p.comprou?'● COMPROU':'● NÃO COMPROU',p.comprou?7:8) +
        p.meses.map((v,j)=>numberCell(`${columnName(j+4)}${pos}`,v,st === 5 ? 9 : 10)).join('')+
        numberCell(`H${pos}`,p.total,st === 5 ? 9 : 10)+
        numberCell(`I${pos}`,Math.round(p.media*100)/100,st === 5 ? 9 : 10)+
        numberCell(`J${pos}`,p.pedidos,st === 5 ? 9 : 10)+
        stringCell(`K${pos}`,dataSegura(p.ultima),st)
      lines.push(row(pos,cells,21))
    })
    const last = Math.max(8, a.produtos.length + 8)
    sheets.push({ name: `${String(index+1).padStart(2,'0')} ${a.cliente.cnpj}`,
      xml: outer(last,lines,['A1:K1','A2:K2','A3:K3','A4:K4','A5:K5','A6:K6'],
        [17,50,23,19,16,16,16,17,17,14,18],`A8:K${last}`) })
  })
  return buildMultiSheetXlsx({ sheets, title: 'Relatório de MIX Prioritários e Lançamentos por CNPJ', stylesXml: styles() })
}
