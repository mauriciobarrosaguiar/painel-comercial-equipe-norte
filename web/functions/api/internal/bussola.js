import { authorized, decryptCredentials, json } from '../../_lib/credentials.js'

const INTEGRATION = 'BUSSOLA'

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
    const credentials = await decryptCredentials(
      current.credencial_cifrada,
      env.PAINEL_ADMIN_KEY,
    )

    return json({
      usuario: String(credentials?.usuario || ''),
      segredo: String(credentials?.segredo || ''),
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
