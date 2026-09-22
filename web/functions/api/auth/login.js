import { createSessionToken, json, sessionCookie } from '../../_lib/credentials.js'
import { enforcePersonalScope } from '../../_lib/personal-scope.js'

const ACESSOS = {
  m0043497: {
    nome: 'MAURICIO BARROS DE AGUIAR',
    email: 'm0043497@ems.com.br',
    consultor_id: 'cons-1ee6626b98906f06c399a6ad350c',
  },
}

const texto = (valor) => String(valor ?? '').trim().toLowerCase()
const local = (valor) => texto(valor).split('@')[0]

export async function onRequestPost({ request, env }) {
  try {
    if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
      return json({ erro: 'A chave de sessão do painel ainda não foi configurada.' }, 503)
    }

    const body = await request.json().catch(() => ({}))
    const informado = texto(body.login)
    const login = local(informado)

    if (!login) return json({ erro: 'Informe seu login ou e-mail EMS.' }, 400)
    if (informado.includes('@') && informado !== `${login}@ems.com.br`) {
      return json({ erro: 'Use o e-mail corporativo @ems.com.br.' }, 400)
    }

    const acesso = ACESSOS[login]
    if (!acesso) {
      return json({ erro: 'Este painel é de uso pessoal do Maurício.' }, 401)
    }

    const usuario = {
      login,
      email: acesso.email,
      nome: acesso.nome,
      consultor_id: acesso.consultor_id,
    }

    await enforcePersonalScope(env)
    const token = await createSessionToken(usuario, env.PAINEL_ADMIN_KEY)
    return json({ usuario }, 200, { 'set-cookie': sessionCookie(token) })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    return json({ erro: 'Não foi possível entrar no painel.', detalhe }, 500)
  }
}
