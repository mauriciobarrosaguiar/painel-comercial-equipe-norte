import { authorized, json } from '../../_lib/credentials.js'

const texto = (value) => String(value ?? '').trim()
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const cnpj = (value) => texto(value).replace(/\D/g, '').slice(0, 14)

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
    const entries = Array.isArray(body?.objetivos) ? body.objetivos : []
    if (!sipId) return json({ erro: 'Informe a SIP.' }, 400)
    if (!entries.length) return json({ erro: 'Informe ao menos um objetivo.' }, 400)
    if (entries.length > 2000) return json({ erro: 'Quantidade de objetivos acima do limite.' }, 400)

    const sip = await env.DB.prepare('SELECT id,nome FROM sips WHERE id=? AND ativo=1').bind(sipId).first()
    if (!sip) return json({ erro: 'SIP não encontrada.' }, 404)

    const normalized = new Map()
    for (const item of entries) {
      const document = cnpj(item?.cnpj)
      const objective = Math.round(Math.max(0, numero(item?.objetivo)) * 100) / 100
      if (document.length === 14) normalized.set(document, objective)
    }
    if (!normalized.size) return json({ erro: 'Nenhum CNPJ válido foi informado.' }, 400)

    const linked = await env.DB.prepare(
      'SELECT cnpj FROM sip_clientes WHERE sip_id=? AND ativo=1',
    ).bind(sipId).all()
    const allowed = new Set((linked.results || []).map((item) => cnpj(item.cnpj)))
    const updates = [...normalized.entries()].filter(([document]) => allowed.has(document))
    if (!updates.length) return json({ erro: 'Nenhum cliente informado pertence a esta SIP.' }, 400)

    const now = new Date().toISOString()
    const statements = updates.map(([document, objective]) => env.DB.prepare(`
      UPDATE sip_clientes
         SET objetivo_preco_liquido=?,atualizado_em=?
       WHERE sip_id=? AND cnpj=? AND ativo=1
    `).bind(objective, now, sipId, document))
    await env.DB.batch(statements)
    const totalRow = await env.DB.prepare(`
      SELECT COALESCE(SUM(objetivo_preco_liquido),0) objetivo_total
        FROM sip_clientes
       WHERE sip_id=? AND ativo=1
    `).bind(sipId).first()
    const total = numero(totalRow?.objetivo_total)
    await env.DB.prepare(
      'UPDATE sips SET meta_mes=?,atualizado_em=? WHERE id=?',
    ).bind(total, now, sipId).run()

    return json({
      sucesso: true,
      mensagem: 'Objetivos atualizados.',
      sip_id: sipId,
      clientes_atualizados: updates.length,
      objetivo_total: total,
      atualizado_em: now,
    })
  } catch (error) {
    return json({
      erro: 'Não foi possível atualizar os objetivos.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
