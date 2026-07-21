import { arquivarPeriodosEncerrados, obterMissaoFoco } from '../_lib/focus-history.js'

const texto = value => String(value ?? '').trim()
const dataValida = value => /^\d{4}-\d{2}-\d{2}$/.test(texto(value))
const numero = value => (Number.isFinite(Number(value)) ? Number(value) : 0)
const encoder = new TextEncoder()

const xml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

const dataLabel = value => {
  const [ano, mes, dia] = texto(value).split('-')
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : texto(value)
}

const nomeColuna = indice => {
  let atual = indice + 1
  let nome = ''
  while (atual > 0) {
    atual -= 1
    nome = String.fromCharCode(65 + atual % 26) + nome
    atual = Math.floor(atual / 26)
  }
  return nome
}

const celulaTexto = (coluna, linha, valor, estilo = 0) => {
  const conteudo = String(valor ?? '')
  const preservar = /^\s|\s$|\n/.test(conteudo) ? ' xml:space="preserve"' : ''
  return `<c r="${coluna}${linha}" t="inlineStr" s="${estilo}"><is><t${preservar}>${xml(conteudo)}</t></is></c>`
}

const celulaNumero = (coluna, linha, valor, estilo = 0) => `<c r="${coluna}${linha}" s="${estilo}"><v>${numero(valor)}</v></c>`
const celulaVazia = (coluna, linha, estilo = 0) => `<c r="${coluna}${linha}" s="${estilo}"/>`

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function concatenar(partes) {
  const total = partes.reduce((soma, parte) => soma + parte.length, 0)
  const resultado = new Uint8Array(total)
  let posicao = 0
  for (const parte of partes) {
    resultado.set(parte, posicao)
    posicao += parte.length
  }
  return resultado
}

