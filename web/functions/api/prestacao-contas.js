import { authorized, json, readSession } from '../_lib/credentials.js'

const texto = (value, limit = 500) => String(value ?? '').trim().slice(0, limit)

async function usuarioAtual(request, env) {
  const sessao = await readSession(request, env.PAINEL_ADMIN_KEY)
  return texto(sessao?.login || 'admin', 180).toLowerCase()
}

async function exigirAcesso(request, env) {
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Sessão inválida. Entre novamente no painel.' }, 401)
  }
  return null
}

async function garantirTabelas(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS prestacao_relatorios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      categoria TEXT NOT NULL,
      usuario_login TEXT NOT NULL DEFAULT '',
      criado_por TEXT NOT NULL DEFAULT '',
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    )
  `).run()

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS prestacao_despesas (
      id TEXT PRIMARY KEY,
      relatorio_id TEXT NOT NULL,
      estabelecimento TEXT NOT NULL,
      valor_centavos INTEGER NOT NULL DEFAULT 0,
      tipo_despesa TEXT NOT NULL,
      data_despesa TEXT NOT NULL,
      comprovante_nome TEXT NOT NULL,
      comprovante_tipo TEXT NOT NULL,
      comprovante_tamanho INTEGER NOT NULL DEFAULT 0,
      comprovante_blob BLOB NOT NULL,
      criado_em TEXT NOT NULL,
      FOREIGN KEY (relatorio_id) REFERENCES prestacao_relatorios(id)
    )
  `).run()

  const colunas = await env.DB.prepare('PRAGMA table_info(prestacao_relatorios)').all()
  if (!(colunas.results || []).some(item => item.name === 'usuario_login')) {
    await env.DB.prepare("ALTER TABLE prestacao_relatorios ADD COLUMN usuario_login TEXT NOT NULL DEFAULT ''").run()
  }

  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_prestacao_relatorios_categoria ON prestacao_relatorios(categoria)').run()
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_prestacao_relatorios_usuario ON prestacao_relatorios(usuario_login)').run()
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_prestacao_despesas_relatorio ON prestacao_despesas(relatorio_id)').run()
}

