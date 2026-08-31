import { authorized, json, readSession } from '../_lib/credentials.js'

const texto = (value, limit = 500) => String(value ?? '').trim().slice(0, limit)
const loginLocal = value => texto(value, 180).toLowerCase().split('@')[0]

async function exigirAcesso(request, env) {
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Sessão inválida. Entre novamente no painel.' }, 401)
  }
  return null
}

async function usuarioAtual(request, env) {
  const sessao = await readSession(request, env.PAINEL_ADMIN_KEY)
  return {
    login: loginLocal(sessao?.login || ''),
    nome: texto(sessao?.nome || sessao?.login || 'Painel', 180),
    consultor_id: texto(sessao?.consultor_id || '', 180),
  }
}

async function validarConsultor(env, informado) {
  const original = texto(informado, 180).toLowerCase()
  const login = loginLocal(original)
  if (!login) return { erro: 'Informe o login do consultor.' }
  if (original.includes('@') && original !== `${login}@ems.com.br`) {
    return { erro: 'Use o mesmo login do Painel ou o e-mail corporativo @ems.com.br.' }
  }

  const consultor = await env.DB.prepare(`
    SELECT login, email, nome, consultor_id
    FROM colaboradores_acesso
    WHERE ativo = 1 AND LOWER(login) = ?
    LIMIT 1
  `).bind(login).first()

  if (!consultor) {
    return { erro: 'Este login não está autorizado para acessar o Painel da Equipe Norte.' }
  }

  return {
    consultor: {
      login: texto(consultor.login, 180).toLowerCase(),
      email: texto(consultor.email, 180),
      nome: texto(consultor.nome, 180),
      consultor_id: texto(consultor.consultor_id, 180),
    },
  }
}

