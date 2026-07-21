import { arquivarPeriodosEncerrados, obterMissaoFoco } from '../_lib/focus-history.js'

const texto = value => String(value ?? '').trim()
const dataValida = value => /^\d{4}-\d{2}-\d{2}$/.test(texto(value))
const numero = value => (Number.isFinite(Number(value)) ? Number(value) : 0)
const escapar = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

const dataLabel = value => {
  const [ano, mes, dia] = texto(value).split('-')
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : texto(value)
}

const valor = value => Number.isInteger(numero(value))
  ? String(numero(value))
  : numero(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })

function planilhaHtml(snapshot) {
  const produtos = Array.isArray(snapshot.produtos) ? snapshot.produtos : []
  const consultores = Array.isArray(snapshot.consultores) ? snapshot.consultores : []
  const linhas = Array.isArray(snapshot.linhas) ? snapshot.linhas : []
  const mapa = new Map(linhas.map(linha => [`${linha.consultor_id}|${linha.foco_id}`, linha]))
  const totalColunas = 2 + produtos.length * 3
  const tituloProdutos = produtos.map(item => item.descricao).join(' & ')

  const cabecalhoProdutos = produtos.map((produto, indice) => `
    <th colspan="3" class="produto grupo-${indice % 2}">
      ${escapar(produto.descricao)}<br><small>EAN ${escapar(produto.ean)}</small>
    </th>
  `).join('')

  const subcabecalho = produtos.map((_, indice) => `
    <th class="sub grupo-${indice % 2}">META DO PRODUTO</th>
    <th class="sub grupo-${indice % 2}">QTDE FATURADA</th>
    <th class="sub grupo-${indice % 2}">% ATINGIMENTO</th>
  `).join('')

  const corpo = consultores.map(consultor => {
    const colunas = produtos.map(produto => {
      const linha = mapa.get(`${consultor.consultor_id}|${produto.foco_id}`)
      const meta = numero(linha?.meta_quantidade)
      const realizado = numero(linha?.realizado_quantidade)
      const percentual = meta > 0 ? realizado / meta * 100 : 0
      const classe = percentual >= 100 ? 'atingiu' : percentual > 0 ? 'parcial' : 'zerado'
      return `
        <td class="numero">${meta > 0 ? valor(meta) : '-'}</td>
        <td class="numero realizado">${meta > 0 ? valor(realizado) : '-'}</td>
        <td class="numero ${classe}">${meta > 0 ? `${valor(percentual)}%` : '-'}</td>
      `
    }).join('')
    return `<tr><td class="setor">${escapar(consultor.setor || '-')}</td><td class="consultor">${escapar(consultor.consultor)}</td>${colunas}</tr>`
  }).join('')

  const totais = produtos.map(produto => {
    const linhasProduto = linhas.filter(linha => linha.foco_id === produto.foco_id)
    const meta = linhasProduto.reduce((soma, linha) => soma + numero(linha.meta_quantidade), 0)
    const realizado = linhasProduto.reduce((soma, linha) => soma + numero(linha.realizado_quantidade), 0)
    const percentual = meta > 0 ? realizado / meta * 100 : 0
    const classe = percentual >= 100 ? 'atingiu' : percentual > 0 ? 'parcial' : 'zerado'
    return `<td>${valor(meta)}</td><td>${valor(realizado)}</td><td class="${classe}">${valor(percentual)}%</td>`
  }).join('')

  return `<!doctype html>
  <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
  <head>
    <meta charset="utf-8">
    <style>
      body{font-family:Arial,sans-serif;margin:18px;color:#14243a}
      table{border-collapse:collapse;min-width:${Math.max(900, totalColunas * 120)}px}
      th,td{border:1px solid #9ca9b5;padding:8px 10px;font-size:12px;vertical-align:middle}
      .titulo{background:#1f416f;color:#fff;font-size:15px;text-align:left;letter-spacing:.04em}
      .missao{background:#1f416f;color:#fff;font-size:22px;text-align:center;font-weight:700}
      .periodo{background:#1f416f;color:#fff;font-size:13px;text-align:center}
      .fixo{background:#7898c9;color:#fff;font-weight:700;text-align:center}
      .produto{color:#fff;font-size:12px;text-align:center;font-weight:700}
      .produto small{font-size:10px;font-weight:400}
      .sub{color:#fff;text-align:center;font-size:11px}
      .grupo-0{background:#e89a67}.grupo-1{background:#568b3b}
      .setor{white-space:nowrap}.consultor{font-weight:700;min-width:250px}
      .numero{text-align:center;mso-number-format:'0.00'}
      .realizado{font-weight:700}.zerado{background:#ef7478;color:#5d1215;font-weight:700}
      .parcial{background:#f4d179;color:#594200;font-weight:700}.atingiu{background:#64b77a;color:#083d17;font-weight:700}
      tfoot td{background:#0b376f;color:#fff;font-weight:700;text-align:center}
    </style>
  </head>
  <body>
    <table>
      <thead>
        <tr><th colspan="${totalColunas}" class="titulo">MISSÃO DO PERÍODO</th></tr>
        <tr><th colspan="${totalColunas}" class="missao">${escapar(tituloProdutos)}</th></tr>
        <tr><th colspan="${totalColunas}" class="periodo">${dataLabel(snapshot.periodo?.inicio)} a ${dataLabel(snapshot.periodo?.fim)}</th></tr>
        <tr><th rowspan="2" class="fixo">SETOR</th><th rowspan="2" class="fixo">CONSULTOR</th>${cabecalhoProdutos}</tr>
        <tr>${subcabecalho}</tr>
      </thead>
      <tbody>${corpo}</tbody>
      <tfoot><tr><td colspan="2">TOTAL</td>${totais}</tr></tfoot>
    </table>
  </body>
  </html>`
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

    const conteudo = planilhaHtml(snapshot)
    return new Response(conteudo, {
      headers: {
        'content-type': 'application/vnd.ms-excel; charset=UTF-8',
        'content-disposition': `attachment; filename="missao_${inicio}_a_${fim}.xls"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return new Response(`Não foi possível gerar a planilha: ${error instanceof Error ? error.message : String(error)}`, { status: 500 })
  }
}
