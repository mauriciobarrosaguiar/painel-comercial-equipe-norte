import { authorized, decryptCredentials, json } from '../../_lib/credentials.js'

const INTEGRATION = 'BUSSOLA'

function normalizeBundle(payload) {
  const bundle = { versao: 2, gd: {}, consultores: {} }
  if (!payload || typeof payload !== 'object') return bundle

  const structured = payload.gd || payload.consultores || Number(payload.versao || 0) >= 2
  if (!structured) {
    const usuario = String(payload.usuario || '').trim()
    const segredo = String(payload.segredo || '')
    if (usuario && segredo) bundle.gd = { usuario, segredo, salvo_em: payload.salvo_em || null }
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
    const usuario = String(item.usuario || '').trim()
    const segredo = String(item.segredo || '')
    if (!consultorId || !usuario || !segredo) continue
    bundle.consultores[consultorId] = {
      consultor_id: consultorId,
      nome: String(item.nome || '').trim(),
      login_painel: String(item.login_painel || '').trim(),
      usuario,
      segredo,
      salvo_em: item.salvo_em || null,
    }
  }
  return bundle
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

export async function onRequestGet({ request, env }) {
  if (!env.PAINEL_ADMIN_KEY || !(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Acesso não autorizado.' }, 401)
  }

  const current = await env.DB.prepare(
    `SELECT credencial_cifrada
       FROM integracao_credenciais
      WHERE integracao = ?`,
  ).bind(INTEGRATION).first()

  if (!current?.credencial_cifrada) {
    return json({ erro: 'Credenciais do Bússola ainda não cadastradas.' }, 404)
  }

  try {
    const decrypted = await decryptCredentials(current.credencial_cifrada, env.PAINEL_ADMIN_KEY)
    const bundle = normalizeBundle(decrypted)
    const gdUsuario = String(bundle.gd?.usuario || '')
    const gdSegredo = String(bundle.gd?.segredo || '')
    const consultores = Object.values(bundle.consultores || {})
    if ((!gdUsuario || !gdSegredo) && !consultores.length) {
      return json({ erro: 'Nenhuma credencial válida do Bússola está cadastrada.' }, 404)
    }

    return json({
      usuario: gdUsuario,
      segredo: gdSegredo,
      gd: {
        usuario: gdUsuario,
        segredo: gdSegredo,
        salvo_em: bundle.gd?.salvo_em || null,
      },
      consultores,
      consultores_esperados: await expectedConsultants(env),
    })
  } catch (error) {
    return json(
      {
        erro: 'Não foi possível decifrar as credenciais salvas.',
        detalhe: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}
