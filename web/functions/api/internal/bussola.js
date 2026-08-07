import { authorized, decryptCredentials, json } from '../../_lib/credentials.js'

const INTEGRATION = 'BUSSOLA'

function extrairGd(credentials) {
  if (!credentials || typeof credentials !== 'object') return { usuario: '', segredo: '' }

  const usuarioLegado = String(credentials.usuario || '').trim()
  const segredoLegado = String(credentials.segredo || '')
  if (usuarioLegado && segredoLegado) {
    return { usuario: usuarioLegado, segredo: segredoLegado }
  }

  const gd = credentials.gd && typeof credentials.gd === 'object' ? credentials.gd : {}
  return {
    usuario: String(gd.usuario || '').trim(),
    segredo: String(gd.segredo || ''),
  }
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
    return json({ erro: 'Credencial da GD do Bússola ainda não cadastrada.' }, 404)
  }

  try {
    const credentials = await decryptCredentials(
      current.credencial_cifrada,
      env.PAINEL_ADMIN_KEY,
    )
    const gd = extrairGd(credentials)

    if (!gd.usuario || !gd.segredo) {
      return json({ erro: 'A credencial da GD do Bússola está incompleta.' }, 404)
    }

    return json({
      usuario: gd.usuario,
      segredo: gd.segredo,
    })
  } catch (error) {
    return json(
      {
        erro: 'Não foi possível decifrar a credencial da GD salva.',
        detalhe: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}
