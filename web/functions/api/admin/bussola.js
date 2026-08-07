import { authorized, encryptCredentials, json, maskUsername } from '../../_lib/credentials.js'

const INTEGRATION = 'BUSSOLA'

function secretReady(env) {
  return typeof env.PAINEL_ADMIN_KEY === 'string' && env.PAINEL_ADMIN_KEY.length >= 12
}

async function requireAdmin(request, env) {
  if (!secretReady(env)) {
    return json({ erro: 'A chave administrativa ainda não foi configurada.', codigo: 'ADMIN_KEY_NOT_CONFIGURED' }, 503)
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Chave administrativa inválida.' }, 401)
  }
  return null
}

async function getStatus(env) {
  return env.DB.prepare(
    `SELECT usuario_mascarado, status, mensagem_status, testado_em, atualizado_em
       FROM integracao_credenciais WHERE integracao = ?`,
  ).bind(INTEGRATION).first()
}

export async function onRequestGet({ request, env }) {
  const denial = await requireAdmin(request, env)
  if (denial) return denial
  const current = await getStatus(env)
  return json({
    configurada: Boolean(current),
    usuario_mascarado: current?.usuario_mascarado || '',
    status: current?.status || 'nao_configurada',
    mensagem: current?.mensagem_status || 'Credencial da GD ainda não cadastrada.',
    testado_em: current?.testado_em || null,
    atualizado_em: current?.atualizado_em || null,
  })
}

export async function onRequestPost({ request, env }) {
  const denial = await requireAdmin(request, env)
  if (denial) return denial
  let body
  try {
    body = await request.json()
  } catch {
    return json({ erro: 'Envie os dados em formato JSON.' }, 400)
  }
  const usuario = String(body?.usuario || '').trim()
  const segredo = String(body?.segredo || '')
  if (usuario.length < 3 || usuario.length > 180) return json({ erro: 'Informe um usuário válido.' }, 400)
  if (segredo.length < 4 || segredo.length > 300) return json({ erro: 'Informe uma credencial válida.' }, 400)

  const encrypted = await encryptCredentials(
    { usuario, segredo, salvo_em: new Date().toISOString() },
    env.PAINEL_ADMIN_KEY,
  )
  const now = new Date().toISOString()
  const masked = maskUsername(usuario)

  await env.DB.prepare(
    `INSERT INTO integracao_credenciais
      (integracao, usuario_mascarado, credencial_cifrada, status, mensagem_status, testado_em, atualizado_em)
     VALUES (?, ?, ?, 'configurada', ?, NULL, ?)
     ON CONFLICT(integracao) DO UPDATE SET
       usuario_mascarado = excluded.usuario_mascarado,
       credencial_cifrada = excluded.credencial_cifrada,
       status = 'configurada',
       mensagem_status = excluded.mensagem_status,
       testado_em = NULL,
       atualizado_em = excluded.atualizado_em`,
  ).bind(
    INTEGRATION,
    masked,
    encrypted,
    'Credencial da GD salva com criptografia. Valide a configuração antes da próxima extração.',
    now,
  ).run()

  return json({
    sucesso: true,
    configurada: true,
    usuario_mascarado: masked,
    status: 'configurada',
    mensagem: 'Credencial da GD salva com segurança.',
    atualizado_em: now,
  })
}

export async function onRequestDelete({ request, env }) {
  const denial = await requireAdmin(request, env)
  if (denial) return denial
  await env.DB.prepare('DELETE FROM integracao_credenciais WHERE integracao = ?').bind(INTEGRATION).run()
  return json({ sucesso: true, mensagem: 'Credencial da GD removida.' })
}
