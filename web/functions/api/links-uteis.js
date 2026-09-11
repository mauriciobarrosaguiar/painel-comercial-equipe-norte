import { authorized, json, readSession } from '../_lib/credentials.js'

const texto = (value, limit = 500) => String(value ?? '').trim().slice(0, limit)

function normalizarUrl(value) {
  const raw = texto(value, 1200)
  if (!raw) return ''
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  const parsed = new URL(candidate)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use um link começando com http:// ou https://.')
  return parsed.toString()
}

async function garantirTabela(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS links_uteis (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL COLLATE NOCASE UNIQUE,
      url TEXT NOT NULL,
      criado_por TEXT NOT NULL DEFAULT '',
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    )
  `).run()
}

async function exigirAcesso(request, env) {
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Sessão inválida. Entre novamente no painel.' }, 401)
  }
  return null
}

export async function onRequestGet({ request, env }) {
  const negado = await exigirAcesso(request, env)
  if (negado) return negado

  try {
    await garantirTabela(env)
    const result = await env.DB.prepare(`
      SELECT id, nome, url, criado_por, criado_em, atualizado_em
      FROM links_uteis
      ORDER BY nome COLLATE NOCASE
    `).all()
    return json({ links: result.results || [] })
  } catch (error) {
    return json({ erro: 'Não foi possível carregar os links úteis.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  const negado = await exigirAcesso(request, env)
  if (negado) return negado

  try {
    await garantirTabela(env)
    const body = await request.json()
    const operacao = texto(body.operacao || 'salvar', 30).toLowerCase()

    if (operacao === 'excluir') {
      const id = texto(body.id, 120)
      if (!id) return json({ erro: 'Link não informado.' }, 400)
      const result = await env.DB.prepare('DELETE FROM links_uteis WHERE id = ?').bind(id).run()
      if (!result.meta?.changes) return json({ erro: 'Link não encontrado.' }, 404)
      return json({ sucesso: true, id })
    }

    const idInformado = texto(body.id, 120)
    const nome = texto(body.nome, 120)
    let url = ''
    try {
      url = normalizarUrl(body.url)
    } catch (error) {
      return json({ erro: error instanceof Error ? error.message : 'Informe um link válido.' }, 400)
    }

    if (!nome) return json({ erro: 'Informe o nome do link.' }, 400)
    if (!url) return json({ erro: 'Informe o endereço do link.' }, 400)

    const duplicado = await env.DB.prepare('SELECT id FROM links_uteis WHERE nome = ? COLLATE NOCASE LIMIT 1').bind(nome).first()
    if (duplicado && duplicado.id !== idInformado) {
      return json({ erro: 'Já existe um link com este nome. Edite o existente ou use outro nome.' }, 409)
    }

    const agora = new Date().toISOString()
    const sessao = await readSession(request, env.PAINEL_ADMIN_KEY)
    const criadoPor = texto(sessao?.nome || sessao?.login || 'Painel', 180)

    if (idInformado) {
      const result = await env.DB.prepare(`
        UPDATE links_uteis
        SET nome = ?, url = ?, atualizado_em = ?
        WHERE id = ?
      `).bind(nome, url, agora, idInformado).run()
      if (!result.meta?.changes) return json({ erro: 'Link não encontrado para atualização.' }, 404)
      return json({ sucesso: true, id: idInformado, atualizado: true })
    }

    const id = `link-${crypto.randomUUID()}`
    await env.DB.prepare(`
      INSERT INTO links_uteis(id, nome, url, criado_por, criado_em, atualizado_em)
      VALUES(?,?,?,?,?,?)
    `).bind(id, nome, url, criadoPor, agora, agora).run()

    return json({ sucesso: true, id, criado: true })
  } catch (error) {
    return json({ erro: 'Não foi possível salvar o link útil.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
