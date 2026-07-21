import { createSessionToken, json, sessionCookie } from '../../_lib/credentials.js'

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

    let usuario = await env.DB.prepare(`
      SELECT login,email,nome,consultor_id
      FROM colaboradores_acesso
      WHERE ativo=1 AND (LOWER(login)=? OR LOWER(email)=? OR LOWER(email)=?)
      LIMIT 1
    `).bind(login, informado, `${login}@ems.com.br`).first()

    if (!usuario) {
      const encontrado = await env.DB.prepare(`
        SELECT co.id consultor_id,co.nome,
          LOWER(TRIM(MIN(CASE WHEN TRIM(COALESCE(cl.setor_rep,''))<>'' THEN cl.setor_rep END))) acesso
        FROM consultores co
        JOIN clientes cl ON cl.consultor_id=co.id AND cl.carteira_importada=1 AND cl.ativo=1
        WHERE co.ativo=1 AND co.origem='PAINEL_EQUIPE'
        GROUP BY co.id,co.nome
        HAVING LOWER(TRIM(MIN(CASE WHEN TRIM(COALESCE(cl.setor_rep,''))<>'' THEN cl.setor_rep END))) IN (?,?,?)
        LIMIT 1
      `).bind(login, informado, `${login}@ems.com.br`).first()
      if (encontrado) {
        const acesso = texto(encontrado.acesso)
        const loginBase = local(acesso)
        const email = acesso.includes('@') ? acesso : `${loginBase}@ems.com.br`
        const id = `ac-${encontrado.consultor_id}`
        await env.DB.prepare(`
          INSERT INTO colaboradores_acesso(id,login,email,nome,consultor_id,ativo,atualizado_em)
          VALUES(?,?,?,?,?,1,?)
          ON CONFLICT(login) DO UPDATE SET email=excluded.email,nome=excluded.nome,
            consultor_id=excluded.consultor_id,ativo=1,atualizado_em=excluded.atualizado_em
        `).bind(id, loginBase, email, encontrado.nome, encontrado.consultor_id, new Date().toISOString()).run()
        usuario = { login: loginBase, email, nome: encontrado.nome, consultor_id: encontrado.consultor_id }
      }
    }

    if (!usuario) return json({ erro: 'Acesso não localizado na base da equipe. Confira seu setor ou e-mail EMS.' }, 401)

    const agora = new Date().toISOString()
    await env.DB.prepare('UPDATE colaboradores_acesso SET ultimo_acesso_em=?,atualizado_em=? WHERE login=?')
      .bind(agora, agora, usuario.login).run()
    const token = await createSessionToken(usuario, env.PAINEL_ADMIN_KEY)
    return json({ usuario: { login: usuario.login, email: usuario.email || '', nome: usuario.nome, consultor_id: usuario.consultor_id || '' } }, 200, {
      'set-cookie': sessionCookie(token),
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table')) return json({ erro: 'A atualização de acessos ainda não foi aplicada no banco.' }, 503)
    return json({ erro: 'Não foi possível entrar no painel.', detalhe }, 500)
  }
}
