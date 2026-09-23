import { authorized, decryptCredentials, json } from '../../_lib/credentials.js'

const INTEGRATION = 'MERCADO_FARMA_MAURICIO'

export async function onRequestGet({ request, env }) {
  if (!env.PAINEL_ADMIN_KEY || !(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Acesso não autorizado.' }, 401)
  }

  const current = await env.DB.prepare(
    'SELECT credencial_cifrada FROM integracao_credenciais WHERE integracao=?',
  ).bind(INTEGRATION).first()

  if (!current?.credencial_cifrada) {
    return json({ erro: 'Acesso pessoal do Mercado Farma ainda não cadastrado.' }, 404)
  }

  try {
    const credentials = await decryptCredentials(current.credencial_cifrada, env.PAINEL_ADMIN_KEY)
    const usuario = String(credentials?.usuario || '').trim()
    const segredo = String(credentials?.segredo || '')
    if (!usuario || !segredo) return json({ erro: 'A credencial pessoal do Mercado Farma está incompleta.' }, 404)
    return json({ usuario, segredo })
  } catch (error) {
    return json({ erro:'Não foi possível decifrar o acesso pessoal do Mercado Farma.', detalhe:error instanceof Error ? error.message : String(error) }, 500)
  }
}
