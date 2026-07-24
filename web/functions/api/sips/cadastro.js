import { authorized, json } from '../../_lib/credentials.js'

const texto = (value) => String(value ?? '').trim()
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const digitos = (value) => texto(value).replace(/\D/g, '')

async function requireAdmin(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return json({ erro: 'Chave administrativa não configurada.' }, 503)
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) return json({ erro: 'Chave administrativa inválida.' }, 401)
  return null
}

export async function onRequestPost({ request, env }) {
  const denial = await requireAdmin(request, env)
  if (denial) return denial
  try {
    const body = await request.json()
    const nome = texto(body.nome)
    if (nome.length < 3) return json({ erro: 'Informe o nome da SIP.' }, 400)

    const id = texto(body.id) || `sip-${crypto.randomUUID()}`
    const now = new Date().toISOString()
    const active = body.ativo === false ? 0 : 1
    const publicAccess = body.acesso_publico_ativo === false ? 0 : 1
    const monthlyGoal = Math.max(0, numero(body.meta_mes))
    await env.DB.prepare(`
      INSERT INTO sips(id,nome,meta_mes,pagamento_percentual,acesso_publico_ativo,ativo,atualizado_em)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        nome=excluded.nome,
        meta_mes=excluded.meta_mes,
        pagamento_percentual=excluded.pagamento_percentual,
        acesso_publico_ativo=excluded.acesso_publico_ativo,
        ativo=excluded.ativo,
        atualizado_em=excluded.atualizado_em
    `).bind(id, nome, monthlyGoal, numero(body.pagamento_percentual), publicAccess, active, now).run()

    const documents = [...new Set((Array.isArray(body.cnpjs) ? body.cnpjs : String(body.cnpjs || '').split(/[\n,;]+/))
      .map(digitos).filter((value) => value.length === 14))]
    if (documents.length) {
      const defaultObjective = monthlyGoal / documents.length
      await env.DB.prepare('UPDATE sip_clientes SET ativo=0,atualizado_em=? WHERE sip_id=?').bind(now, id).run()
      for (const document of documents) {
        const client = await env.DB.prepare('SELECT id FROM clientes WHERE cnpj=? LIMIT 1').bind(document).first()
        await env.DB.prepare(`
          INSERT INTO sip_clientes(sip_id,cnpj,cliente_id,ativo,objetivo_preco_liquido,atualizado_em)
          VALUES(?,?,?,1,?,?)
          ON CONFLICT(sip_id,cnpj) DO UPDATE SET
            cliente_id=excluded.cliente_id,
            ativo=1,
            objetivo_preco_liquido=CASE
              WHEN sip_clientes.objetivo_preco_liquido>0 THEN sip_clientes.objetivo_preco_liquido
              ELSE excluded.objetivo_preco_liquido
            END,
            atualizado_em=excluded.atualizado_em
        `).bind(id, document, client?.id || null, defaultObjective, now).run()
      }
    }

    return json({ sucesso: true, id, nome, clientes_vinculados: documents.length, atualizado_em: now })
  } catch (error) {
    return json({
      erro: 'Não foi possível cadastrar a SIP.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
