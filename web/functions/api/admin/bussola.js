import {
  authorized,
  decryptCredentials,
  encryptCredentials,
  json,
  maskUsername,
  readSession,
} from '../../_lib/credentials.js'

const INTEGRATION = 'BUSSOLA'

function secretReady(env) {
  return typeof env.PAINEL_ADMIN_KEY === 'string' && env.PAINEL_ADMIN_KEY.length >= 12
}

async function authenticate(request, env) {
  if (!secretReady(env)) {
    return {
      session: null,
      denial: json({ erro: 'A chave administrativa ainda não foi configurada.', codigo: 'ADMIN_KEY_NOT_CONFIGURED' }, 503),
    }
  }

  const session = await readSession(request, env.PAINEL_ADMIN_KEY)
  if (session) return { session, denial: null }
  if (await authorized(request, env.PAINEL_ADMIN_KEY)) return { session: null, denial: null }
  return { session: null, denial: json({ erro: 'Acesso não autorizado.' }, 401) }
}

async function getCurrent(env) {
  return env.DB.prepare(
    `SELECT usuario_mascarado, credencial_cifrada, status, mensagem_status, testado_em, atualizado_em
       FROM integracao_credenciais WHERE integracao = ?`,
  ).bind(INTEGRATION).first()
}

function emptyBundle() {
  return { versao: 2, gd: {}, consultores: {} }
}

function normalizeBundle(payload) {
  const bundle = emptyBundle()
  if (!payload || typeof payload !== 'object') return bundle

  const hasStructuredPayload = payload.gd || payload.consultores || Number(payload.versao || 0) >= 2
  if (!hasStructuredPayload) {
    const usuario = String(payload.usuario || '').trim()
    const segredo = String(payload.segredo || '')
    if (usuario && segredo) {
      bundle.gd = { usuario, segredo, salvo_em: payload.salvo_em || null }
    }
    return bundle
  }

  const gd = payload.gd && typeof payload.gd === 'object' ? payload.gd : {}
  bundle.gd = {
    usuario: String(gd.usuario || '').trim(),
    segredo: String(gd.segredo || ''),
    salvo_em: gd.salvo_em || null,
  }

  const source = payload.consultores && typeof payload.consultores === 'object'
    ? payload.consultores
    : {}
  const entries = Array.isArray(source) ? source.map((item) => [item?.consultor_id, item]) : Object.entries(source)
  for (const [key, item] of entries) {
    if (!item || typeof item !== 'object') continue
    const consultorId = String(item.consultor_id || key || '').trim()
    if (!consultorId) continue
    bundle.consultores[consultorId] = {
      consultor_id: consultorId,
      nome: String(item.nome || '').trim(),
      login_painel: String(item.login_painel || '').trim(),
      usuario: String(item.usuario || '').trim(),
      segredo: String(item.segredo || ''),
      salvo_em: item.salvo_em || null,
    }
  }
  return bundle
}

async function readBundle(env, current) {
  if (!current?.credencial_cifrada) return emptyBundle()
  const payload = await decryptCredentials(current.credencial_cifrada, env.PAINEL_ADMIN_KEY)
  return normalizeBundle(payload)
}

async function expectedConsultants(env) {
  const result = await env.DB.prepare(`
    SELECT DISTINCT c.id, c.nome
      FROM consultores c
      JOIN clientes cl ON cl.consultor_id=c.id
     WHERE c.ativo=1
       AND c.origem='PAINEL_EQUIPE'
       AND cl.ativo=1
       AND cl.carteira_importada=1
       AND TRIM(COALESCE(c.id,''))<>''
     ORDER BY c.nome COLLATE NOCASE
  `).all()
  return (result.results || []).map((item) => ({
    id: String(item.id || ''),
    nome: String(item.nome || ''),
  })).filter((item) => item.id)
}

function completeCredential(item) {
  return Boolean(String(item?.usuario || '').trim() && String(item?.segredo || ''))
}

function hasAnyCredential(bundle) {
  return completeCredential(bundle.gd)
    || Object.values(bundle.consultores || {}).some(completeCredential)
}

async function persistBundle(env, bundle, current, options = {}) {
  if (!hasAnyCredential(bundle)) {
    await env.DB.prepare('DELETE FROM integracao_credenciais WHERE integracao = ?').bind(INTEGRATION).run()
    return
  }

  const encrypted = await encryptCredentials(bundle, env.PAINEL_ADMIN_KEY)
  const now = new Date().toISOString()
  const gdConfigured = completeCredential(bundle.gd)
  const masked = gdConfigured ? maskUsername(bundle.gd.usuario) : 'Somente contingência'
  const status = options.status || current?.status || (gdConfigured ? 'configurada' : 'contingencia_configurada')
  const message = options.message || current?.mensagem_status || (
    gdConfigured
      ? 'Credencial principal configurada. A contingência usa os acessos individuais quando necessário.'
      : 'Acesso principal da GD ausente. A contingência depende dos acessos individuais configurados.'
  )

  await env.DB.prepare(
    `INSERT INTO integracao_credenciais
      (integracao, usuario_mascarado, credencial_cifrada, status, mensagem_status, testado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integracao) DO UPDATE SET
       usuario_mascarado = excluded.usuario_mascarado,
       credencial_cifrada = excluded.credencial_cifrada,
       status = excluded.status,
       mensagem_status = excluded.mensagem_status,
       testado_em = excluded.testado_em,
       atualizado_em = excluded.atualizado_em`,
  ).bind(
    INTEGRATION,
    masked,
    encrypted,
    status,
    message,
    current?.testado_em || null,
    now,
  ).run()
}

