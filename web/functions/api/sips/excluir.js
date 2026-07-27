import { authorized, json } from '../../_lib/credentials.js'

const texto = (value) => String(value ?? '').trim()

async function requireAdmin(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return json({ erro: 'Chave administrativa não configurada.' }, 503)
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Acesso não autorizado.' }, 401)
  }
  return null
}

export async function onRequestPost({ request, env }) {
  const denial = await requireAdmin(request, env)
  if (denial) return denial

  try {
    const body = await request.json()
    const sipId = texto(body?.sip_id).slice(0, 180)
    if (!sipId) return json({ erro: 'Informe a SIP que será excluída.' }, 400)

    const sip = await env.DB.prepare(
      'SELECT id,nome FROM sips WHERE id=? AND ativo=1',
    ).bind(sipId).first()
    if (!sip) return json({ erro: 'SIP não encontrada ou já excluída.' }, 404)

    const now = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE sips SET ativo=0,acesso_publico_ativo=0,atualizado_em=? WHERE id=? AND ativo=1',
      ).bind(now, sipId),
      env.DB.prepare(
        'UPDATE sip_clientes SET ativo=0,atualizado_em=? WHERE sip_id=? AND ativo=1',
      ).bind(now, sipId),
      env.DB.prepare(
        'UPDATE sip_redes SET ativo=0,atualizado_em=? WHERE sip_id=? AND ativo=1',
      ).bind(now, sipId),
      env.DB.prepare(
        'UPDATE sip_recados SET ativo=0,atualizado_em=? WHERE sip_id=? AND ativo=1',
      ).bind(now, sipId),
    ])

    return json({
      sucesso: true,
      sip_id: sipId,
      nome: String(sip.nome || ''),
      mensagem: `SIP ${String(sip.nome || '')} excluída com sucesso.`,
      excluido_em: now,
    })
  } catch (error) {
    return json({
      erro: 'Não foi possível excluir a SIP.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
