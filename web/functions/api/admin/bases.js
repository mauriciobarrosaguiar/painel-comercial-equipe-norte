import { onRequestGet as obterBases, onRequestPost as importarBases } from './bases-v2.js'
import { onRequestPost as fecharMes } from '../internal/fechamento-mensal.js'
import { onRequestPost as dispararDesafioSap } from '../desafio-gigantes-disparar.js'

const texto = (value) => String(value ?? '').trim()

function mesAnterior(anoMes) {
  const [ano, mes] = anoMes.split('-').map(Number)
  const data = new Date(Date.UTC(ano, mes - 1, 1))
  data.setUTCMonth(data.getUTCMonth() - 1)
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`
}

async function fecharAnteriorAntesDaImportacao({ request, env }, body) {
  const tipo = texto(body?.tipo)
  const anoMes = texto(body?.ano_mes)
  if (!['metas', 'metas_mix'].includes(tipo) || !/^\d{4}-\d{2}$/.test(anoMes)) return null

  const anterior = mesAnterior(anoMes)
  const metaAnterior = await env.DB.prepare(
    'SELECT COUNT(*) total FROM metas WHERE ano_mes=?',
  ).bind(anterior).first()
  if (Number(metaAnterior?.total || 0) === 0) return null

  const fechamentoAtual = await env.DB.prepare(`
    SELECT id FROM historico_mensal
     WHERE ano_mes=? AND escopo='GERAL' AND versao_atual=1
     LIMIT 1
  `).bind(anterior).first()
  if (fechamentoAtual?.id) return null

  const chave = request.headers.get('x-admin-key') || ''
  const fechamentoRequest = new Request(
    new URL('/api/internal/fechamento-mensal', request.url),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-key': chave,
      },
      body: JSON.stringify({
        ano_mes: anterior,
        motivo: `Fechamento automático antes da importação das metas de ${anoMes}.`,
      }),
    },
  )

  const response = await fecharMes({ request: fechamentoRequest, env })
  return response.ok ? null : response
}

async function acionarSapAposImportacao(context) {
  const headers = new Headers({ 'content-type': 'application/json' })
  const cookie = context.request.headers.get('cookie') || ''
  const chave = context.request.headers.get('x-admin-key') || ''
  if (cookie) headers.set('cookie', cookie)
  if (chave) headers.set('x-admin-key', chave)
  const request = new Request(new URL('/api/desafio-gigantes-disparar', context.request.url), {
    method: 'POST',
    headers,
    body: '{}',
  })
  return dispararDesafioSap({ request, env: context.env })
}

export const onRequestGet = obterBases

export async function onRequestPost(context) {
  let body = {}
  try {
    body = await context.request.clone().json()
  } catch {}

  const falhaFechamento = await fecharAnteriorAntesDaImportacao(context, body)
  if (falhaFechamento) return falhaFechamento

  const response = await importarBases(context)
  if (!response.ok || texto(body?.tipo) !== 'desafio_gigantes') return response

  let resultado = {}
  try { resultado = await response.json() } catch {}
  let automacaoSap = { acionada: false, status: 'erro', mensagem: 'A planilha foi importada, mas a verificação SAP não pôde ser acionada.' }
  try {
    const disparo = await acionarSapAposImportacao(context)
    const dados = await disparo.json().catch(() => ({}))
    automacaoSap = {
      acionada: disparo.ok,
      status: dados.status || (disparo.ok ? 'acionada' : 'erro'),
      mensagem: dados.mensagem || dados.erro || automacaoSap.mensagem,
    }
  } catch (error) {
    automacaoSap.mensagem = `A planilha foi importada, mas o disparo SAP falhou: ${error instanceof Error ? error.message : String(error)}`
  }
  return new Response(JSON.stringify({ ...resultado, automacao_sap: automacaoSap }), {
    status: response.status,
    headers: response.headers,
  })
}
