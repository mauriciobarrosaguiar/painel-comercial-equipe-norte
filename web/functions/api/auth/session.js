import { json, readSession } from '../../_lib/credentials.js'
import { enforcePersonalScope, MAURICIO_LOGIN } from '../../_lib/personal-scope.js'

export async function onRequestGet({ request, env }) {
  const usuario = await readSession(request, env.PAINEL_ADMIN_KEY)
  if (!usuario || usuario.login !== MAURICIO_LOGIN) return json({ autenticado: false }, 401)
  await enforcePersonalScope(env)
  return json({ autenticado: true, usuario: {
    login: usuario.login,
    nome: usuario.nome,
    consultor_id: usuario.consultor_id || '',
    email: usuario.login.includes('@') ? usuario.login : `${usuario.login}@ems.com.br`,
  } })
}