function nomeArquivoSeguro(value) {
  const base = texto(value || 'comprovante.jpg', 180)
    .replace(/[\\/:*?"<>|\r\n]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return base || 'comprovante.jpg'
}

function dataValida(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

async function carregarRelatorios(env, usuarioLogin) {
  const result = await env.DB.prepare(`
    SELECT
      r.id,
      r.nome,
      r.categoria,
      r.criado_por,
      r.criado_em,
      r.atualizado_em,
      COUNT(d.id) AS quantidade_despesas,
      COALESCE(SUM(d.valor_centavos), 0) AS total_centavos
    FROM prestacao_relatorios r
    LEFT JOIN prestacao_despesas d ON d.relatorio_id = r.id
    WHERE r.usuario_login = ?
    GROUP BY r.id, r.nome, r.categoria, r.criado_por, r.criado_em, r.atualizado_em
    ORDER BY datetime(r.atualizado_em) DESC, r.nome COLLATE NOCASE
  `).bind(usuarioLogin).all()

  return (result.results || []).map(item => ({
    ...item,
    quantidade_despesas: Number(item.quantidade_despesas || 0),
    total_centavos: Number(item.total_centavos || 0),
  }))
}

export async function onRequestGet({ request, env }) {
  const negado = await exigirAcesso(request, env)
  if (negado) return negado

  try {
    await garantirTabelas(env)
    const url = new URL(request.url)
    const usuarioLogin = await usuarioAtual(request, env)
    const comprovanteId = texto(url.searchParams.get('comprovante'), 160)

    if (comprovanteId) {
      const item = await env.DB.prepare(`
        SELECT d.comprovante_nome, d.comprovante_tipo, d.comprovante_blob
        FROM prestacao_despesas d
        INNER JOIN prestacao_relatorios r ON r.id = d.relatorio_id
        WHERE d.id = ? AND r.usuario_login = ?
        LIMIT 1
      `).bind(comprovanteId, usuarioLogin).first()

      if (!item) return json({ erro: 'Comprovante não encontrado.' }, 404)

      const nome = nomeArquivoSeguro(item.comprovante_nome)
      const bytes = new Uint8Array(Array.isArray(item.comprovante_blob) ? item.comprovante_blob : [])
      const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'

      return new Response(bytes, {
        status: 200,
        headers: {
          'content-type': texto(item.comprovante_tipo || 'image/jpeg', 100),
          'content-disposition': disposition + '; filename="' + nome.replace(/"/g, '') + '"',
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      })
    }

    const relatorioId = texto(url.searchParams.get('relatorio'), 160)
    const relatorios = await carregarRelatorios(env, usuarioLogin)
    let despesas = []

    if (relatorioId) {
      const result = await env.DB.prepare(`
        SELECT
          id,
          relatorio_id,
          estabelecimento,
          valor_centavos,
          tipo_despesa,
          data_despesa,
          comprovante_nome,
          comprovante_tipo,
          comprovante_tamanho,
          criado_em
        FROM prestacao_despesas d
        INNER JOIN prestacao_relatorios r ON r.id = d.relatorio_id
        WHERE d.relatorio_id = ? AND r.usuario_login = ?
        ORDER BY date(d.data_despesa) DESC, datetime(d.criado_em) DESC
      `).bind(relatorioId, usuarioLogin).all()

      despesas = (result.results || []).map(item => ({
        ...item,
        valor_centavos: Number(item.valor_centavos || 0),
        comprovante_tamanho: Number(item.comprovante_tamanho || 0),
      }))
    }

    return json({ relatorios, despesas })
  } catch (error) {
    return json({
      erro: 'Não foi possível carregar a prestação de contas.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

async function salvarDespesa(request, env, form) {
  const usuarioLogin = await usuarioAtual(request, env)
  const relatorioId = texto(form.get('relatorio_id'), 160)
  const estabelecimento = texto(form.get('estabelecimento'), 180)
  const tipoDespesa = texto(form.get('tipo_despesa'), 100)
  const dataDespesa = texto(form.get('data_despesa'), 20)
  const valor = Number(texto(form.get('valor'), 40).replace(',', '.'))
  const comprovante = form.get('comprovante')

  if (!relatorioId) return json({ erro: 'Relatório não informado.' }, 400)
  if (!estabelecimento) return json({ erro: 'Informe o nome do estabelecimento.' }, 400)
  if (!tipoDespesa) return json({ erro: 'Informe o tipo de despesa.' }, 400)
  if (!dataValida(dataDespesa)) return json({ erro: 'Informe a data da despesa.' }, 400)
  if (!Number.isFinite(valor) || valor <= 0) return json({ erro: 'Informe um valor válido para a despesa.' }, 400)
  if (!comprovante || typeof comprovante.arrayBuffer !== 'function') {
    return json({ erro: 'Inclua a foto do comprovante.' }, 400)
  }

  const relatorio = await env.DB.prepare('SELECT id FROM prestacao_relatorios WHERE id = ? AND usuario_login = ? LIMIT 1').bind(relatorioId, usuarioLogin).first()
  if (!relatorio) return json({ erro: 'Relatório não encontrado.' }, 404)

  const tipoArquivo = texto(comprovante.type || '', 100).toLowerCase()
  if (!tipoArquivo.startsWith('image/')) {
    return json({ erro: 'O comprovante precisa ser enviado como foto.' }, 400)
  }

  const buffer = await comprovante.arrayBuffer()
  if (!buffer.byteLength) return json({ erro: 'A foto do comprovante está vazia.' }, 400)
  if (buffer.byteLength > 1_600_000) {
    return json({ erro: 'A foto ficou grande demais. O limite após otimização é de aproximadamente 1,6 MB.' }, 413)
  }

  const id = 'desp-' + crypto.randomUUID()
  const agora = new Date().toISOString()
  const valorCentavos = Math.round(valor * 100)
  const nome = nomeArquivoSeguro(comprovante.name)

  await env.DB.prepare(`
    INSERT INTO prestacao_despesas (
      id, relatorio_id, estabelecimento, valor_centavos, tipo_despesa, data_despesa,
      comprovante_nome, comprovante_tipo, comprovante_tamanho, comprovante_blob, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    relatorioId,
    estabelecimento,
    valorCentavos,
    tipoDespesa,
    dataDespesa,
    nome,
    tipoArquivo || 'image/jpeg',
    buffer.byteLength,
    buffer,
    agora,
  ).run()

  await env.DB.prepare('UPDATE prestacao_relatorios SET atualizado_em = ? WHERE id = ?')
    .bind(agora, relatorioId)
    .run()

  return json({ sucesso: true, id })
}

export async function onRequestPost({ request, env }) {
  const negado = await exigirAcesso(request, env)
  if (negado) return negado

  try {
    await garantirTabelas(env)
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const operacao = texto(form.get('operacao') || 'salvar-despesa', 40).toLowerCase()
      if (operacao !== 'salvar-despesa') return json({ erro: 'Operação inválida.' }, 400)
      return await salvarDespesa(request, env, form)
    }

    const body = await request.json()
    const operacao = texto(body.operacao, 40).toLowerCase()

    if (operacao === 'criar-relatorio') {
      const nome = texto(body.nome, 120)
      const categoria = texto(body.categoria, 20).toUpperCase()
      if (!nome) return json({ erro: 'Informe o nome do relatório.' }, 400)
      if (!['RDV', 'TRADE'].includes(categoria)) return json({ erro: 'Selecione RDV ou TRADE.' }, 400)

      const agora = new Date().toISOString()
      const sessao = await readSession(request, env.PAINEL_ADMIN_KEY)
      const criadoPor = texto(sessao?.nome || sessao?.login || 'Painel', 180)
      const usuarioLogin = await usuarioAtual(request, env)
      const id = 'rel-' + crypto.randomUUID()

      await env.DB.prepare(`
        INSERT INTO prestacao_relatorios(id, nome, categoria, usuario_login, criado_por, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, nome, categoria, usuarioLogin, criadoPor, agora, agora).run()

      return json({ sucesso: true, id })
    }

    if (operacao === 'excluir-despesa') {
      const id = texto(body.id, 160)
      if (!id) return json({ erro: 'Despesa não informada.' }, 400)

      const usuarioLogin = await usuarioAtual(request, env)
      const despesa = await env.DB.prepare(`
        SELECT d.id, d.relatorio_id
        FROM prestacao_despesas d
        INNER JOIN prestacao_relatorios r ON r.id = d.relatorio_id
        WHERE d.id = ? AND r.usuario_login = ?
        LIMIT 1
      `).bind(id, usuarioLogin).first()
      if (!despesa) return json({ erro: 'Despesa não encontrada.' }, 404)

      await env.DB.prepare('DELETE FROM prestacao_despesas WHERE id = ?').bind(id).run()
      await env.DB.prepare('UPDATE prestacao_relatorios SET atualizado_em = ? WHERE id = ?')
        .bind(new Date().toISOString(), despesa.relatorio_id)
        .run()

      return json({ sucesso: true, id })
    }

    if (operacao === 'excluir-relatorio') {
      const id = texto(body.id, 160)
      if (!id) return json({ erro: 'Relatório não informado.' }, 400)

      const usuarioLogin = await usuarioAtual(request, env)
      const relatorio = await env.DB.prepare('SELECT id FROM prestacao_relatorios WHERE id = ? AND usuario_login = ? LIMIT 1').bind(id, usuarioLogin).first()
      if (!relatorio) return json({ erro: 'Relatório não encontrado.' }, 404)

      await env.DB.prepare('DELETE FROM prestacao_despesas WHERE relatorio_id = ?').bind(id).run()
      await env.DB.prepare('DELETE FROM prestacao_relatorios WHERE id = ?').bind(id).run()
      return json({ sucesso: true, id })
    }

    return json({ erro: 'Operação inválida.' }, 400)
  } catch (error) {
    return json({
      erro: 'Não foi possível salvar a prestação de contas.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