function dataDos(data = new Date()) {
  const ano = Math.max(1980, data.getFullYear())
  return {
    hora: (data.getHours() << 11) | (data.getMinutes() << 5) | Math.floor(data.getSeconds() / 2),
    data: ((ano - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate(),
  }
}

function criarZipSemCompressao(arquivos) {
  const locais = []
  const centrais = []
  let deslocamento = 0
  const horario = dataDos()

  for (const arquivo of arquivos) {
    const nome = encoder.encode(arquivo.nome)
    const conteudo = arquivo.conteudo instanceof Uint8Array ? arquivo.conteudo : encoder.encode(arquivo.conteudo)
    const checksum = crc32(conteudo)

    const local = new Uint8Array(30 + nome.length + conteudo.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, horario.hora, true)
    localView.setUint16(12, horario.data, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, conteudo.length, true)
    localView.setUint32(22, conteudo.length, true)
    localView.setUint16(26, nome.length, true)
    localView.setUint16(28, 0, true)
    local.set(nome, 30)
    local.set(conteudo, 30 + nome.length)
    locais.push(local)

    const central = new Uint8Array(46 + nome.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, horario.hora, true)
    centralView.setUint16(14, horario.data, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, conteudo.length, true)
    centralView.setUint32(24, conteudo.length, true)
    centralView.setUint16(28, nome.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, deslocamento, true)
    central.set(nome, 46)
    centrais.push(central)

    deslocamento += local.length
  }

  const tamanhoCentral = centrais.reduce((soma, parte) => soma + parte.length, 0)
  const fim = new Uint8Array(22)
  const fimView = new DataView(fim.buffer)
  fimView.setUint32(0, 0x06054b50, true)
  fimView.setUint16(4, 0, true)
  fimView.setUint16(6, 0, true)
  fimView.setUint16(8, arquivos.length, true)
  fimView.setUint16(10, arquivos.length, true)
  fimView.setUint32(12, tamanhoCentral, true)
  fimView.setUint32(16, deslocamento, true)
  fimView.setUint16(20, 0, true)

  return concatenar([...locais, ...centrais, fim])
}

function estilosXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
    <fonts count="4">
      <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
      <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
      <font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Calibri"/><family val="2"/></font>
      <font><b/><color rgb="FF14243A"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    </fonts>
    <fills count="9">
      <fill><patternFill patternType="none"/></fill>
      <fill><patternFill patternType="gray125"/></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FF0B376F"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FF7898C9"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFE89A67"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FF568B3B"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFEF7478"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFF4D179"/><bgColor indexed="64"/></patternFill></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FF64B77A"/><bgColor indexed="64"/></patternFill></fill>
    </fills>
    <borders count="2">
      <border><left/><right/><top/><bottom/><diagonal/></border>
      <border><left style="thin"><color rgb="FF9CA9B5"/></left><right style="thin"><color rgb="FF9CA9B5"/></right><top style="thin"><color rgb="FF9CA9B5"/></top><bottom style="thin"><color rgb="FF9CA9B5"/></bottom><diagonal/></border>
    </borders>
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="16">
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
      <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
      <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
      <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
      <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
      <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
      <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
      <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
      <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
      <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
      <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
      <xf numFmtId="164" fontId="3" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
      <xf numFmtId="164" fontId="3" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
      <xf numFmtId="164" fontId="3" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
      <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
      <xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    </cellXfs>
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  </styleSheet>`
}

function planilhaXml(snapshot) {
  const produtos = Array.isArray(snapshot.produtos) ? snapshot.produtos : []
  const consultores = Array.isArray(snapshot.consultores) ? snapshot.consultores : []
  const linhas = Array.isArray(snapshot.linhas) ? snapshot.linhas : []
  const mapa = new Map(linhas.map(linha => [`${linha.consultor_id}|${linha.foco_id}`, linha]))
  const totalColunas = 2 + produtos.length * 3
  const ultimaColuna = nomeColuna(totalColunas - 1)
  const linhaTotal = 6 + consultores.length
  const tituloProdutos = produtos.map(item => item.descricao).join(' & ')
  const linhasXml = []
  const mesclagens = [`A1:${ultimaColuna}1`, `A2:${ultimaColuna}2`, `A3:${ultimaColuna}3`, 'A4:A5', 'B4:B5', `A${linhaTotal}:B${linhaTotal}`]

  const linhaTitulo = []
  const linhaMissao = []
  const linhaPeriodo = []
  for (let coluna = 0; coluna < totalColunas; coluna += 1) {
    const nome = nomeColuna(coluna)
    linhaTitulo.push(coluna === 0 ? celulaTexto(nome, 1, 'MISSÃO DO PERÍODO', 1) : celulaVazia(nome, 1, 1))
    linhaMissao.push(coluna === 0 ? celulaTexto(nome, 2, tituloProdutos, 2) : celulaVazia(nome, 2, 2))
    linhaPeriodo.push(coluna === 0 ? celulaTexto(nome, 3, `${dataLabel(snapshot.periodo?.inicio)} a ${dataLabel(snapshot.periodo?.fim)}`, 3) : celulaVazia(nome, 3, 3))
  }
  linhasXml.push(`<row r="1" ht="24" customHeight="1">${linhaTitulo.join('')}</row>`)
  linhasXml.push(`<row r="2" ht="44" customHeight="1">${linhaMissao.join('')}</row>`)
  linhasXml.push(`<row r="3" ht="24" customHeight="1">${linhaPeriodo.join('')}</row>`)

  const cabecalho = [celulaTexto('A', 4, 'SETOR', 4), celulaTexto('B', 4, 'CONSULTOR', 4)]
  const subcabecalho = [celulaVazia('A', 5, 4), celulaVazia('B', 5, 4)]
  produtos.forEach((produto, indice) => {
    const primeira = 2 + indice * 3
    const estilo = indice % 2 === 0 ? 5 : 6
    const inicio = nomeColuna(primeira)
    const meio = nomeColuna(primeira + 1)
    const fim = nomeColuna(primeira + 2)
    mesclagens.push(`${inicio}4:${fim}4`)
    cabecalho.push(celulaTexto(inicio, 4, `${produto.descricao}\nEAN ${produto.ean}`, estilo))
    cabecalho.push(celulaVazia(meio, 4, estilo), celulaVazia(fim, 4, estilo))
    subcabecalho.push(celulaTexto(inicio, 5, 'META DO PRODUTO', estilo))
    subcabecalho.push(celulaTexto(meio, 5, 'QTDE FATURADA', estilo))
    subcabecalho.push(celulaTexto(fim, 5, '% ATINGIMENTO', estilo))
  })
  linhasXml.push(`<row r="4" ht="44" customHeight="1">${cabecalho.join('')}</row>`)
  linhasXml.push(`<row r="5" ht="34" customHeight="1">${subcabecalho.join('')}</row>`)

  consultores.forEach((consultor, indiceConsultor) => {
    const numeroLinha = 6 + indiceConsultor
    const celulas = [
      celulaTexto('A', numeroLinha, consultor.setor || '-', 7),
      celulaTexto('B', numeroLinha, consultor.consultor, 8),
    ]
    produtos.forEach((produto, indiceProduto) => {
      const primeira = 2 + indiceProduto * 3
      const linha = mapa.get(`${consultor.consultor_id}|${produto.foco_id}`)
      const meta = numero(linha?.meta_quantidade)
      const realizado = numero(linha?.realizado_quantidade)
      const atingimento = meta > 0 ? realizado / meta : 0
      const estiloPercentual = atingimento >= 1 ? 13 : atingimento > 0 ? 12 : 11
      if (meta > 0) {
        celulas.push(celulaNumero(nomeColuna(primeira), numeroLinha, meta, 9))
        celulas.push(celulaNumero(nomeColuna(primeira + 1), numeroLinha, realizado, 10))
        celulas.push(celulaNumero(nomeColuna(primeira + 2), numeroLinha, atingimento, estiloPercentual))
      } else {
        celulas.push(celulaTexto(nomeColuna(primeira), numeroLinha, '-', 9))
        celulas.push(celulaTexto(nomeColuna(primeira + 1), numeroLinha, '-', 9))
        celulas.push(celulaTexto(nomeColuna(primeira + 2), numeroLinha, '-', 9))
      }
    })
    linhasXml.push(`<row r="${numeroLinha}" ht="27" customHeight="1">${celulas.join('')}</row>`)
  })

  const totais = [celulaTexto('A', linhaTotal, 'TOTAL', 14), celulaVazia('B', linhaTotal, 14)]
  produtos.forEach((produto, indiceProduto) => {
    const primeira = 2 + indiceProduto * 3
    const linhasProduto = linhas.filter(linha => linha.foco_id === produto.foco_id)
    const meta = linhasProduto.reduce((soma, linha) => soma + numero(linha.meta_quantidade), 0)
    const realizado = linhasProduto.reduce((soma, linha) => soma + numero(linha.realizado_quantidade), 0)
    const atingimento = meta > 0 ? realizado / meta : 0
    totais.push(celulaNumero(nomeColuna(primeira), linhaTotal, meta, 14))
    totais.push(celulaNumero(nomeColuna(primeira + 1), linhaTotal, realizado, 14))
    totais.push(celulaNumero(nomeColuna(primeira + 2), linhaTotal, atingimento, 15))
  })
  linhasXml.push(`<row r="${linhaTotal}" ht="28" customHeight="1">${totais.join('')}</row>`)

  const colunas = ['<col min="1" max="1" width="14" customWidth="1"/>', '<col min="2" max="2" width="38" customWidth="1"/>']
  for (let indice = 0; indice < produtos.length * 3; indice += 1) {
    const numeroColuna = 3 + indice
    colunas.push(`<col min="${numeroColuna}" max="${numeroColuna}" width="17" customWidth="1"/>`)
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
    <dimension ref="A1:${ultimaColuna}${linhaTotal}"/>
    <sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="5" topLeftCell="C6" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="C6" sqref="C6"/></sheetView></sheetViews>
    <sheetFormatPr defaultRowHeight="18"/>
    <cols>${colunas.join('')}</cols>
    <sheetData>${linhasXml.join('')}</sheetData>
    <mergeCells count="${mesclagens.length}">${mesclagens.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>
    <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
    <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
  </worksheet>`
}

function criarXlsx(snapshot) {
  const agora = new Date().toISOString()
  const arquivos = [
    {
      nome: '[Content_Types].xml',
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    },
    {
      nome: '_rels/.rels',
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      nome: 'docProps/core.xml',
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Missão do período</dc:title><dc:creator>Painel Comercial Equipe Norte</dc:creator><cp:lastModifiedBy>Painel Comercial Equipe Norte</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${agora}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${agora}</dcterms:modified></cp:coreProperties>`,
    },
    {
      nome: 'docProps/app.xml',
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Painel Comercial Equipe Norte</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Planilhas</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Missão</vt:lpstr></vt:vector></TitlesOfParts><Company>EMS Genéricos</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>`,
    },
    {
      nome: 'xl/workbook.xml',
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="9303"/><workbookPr defaultThemeVersion="164011"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="Missão" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`,
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { nome: 'xl/styles.xml', conteudo: estilosXml() },
    { nome: 'xl/worksheets/sheet1.xml', conteudo: planilhaXml(snapshot) },
  ]
  return criarZipSemCompressao(arquivos)
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const inicio = texto(params.get('inicio'))
    const fim = texto(params.get('fim'))
    if (!dataValida(inicio) || !dataValida(fim) || inicio > fim) {
      return new Response('Período inválido.', { status: 400 })
    }

    await arquivarPeriodosEncerrados(env)
    const snapshot = await obterMissaoFoco(env, inicio, fim)
    if (!snapshot.linhas?.length) return new Response('Nenhuma missão encontrada neste período.', { status: 404 })

    const arquivo = criarXlsx(snapshot)
    return new Response(arquivo, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="missao_${inicio}_a_${fim}.xlsx"`,
        'content-length': String(arquivo.length),
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return new Response(`Não foi possível gerar a planilha: ${error instanceof Error ? error.message : String(error)}`, { status: 500 })
  }
}
