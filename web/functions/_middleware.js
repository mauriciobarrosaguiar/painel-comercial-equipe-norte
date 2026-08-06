import { authorized, json, readSession } from './_lib/credentials.js'

const VISIBILIDADE_KEY = 'bussola_visibilidade_contingencia'
const ROTAS_LIBERADAS_NA_CONTINGENCIA = new Set([
  '/api/admin/bussola',
  '/api/health',
  '/api/automacoes',
  '/api/configuracoes-automacao',
])

async function lerVisibilidade(env) {
  try {
    const atual = await env.DB.prepare(
      'SELECT valor_json FROM configuracoes WHERE chave=?',
    ).bind(VISIBILIDADE_KEY).first()
    if (!atual?.valor_json) return null
    const estado = JSON.parse(atual.valor_json)
    return estado && typeof estado === 'object' ? estado : null
  } catch {
    return null
  }
}

export function contingencyDecision(path, session, estado, requestUrl) {
  if (!estado || estado.modo !== 'individual') return { action: 'pass' }
  if (ROTAS_LIBERADAS_NA_CONTINGENCIA.has(path)) return { action: 'pass' }

  const consultorId = String(session?.consultor_id || '').trim()
  const liberados = new Set(
    (estado.consultores_ids || []).map((item) => String(item || '').trim()).filter(Boolean),
  )

  if (path === '/api/dashboard') {
    if (!consultorId || !liberados.has(consultorId)) {
      return {
        action: 'block',
        status: 403,
        code: 'CONTINGENCIA_AGUARDANDO_ACESSO',
        message: 'A visão do mês atual será liberada depois que você cadastrar o acesso de contingência e a extração for concluída.',
      }
    }
    const url = new URL(requestUrl)
    url.searchParams.set('consultor', consultorId)
    return { action: 'dashboard', url: url.toString(), consultorId }
  }

  if (path.startsWith('/api/')) {
    return {
      action: 'block',
      status: 403,
      code: 'CONTINGENCIA_APENAS_VISAO_INDIVIDUAL',
      message: 'Enquanto a contingência estiver parcial, somente a visão individual do consultor está disponível.',
    }
  }
  return { action: 'pass' }
}

async function dashboardIndividual(request, next, decision, session, estado) {
  const response = await next(new Request(decision.url, request))
  if (!response.ok) return response
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return response

  const body = await response.json()
  const nome = String(session?.nome || '').trim()
  body.contingencia = {
    modo: 'individual',
    completa: false,
    consultor_id: decision.consultorId,
    nome,
    consultores_extraidos: Number(estado.consultores_extraidos || 0),
    consultores_esperados: Number(estado.consultores_esperados || 0),
    faltantes: estado.faltantes || [],
    atualizado_em: estado.atualizado_em || null,
  }
  body.filtros = body.filtros || {}
  body.filtros.consultores = [{ id: decision.consultorId, nome: nome || 'Minha carteira' }]
  body.filtros.aplicado = body.filtros.aplicado || {}
  body.filtros.aplicado.consultor = decision.consultorId
  body.filtros.aplicado.rotulo = `${body.filtros.aplicado.rotulo || 'Mês atual'} · visão individual`

  const headers = new Headers(response.headers)
  headers.set('content-type', 'application/json; charset=UTF-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { status: response.status, headers })
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url)
  const path = url.pathname
  if (!path.startsWith('/api/')) return next()
  if (path === '/api/auth/login' || path === '/api/auth/session' || path === '/api/auth/logout') return next()
  if (path === '/api/sips/detalhe' && url.searchParams.get('publico') === '1') return next()
  if (path === '/api/exportar' && url.searchParams.get('tipo') === 'sip_detalhado' && url.searchParams.get('publico') === '1') return next()
  if (path.startsWith('/api/internal/')) return (await authorized(request, env.PAINEL_ADMIN_KEY)) ? next() : json({ erro: 'Acesso interno negado.' }, 401)

  const session = await readSession(request, env.PAINEL_ADMIN_KEY)
  if (session) {
    const estado = await lerVisibilidade(env)
    const decision = contingencyDecision(path, session, estado, request.url)
    if (decision.action === 'block') {
      return json({
        erro: decision.message,
        codigo: decision.code,
        contingencia: {
          modo: 'individual',
          consultor_id: session.consultor_id || '',
          consultores_extraidos: Number(estado?.consultores_extraidos || 0),
          consultores_esperados: Number(estado?.consultores_esperados || 0),
          faltantes: estado?.faltantes || [],
        },
      }, decision.status)
    }
    if (decision.action === 'dashboard') {
      return dashboardIndividual(request, next, decision, session, estado)
    }
    return next()
  }

  if (await authorized(request, env.PAINEL_ADMIN_KEY)) return next()
  return json({ erro: 'Sessão expirada. Entre novamente no painel.' }, 401)
}
