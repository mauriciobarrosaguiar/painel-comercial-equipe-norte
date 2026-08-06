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
        action: 'dashboard_blocked',
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
  body.consultores_ativos = 1
  body.diagnostico = {
    pedidos_faturados: Number(body.pedidos_faturados || 0),
    itens_faturados: 0,
    valor_faturado_total: Number(body.ol_total_faturado || 0),
    primeira_data: null,
    ultima_data: null,
  }
  if (body.bases) body.bases.painel_equipe_norte = Number(body.clientes_ativos || 0)

  const headers = new Headers(response.headers)
  headers.set('content-type', 'application/json; charset=UTF-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { status: response.status, headers })
}

function dashboardAguardando(session, estado, message) {
  const consultorId = String(session?.consultor_id || '')
  const nome = String(session?.nome || '')
  return json({
    ol_total_faturado: 0, ol_sem_combate: 0, ol_combate: 0, ol_prioritarios: 0, ol_lancamentos: 0,
    meta_ol_sem_combate: 0, meta_ol_prioritarios: 0, meta_ol_lancamentos: 0,
    resultado_ol_sem_combate: 0, resultado_ol_prioritarios: 0, resultado_ol_lancamentos: 0,
    projecao: {
      ativa: true, dias_uteis_decorridos: 0, dias_uteis_total: 0, fator: 1,
      ol_sem_combate: 0, ol_prioritarios: 0, ol_lancamentos: 0,
      resultado_ol_sem_combate: 0, resultado_ol_prioritarios: 0, resultado_ol_lancamentos: 0,
    },
    clientes_com_venda: 0, clientes_sem_venda: 0, clientes_ativos: 0, consultores_ativos: 1,
    vendas_faturadas: 0, pedidos_faturados: 0, pedidos_nao_faturados: 0, valor_nao_faturado: 0,
    nao_faturados_por_consultor: [], ticket_medio_cliente: 0, ticket_medio_pedido: 0,
    percentual_positivacao: 0, automacoes_executando: 0,
    bases: { painel_equipe_norte: 0, produtos_mix: 0, produtos_mercado_farma: 0, metas: 0 },
    diagnostico: { pedidos_faturados: 0, itens_faturados: 0, valor_faturado_total: 0, primeira_data: null, ultima_data: null },
    filtros: {
      consultores: consultorId ? [{ id: consultorId, nome: nome || 'Minha carteira' }] : [],
      ufs: [],
      aplicado: { periodo: 'mes-atual', inicio: null, fim: null, consultor: consultorId, uf: '', rotulo: 'Aguardando acesso de contingência' },
    },
    contingencia: {
      modo: 'individual', bloqueada: true, completa: false, consultor_id: consultorId, nome,
      mensagem: message,
      consultores_extraidos: Number(estado?.consultores_extraidos || 0),
      consultores_esperados: Number(estado?.consultores_esperados || 0),
      faltantes: estado?.faltantes || [], atualizado_em: estado?.atualizado_em || null,
    },
    atualizado_em: null,
  })
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url)
  const path = url.pathname
  if (!path.startsWith('/api/')) return next()
  if (path === '/api/auth/login' || path === '/api/auth/session' || path === '/api/auth/logout') return next()
  if (path.startsWith('/api/internal/')) return (await authorized(request, env.PAINEL_ADMIN_KEY)) ? next() : json({ erro: 'Acesso interno negado.' }, 401)

  const acessoPublicoSip = (path === '/api/sips/detalhe' && url.searchParams.get('publico') === '1')
    || (path === '/api/exportar' && url.searchParams.get('tipo') === 'sip_detalhado' && url.searchParams.get('publico') === '1')
  if (acessoPublicoSip) {
    const estadoPublico = await lerVisibilidade(env)
    if (estadoPublico?.modo === 'individual') {
      return json({
        erro: 'A visão pública está temporariamente indisponível durante a contingência parcial.',
        codigo: 'CONTINGENCIA_PUBLICA_BLOQUEADA',
      }, 503)
    }
    return next()
  }

  const session = await readSession(request, env.PAINEL_ADMIN_KEY)
  if (session) {
    const estado = await lerVisibilidade(env)
    const decision = contingencyDecision(path, session, estado, request.url)
    if (decision.action === 'dashboard_blocked') {
      return dashboardAguardando(session, estado, decision.message)
    }
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
