import { onRequestGet as obterBases, onRequestPost as importarBases } from './bases-v2.js'
import { onRequestPost as fecharMes } from '../internal/fechamento-mensal.js'

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

export const onRequestGet = obterBases

export async function onRequestPost(context) {
  let body = {}
  try {
    body = await context.request.clone().json()
  } catch {}

  const falhaFechamento = await fecharAnteriorAntesDaImportacao(context, body)
  if (falhaFechamento) return falhaFechamento
  return importarBases(context)
}
