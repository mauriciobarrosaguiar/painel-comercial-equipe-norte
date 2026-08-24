import { authorized, json, readSession } from '../_lib/credentials.js'

const texto = (value, limit = 500) => String(value ?? '').trim().slice(0, limit)
const digitos = value => texto(value, 80).replace(/\D/g, '')

async function garantirTabela(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS cnpj_anotacoes (
      id TEXT PRIMARY KEY,
      consultor_id TEXT NOT NULL,
      cnpj TEXT NOT NULL UNIQUE,
      razao_social TEXT NOT NULL DEFAULT '',
      nome_contato TEXT NOT NULL DEFAULT '',
      telefone TEXT NOT NULL DEFAULT '',
      observacao TEXT NOT NULL DEFAULT '',
      acao_painel TEXT NOT NULL DEFAULT 'INCLUIR',
      criado_por TEXT NOT NULL DEFAULT '',
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    )
  `).run()
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_cnpj_anotacoes_consultor ON cnpj_anotacoes(consultor_id)').run()
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_cnpj_anotacoes_acao ON cnpj_anotacoes(acao_painel)').run()
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
    const [anotacoes, consultores] = await env.DB.batch([
      env.DB.prepare(`
        SELECT
          a.id,
          a.consultor_id,
          COALESCE(c.nome, 'Consultor não encontrado') AS consultor,
          a.cnpj,
          a.razao_social,
          a.nome_contato,
          a.telefone,
          a.observacao,
          a.acao_painel,
          a.criado_por,
          a.criado_em,
          a.atualizado_em
        FROM cnpj_anotacoes a
        LEFT JOIN consultores c ON c.id = a.consultor_id
        ORDER BY datetime(a.atualizado_em) DESC, a.razao_social COLLATE NOCASE
      `),
      env.DB.prepare(`
        SELECT id, nome
        FROM consultores
        WHERE ativo = 1 AND origem = 'PAINEL_EQUIPE'
        ORDER BY nome COLLATE NOCASE
      `),
    ])

    const lista = anotacoes.results || []
    return json({
      anotacoes: lista,
      filtros: { consultores: consultores.results || [] },
      resumo: {
        total: lista.length,
        incluir: lista.filter(item => item.acao_painel === 'INCLUIR').length,
        excluir: lista.filter(item => item.acao_painel === 'EXCLUIR').length,
      },
    })
  } catch (error) {
    return json({ erro: 'Não foi possível carregar as anotações de CNPJ.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
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
      if (!id) return json({ erro: 'Registro não informado.' }, 400)
      const result = await env.DB.prepare('DELETE FROM cnpj_anotacoes WHERE id = ?').bind(id).run()
      if (!result.meta?.changes) return json({ erro: 'Anotação não encontrada.' }, 404)
      return json({ sucesso: true, id })
    }

    const idInformado = texto(body.id, 120)
    const consultorId = texto(body.consultor_id, 180)
    const cnpj = digitos(body.cnpj)
    const razaoSocial = texto(body.razao_social, 240)
    const nomeContato = texto(body.nome_contato, 180)
    const telefone = texto(body.telefone, 60)
    const observacao = texto(body.observacao, 2000)
    const acaoPainel = texto(body.acao_painel || 'INCLUIR', 20).toUpperCase()

    if (!consultorId) return json({ erro: 'Selecione o consultor.' }, 400)
    if (cnpj.length !== 14) return json({ erro: 'Informe um CNPJ válido com 14 dígitos.' }, 400)
    if (!razaoSocial) return json({ erro: 'Informe a razão social.' }, 400)
    if (!['INCLUIR', 'EXCLUIR'].includes(acaoPainel)) return json({ erro: 'Selecione se o CNPJ deve ser incluído ou excluído do Painel.' }, 400)

    const consultor = await env.DB.prepare(`
      SELECT id, nome FROM consultores
      WHERE id = ? AND ativo = 1 AND origem = 'PAINEL_EQUIPE'
      LIMIT 1
    `).bind(consultorId).first()
    if (!consultor) return json({ erro: 'Selecione um consultor válido do Painel.' }, 400)

    const duplicado = await env.DB.prepare('SELECT id FROM cnpj_anotacoes WHERE cnpj = ? LIMIT 1').bind(cnpj).first()
    if (duplicado && duplicado.id !== idInformado) {
      return json({ erro: 'Este CNPJ já está anotado. Use Editar no registro existente.' }, 409)
    }

    const agora = new Date().toISOString()
    const sessao = await readSession(request, env.PAINEL_ADMIN_KEY)
    const criadoPor = texto(sessao?.nome || sessao?.login || 'Painel', 180)

    if (idInformado) {
      const result = await env.DB.prepare(`
        UPDATE cnpj_anotacoes
        SET consultor_id = ?, cnpj = ?, razao_social = ?, nome_contato = ?, telefone = ?,
            observacao = ?, acao_painel = ?, atualizado_em = ?
        WHERE id = ?
      `).bind(consultorId, cnpj, razaoSocial, nomeContato, telefone, observacao, acaoPainel, agora, idInformado).run()
      if (!result.meta?.changes) return json({ erro: 'Anotação não encontrada para atualização.' }, 404)
      return json({ sucesso: true, id: idInformado, atualizado: true })
    }

    const id = `cnpj-${crypto.randomUUID()}`
    await env.DB.prepare(`
      INSERT INTO cnpj_anotacoes(
        id, consultor_id, cnpj, razao_social, nome_contato, telefone,
        observacao, acao_painel, criado_por, criado_em, atualizado_em
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).bind(id, consultorId, cnpj, razaoSocial, nomeContato, telefone, observacao, acaoPainel, criadoPor, agora, agora).run()

    return json({ sucesso: true, id, criado: true })
  } catch (error) {
    return json({ erro: 'Não foi possível salvar a anotação de CNPJ.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
