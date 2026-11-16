import { json, readSession } from '../../_lib/credentials.js'
import { enforcePersonalScope, MAURICIO_LOGIN } from '../../_lib/personal-scope.js'
import { isTursoTransient } from '../../_lib/turso-retry.js'

export async function onRequestGet({ request, env }) {
  const usuario = await readSession(request, env.PAINEL_ADMIN_KEY)
  if (!usuario || usuario.login !== MAURICIO_LOGIN) return json({ autenticado: false }, 401)
  try { await enforcePersonalScope(env) }
  catch (error) {
    if (isTursoTransient(error)) return json({ erro: 'O banco está temporariamente indisponível. Tente novamente em alguns segundos.' }, 503, { 'retry-after': '5' })
    throw error
  }
  return json({ autenticado: true, usuario: {
    login: usuario.login,
    nome: usuario.nome,
    consultor_id: usuario.consultor_id || '',
    email: usuario.login.includes('@') ? usuario.login : `${usuario.login}@ems.com.br`,
  } })
}
