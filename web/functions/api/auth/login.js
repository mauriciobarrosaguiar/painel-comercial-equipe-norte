import { createSessionToken, json, sessionCookie } from '../../_lib/credentials.js'

const ACESSOS = {
  a0002958: { nome: 'ALESSANDRA FREITAS SA', email: 'a0002958@ems.com.br' },
  d0047303: { nome: 'DENYSE CRISTINA VIANA VELOSO ARAUJO', email: 'd0047303@ems.com.br' },
  j0050526: { nome: 'JOAO DIEGO FERREIRA DE OLIVEIRA', email: 'j0050526@ems.com.br' },
  r0041868: { nome: 'RAIMUNDA MARTINS GOMES CARNEIRO', email: 'r0041868@ems.com.br' },
  m0043497: { nome: 'MAURICIO BARROS DE AGUIAR', email: 'm0043497@ems.com.br' },
  f0059410: { nome: 'FRANCISCO CORTEZ FILHO', email: 'f0059410@ems.com.br' },
}

const texto = (valor) => String(valor ?? '').trim().toLowerCase()
const local = (valor) => texto(valor).split('@')[0]

async function garantirCadastro(env, login) {
  const acesso = ACESSOS[login]
  if (!acesso) return null

  const consultor = await env.DB.prepare(`
    SELECT id FROM consultores
    WHERE ativo=1 AND UPPER(TRIM(nome))=UPPER(?)
    ORDER BY CASE WHEN origem='PAINEL_EQUIPE' THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(acesso.nome).first()

  const agora = new Date().toISOString()
  await env.DB.prepare(`
    INSERT INTO colaboradores_acesso(id,login,email,nome,consultor_id,ativo,atualizado_em)
    VALUES(?,?,?,?,?,1,?)
    ON CONFLICT(login) DO UPDATE SET
      email=excluded.email,
      nome=excluded.nome,
      consultor_id=COALESCE(excluded.consultor_id,colaboradores_acesso.consultor_id),
      ativo=1,
      atualizado_em=excluded.atualizado_em
  `).bind(`ac-${login}`, login, acesso.email, acesso.nome, consultor?.id || null, agora).run()

  return {
    login,
    email: acesso.email,
    nome: acesso.nome,
    consultor_id: consultor?.id || null,
  }
}

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
    if (!ACESSOS[login]) {
      return json({ erro: 'Este código não está autorizado para acessar o Painel da Equipe Norte.' }, 401)
    }

    let usuario = await env.DB.prepare(`
      SELECT login,email,nome,consultor_id
      FROM colaboradores_acesso
      WHERE ativo=1 AND (LOWER(login)=? OR LOWER(email)=? OR LOWER(email)=?)
      LIMIT 1
    `).bind(login, informado, `${login}@ems.com.br`).first()

    const acessoEsperado = ACESSOS[login]
    if (!usuario || usuario.nome !== acessoEsperado.nome || usuario.email !== acessoEsperado.email) {
      usuario = await garantirCadastro(env, login)
    }

    const agora = new Date().toISOString()
    await env.DB.prepare('UPDATE colaboradores_acesso SET ultimo_acesso_em=?,atualizado_em=? WHERE login=?')
      .bind(agora, agora, login).run()

    const token = await createSessionToken(usuario, env.PAINEL_ADMIN_KEY)
    return json({
      usuario: {
        login: usuario.login,
        email: usuario.email || '',
        nome: usuario.nome,
        consultor_id: usuario.consultor_id || '',
      },
    }, 200, { 'set-cookie': sessionCookie(token) })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table')) {
      return json({ erro: 'A atualização de acessos ainda não foi aplicada no banco.' }, 503)
    }
    return json({ erro: 'Não foi possível entrar no painel.', detalhe }, 500)
  }
}
