import { createSessionToken, json, sessionCookie } from '../../_lib/credentials.js'

const ACESSOS = {
  a0002958: {
    nome: 'ALESSANDRA FREITAS SA',
    email: 'a0002958@ems.com.br',
    consultor_id: 'cons-9de1223057e4e9526a953d7b1228',
  },
  d0047303: {
    nome: 'DENYSE CRISTINA VIANA VELOSO ARAUJO',
    email: 'd0047303@ems.com.br',
    consultor_id: 'cons-772c771cb3d26d22ce3c697169e5',
  },
  j0050526: {
    nome: 'JOAO DIEGO FERREIRA DE OLIVEIRA',
    email: 'j0050526@ems.com.br',
    consultor_id: 'cons-94c69626a2bd7b4f0181ba70662e',
  },
  r0041868: {
    nome: 'RAIMUNDA MARTINS GOMES CARNEIRO',
    email: 'r0041868@ems.com.br',
    consultor_id: 'cons-8ded2f2f390c137233ddca4739b0',
  },
  m0043497: {
    nome: 'MAURICIO BARROS DE AGUIAR',
    email: 'm0043497@ems.com.br',
    consultor_id: 'cons-1ee6626b98906f06c399a6ad350c',
  },
  f0059410: {
    nome: 'FRANCISCO CORTEZ FILHO',
    email: 'f0059410@ems.com.br',
    consultor_id: 'cons-9cbca1ed3b527eb6e7c2cd75e0ee',
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
      return json({ erro: 'Este código não está autorizado para acessar o Painel da Equipe Norte.' }, 401)
    }

    const usuario = {
      login,
      email: acesso.email,
      nome: acesso.nome,
      consultor_id: acesso.consultor_id,
    }

    const token = await createSessionToken(usuario, env.PAINEL_ADMIN_KEY)
    return json({ usuario }, 200, { 'set-cookie': sessionCookie(token) })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    return json({ erro: 'Não foi possível entrar no painel.', detalhe }, 500)
  }
}
