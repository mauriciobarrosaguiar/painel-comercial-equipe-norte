import { readSession } from '../_lib/credentials.js'

const HEADERS = { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const text = value => String(value ?? '').trim()
const digits = value => text(value).replace(/\D/g, '')

async function sessionOr401(request, env) {
  const session = await readSession(request, env.PAINEL_ADMIN_KEY)
  return session || null
}

export async function onRequestGet({ request, env }) {
  try {
    const session = await sessionOr401(request, env)
    if (!session) return json({ erro: 'Sessão não autorizada.' }, 401)
    const result = await env.DB.prepare(`
      SELECT texto_normalizado, ean, produto_oficial, confirmacoes, atualizado_em
      FROM cruzamento_pedidos_aprendizado
      WHERE ativo=1 AND cliente_cnpj=''
      ORDER BY confirmacoes DESC, atualizado_em DESC
      LIMIT 5000
    `).all()
    return json({ aprendizado: result.results || [] })
  } catch (error) {
    return json({ erro: 'Não foi possível carregar o aprendizado.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const session = await sessionOr401(request, env)
    if (!session) return json({ erro: 'Sessão não autorizada.' }, 401)
    const body = await request.json().catch(() => ({}))
    const normalized = text(body.texto_normalizado).slice(0, 500)
    const ean = digits(body.ean).slice(0, 14)
    const produto = text(body.produto_oficial).slice(0, 500)
    if (!normalized || ean.length < 8) return json({ erro: 'Texto normalizado e EAN são obrigatórios.' }, 400)
    await env.DB.prepare(`
      INSERT INTO cruzamento_pedidos_aprendizado
        (cliente_cnpj,texto_cliente,texto_normalizado,ean,produto_oficial,confirmacoes,rejeicoes,ativo,atualizado_em)
      VALUES ('',?,?,?,?,1,0,1,CURRENT_TIMESTAMP)
      ON CONFLICT(cliente_cnpj,texto_normalizado) DO UPDATE SET
        ean=excluded.ean,
        produto_oficial=CASE WHEN excluded.produto_oficial<>'' THEN excluded.produto_oficial ELSE cruzamento_pedidos_aprendizado.produto_oficial END,
        confirmacoes=CASE WHEN cruzamento_pedidos_aprendizado.ean=excluded.ean THEN cruzamento_pedidos_aprendizado.confirmacoes+1 ELSE 1 END,
        rejeicoes=0,
        ativo=1,
        atualizado_em=CURRENT_TIMESTAMP
    `).bind(normalized, normalized, ean, produto).run()
    return json({ ok: true, ean })
  } catch (error) {
    return json({ erro: 'Não foi possível salvar o aprendizado.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