async function buildStatus(env, session, current, bundle) {
  const expected = await expectedConsultants(env)
  const configuredIds = new Set(
    Object.entries(bundle.consultores || {})
      .filter(([, item]) => completeCredential(item))
      .map(([id]) => id),
  )
  const missing = expected.filter((item) => !configuredIds.has(item.id))
  const own = session?.consultor_id ? bundle.consultores?.[session.consultor_id] : null
  const gdConfigured = completeCredential(bundle.gd)

  return {
    configurada: gdConfigured,
    usuario_mascarado: gdConfigured ? maskUsername(bundle.gd.usuario) : '',
    status: current?.status || (gdConfigured ? 'configurada' : 'nao_configurada'),
    mensagem: current?.mensagem_status || 'Credenciais ainda não cadastradas.',
    testado_em: current?.testado_em || null,
    atualizado_em: current?.atualizado_em || null,
    contingencia: {
      disponivel: Boolean(session?.consultor_id),
      configurada: completeCredential(own),
      usuario_mascarado: completeCredential(own) ? maskUsername(own.usuario) : '',
      consultor_id: session?.consultor_id || '',
      nome: session?.nome || '',
      atualizado_em: own?.salvo_em || null,
    },
    cobertura_contingencia: {
      esperados: expected.length,
      configurados: expected.filter((item) => configuredIds.has(item.id)).length,
      faltantes: missing.map((item) => item.nome),
      pronta: expected.length > 0 && missing.length === 0,
    },
  }
}

export async function onRequestGet({ request, env }) {
  const { session, denial } = await authenticate(request, env)
  if (denial) return denial
  try {
    const current = await getCurrent(env)
    const bundle = await readBundle(env, current)
    return json(await buildStatus(env, session, current, bundle))
  } catch (error) {
    return json({
      erro: 'Não foi possível ler as credenciais protegidas.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  const { session, denial } = await authenticate(request, env)
  if (denial) return denial

  const body = await request.json().catch(() => null)
  if (!body) return json({ erro: 'Envie os dados em formato JSON.' }, 400)

  const escopo = body.escopo === 'consultor' ? 'consultor' : 'gd'
  const usuario = String(body.usuario || '').trim()
  const segredo = String(body.segredo || '')
  if (usuario.length < 3 || usuario.length > 180) return json({ erro: 'Informe um usuário válido.' }, 400)
  if (segredo.length < 4 || segredo.length > 300) return json({ erro: 'Informe uma credencial válida.' }, 400)

  try {
    const current = await getCurrent(env)
    const bundle = await readBundle(env, current)
    const now = new Date().toISOString()

    if (escopo === 'consultor') {
      if (!session?.consultor_id) {
        return json({ erro: 'Seu usuário do painel não está vinculado a uma carteira de consultor.' }, 400)
      }
      bundle.consultores[session.consultor_id] = {
        consultor_id: session.consultor_id,
        nome: session.nome || '',
        login_painel: session.login || '',
        usuario,
        segredo,
        salvo_em: now,
      }
      await persistBundle(env, bundle, current)
    } else {
      bundle.gd = { usuario, segredo, salvo_em: now }
      await persistBundle(env, bundle, current, {
        status: 'configurada',
        message: 'Credencial principal da GD salva. A validação ocorrerá na próxima extração.',
      })
    }

    const updated = await getCurrent(env)
    return json({
      sucesso: true,
      ...(await buildStatus(env, session, updated, bundle)),
      mensagem_operacao: escopo === 'consultor'
        ? 'Seu acesso de contingência foi salvo com segurança.'
        : 'Acesso principal da GD salvo com segurança.',
    })
  } catch (error) {
    return json({
      erro: 'Não foi possível salvar as credenciais.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

export async function onRequestDelete({ request, env }) {
  const { session, denial } = await authenticate(request, env)
  if (denial) return denial

  const escopo = new URL(request.url).searchParams.get('escopo') === 'consultor' ? 'consultor' : 'gd'
  try {
    const current = await getCurrent(env)
    if (!current) return json({ sucesso: true, mensagem: 'Nenhum acesso estava salvo.' })
    const bundle = await readBundle(env, current)

    if (escopo === 'consultor') {
      if (!session?.consultor_id) {
        return json({ erro: 'Seu usuário do painel não está vinculado a uma carteira de consultor.' }, 400)
      }
      delete bundle.consultores[session.consultor_id]
    } else {
      bundle.gd = {}
    }

    await persistBundle(env, bundle, current, {
      status: completeCredential(bundle.gd) ? current.status : 'contingencia_configurada',
      message: escopo === 'consultor'
        ? 'Acesso individual removido.'
        : 'Acesso principal da GD removido. A contingência permanece disponível quando completa.',
    })

    const updated = await getCurrent(env)
    return json({
      sucesso: true,
      ...(await buildStatus(env, session, updated, bundle)),
      mensagem_operacao: escopo === 'consultor'
        ? 'Seu acesso de contingência foi removido.'
        : 'Acesso principal da GD removido.',
    })
  } catch (error) {
    return json({
      erro: 'Não foi possível remover o acesso.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