async function garantirTabelas(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS prestacao_relatorios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      categoria TEXT NOT NULL,
      usuario_login TEXT NOT NULL DEFAULT '',
      consultor_login TEXT NOT NULL DEFAULT '',
      consultor_id TEXT NOT NULL DEFAULT '',
      consultor_nome TEXT NOT NULL DEFAULT '',
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
  const nomes = new Set((colunas.results || []).map(item => item.name))

  if (!nomes.has('usuario_login')) {
    await env.DB.prepare("ALTER TABLE prestacao_relatorios ADD COLUMN usuario_login TEXT NOT NULL DEFAULT ''").run()
  }
  if (!nomes.has('consultor_login')) {
    await env.DB.prepare("ALTER TABLE prestacao_relatorios ADD COLUMN consultor_login TEXT NOT NULL DEFAULT ''").run()
  }
  if (!nomes.has('consultor_id')) {
    await env.DB.prepare("ALTER TABLE prestacao_relatorios ADD COLUMN consultor_id TEXT NOT NULL DEFAULT ''").run()
  }
  if (!nomes.has('consultor_nome')) {
    await env.DB.prepare("ALTER TABLE prestacao_relatorios ADD COLUMN consultor_nome TEXT NOT NULL DEFAULT ''").run()
  }

  await env.DB.prepare(`
    UPDATE prestacao_relatorios
    SET consultor_login = LOWER(TRIM(usuario_login))
    WHERE TRIM(COALESCE(consultor_login, '')) = ''
      AND TRIM(COALESCE(usuario_login, '')) <> ''
  `).run()

  await env.DB.prepare(`
    UPDATE prestacao_relatorios
    SET consultor_id = COALESCE((
      SELECT ca.consultor_id
      FROM colaboradores_acesso ca
      WHERE LOWER(ca.login) = LOWER(prestacao_relatorios.consultor_login)
      LIMIT 1
    ), '')
    WHERE TRIM(COALESCE(consultor_id, '')) = ''
  `).run()

  await env.DB.prepare(`
    UPDATE prestacao_relatorios
    SET consultor_nome = COALESCE((
      SELECT ca.nome
      FROM colaboradores_acesso ca
      WHERE LOWER(ca.login) = LOWER(prestacao_relatorios.consultor_login)
      LIMIT 1
    ), criado_por, consultor_login)
    WHERE TRIM(COALESCE(consultor_nome, '')) = ''
  `).run()

  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_prestacao_relatorios_categoria ON prestacao_relatorios(categoria)').run()
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_prestacao_relatorios_usuario ON prestacao_relatorios(usuario_login)').run()
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_prestacao_relatorios_consultor ON prestacao_relatorios(consultor_login)').run()
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

async function carregarRelatorios(env, consultorLogin) {
  const result = await env.DB.prepare(`
    SELECT
      r.id,
      r.nome,
      r.categoria,
      r.consultor_login,
      r.consultor_id,
      r.consultor_nome,
      r.criado_por,
      r.criado_em,
      r.atualizado_em,
      COUNT(d.id) AS quantidade_despesas,
      COALESCE(SUM(d.valor_centavos), 0) AS total_centavos
    FROM prestacao_relatorios r
    LEFT JOIN prestacao_despesas d ON d.relatorio_id = r.id
    WHERE LOWER(r.consultor_login) = ?
    GROUP BY
      r.id, r.nome, r.categoria, r.consultor_login, r.consultor_id, r.consultor_nome,
      r.criado_por, r.criado_em, r.atualizado_em
    ORDER BY datetime(r.atualizado_em) DESC, r.nome COLLATE NOCASE
  `).bind(consultorLogin).all()

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
    const acesso = await validarConsultor(env, url.searchParams.get('consultor'))
    if (acesso.erro) return json({ erro: acesso.erro }, 401)
    const consultor = acesso.consultor
    const comprovanteId = texto(url.searchParams.get('comprovante'), 160)

    if (comprovanteId) {
      const item = await env.DB.prepare(`
        SELECT d.comprovante_nome, d.comprovante_tipo, d.comprovante_blob
        FROM prestacao_despesas d
        INNER JOIN prestacao_relatorios r ON r.id = d.relatorio_id
        WHERE d.id = ? AND LOWER(r.consultor_login) = ?
        LIMIT 1
      `).bind(comprovanteId, consultor.login).first()

      if (!item) return json({ erro: 'Comprovante não encontrado.' }, 404)

      const nome = nomeArquivoSeguro(item.comprovante_nome)
      const nomeCabecalho = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '-')
      const blob = item.comprovante_blob
      const bytes = blob instanceof ArrayBuffer
        ? new Uint8Array(blob)
        : ArrayBuffer.isView(blob)
          ? new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength)
          : new Uint8Array(Array.isArray(blob) ? blob : [])
      const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'

      return new Response(bytes, {
        status: 200,
        headers: {
          'content-type': texto(item.comprovante_tipo || 'image/jpeg', 100),
          'content-disposition': disposition + '; filename="' + nomeCabecalho.replace(/"/g, '') + '"',
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      })
    }

    const relatorioId = texto(url.searchParams.get('relatorio'), 160)
    const relatorios = await carregarRelatorios(env, consultor.login)
    let despesas = []

    if (relatorioId) {
      const result = await env.DB.prepare(`
        SELECT
          d.id AS id,
          d.relatorio_id AS relatorio_id,
          d.estabelecimento AS estabelecimento,
          d.valor_centavos AS valor_centavos,
          d.tipo_despesa AS tipo_despesa,
          d.data_despesa AS data_despesa,
          d.comprovante_nome AS comprovante_nome,
          d.comprovante_tipo AS comprovante_tipo,
          d.comprovante_tamanho AS comprovante_tamanho,
          d.criado_em AS criado_em
        FROM prestacao_despesas d
        INNER JOIN prestacao_relatorios r ON r.id = d.relatorio_id
        WHERE d.relatorio_id = ? AND LOWER(r.consultor_login) = ?
        ORDER BY date(d.data_despesa) DESC, datetime(d.criado_em) DESC
      `).bind(relatorioId, consultor.login).all()

      despesas = (result.results || []).map(item => ({
        ...item,
        valor_centavos: Number(item.valor_centavos || 0),
        comprovante_tamanho: Number(item.comprovante_tamanho || 0),
      }))
    }

    return json({ consultor, relatorios, despesas })
  } catch (error) {
    return json({
      erro: 'Não foi possível carregar a prestação de contas.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

async function salvarDespesa(request, env, form) {
  const acesso = await validarConsultor(env, form.get('consultor_login'))
  if (acesso.erro) return json({ erro: acesso.erro }, 401)
  const consultor = acesso.consultor

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

  const relatorio = await env.DB.prepare(`
    SELECT id
    FROM prestacao_relatorios
    WHERE id = ? AND LOWER(consultor_login) = ?
    LIMIT 1
  `).bind(relatorioId, consultor.login).first()
  if (!relatorio) return json({ erro: 'Relatório não encontrado para este consultor.' }, 404)

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

    if (operacao === 'acessar-consultor') {
      const acesso = await validarConsultor(env, body.login)
      if (acesso.erro) return json({ erro: acesso.erro }, 401)
      return json({ sucesso: true, consultor: acesso.consultor })
    }

    const acesso = await validarConsultor(env, body.consultor_login)
    if (acesso.erro) return json({ erro: acesso.erro }, 401)
    const consultor = acesso.consultor

    if (operacao === 'criar-relatorio') {
      const nome = texto(body.nome, 120)
      const categoria = texto(body.categoria, 20).toUpperCase()
      if (!nome) return json({ erro: 'Informe o nome do relatório.' }, 400)
      if (!['RDV', 'TRADE'].includes(categoria)) return json({ erro: 'Selecione RDV ou TRADE.' }, 400)

      const agora = new Date().toISOString()
      const usuario = await usuarioAtual(request, env)
      const id = 'rel-' + crypto.randomUUID()

      await env.DB.prepare(`
        INSERT INTO prestacao_relatorios(
          id, nome, categoria, usuario_login, consultor_login, consultor_id, consultor_nome,
          criado_por, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        nome,
        categoria,
        usuario.login,
        consultor.login,
        consultor.consultor_id,
        consultor.nome,
        usuario.nome,
        agora,
        agora,
      ).run()

      return json({ sucesso: true, id, consultor })
    }

    if (operacao === 'excluir-despesa') {
      const id = texto(body.id, 160)
      if (!id) return json({ erro: 'Despesa não informada.' }, 400)

      const despesa = await env.DB.prepare(`
        SELECT d.id, d.relatorio_id
        FROM prestacao_despesas d
        INNER JOIN prestacao_relatorios r ON r.id = d.relatorio_id
        WHERE d.id = ? AND LOWER(r.consultor_login) = ?
        LIMIT 1
      `).bind(id, consultor.login).first()
      if (!despesa) return json({ erro: 'Despesa não encontrada para este consultor.' }, 404)

      await env.DB.prepare('DELETE FROM prestacao_despesas WHERE id = ?').bind(id).run()
      await env.DB.prepare('UPDATE prestacao_relatorios SET atualizado_em = ? WHERE id = ?')
        .bind(new Date().toISOString(), despesa.relatorio_id)
        .run()

      return json({ sucesso: true, id })
    }

    if (operacao === 'excluir-relatorio') {
      const id = texto(body.id, 160)
      if (!id) return json({ erro: 'Relatório não informado.' }, 400)

      const relatorio = await env.DB.prepare(`
        SELECT id
        FROM prestacao_relatorios
        WHERE id = ? AND LOWER(consultor_login) = ?
        LIMIT 1
      `).bind(id, consultor.login).first()
      if (!relatorio) return json({ erro: 'Relatório não encontrado para este consultor.' }, 404)

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
