import { authorized, json } from '../_lib/credentials.js'

const TIPOS = new Set(['BUSSOLA', 'MERCADO_FARMA', 'AUDITORIA', 'FECHAMENTO_MENSAL', 'MIGRAR_BASES'])
const REPOSITORIO = 'mauriciobarrosaguiar/painel-comercial-equipe-norte'
const ATIVOS = new Set(['aguardando', 'executando'])
const texto = value => String(value ?? '').trim()

const DISPAROS = {
  BUSSOLA: {
    workflow: 'bussola-d1.yml',
    inputs: (id, parametros) => ({ command_id: id, ...(parametros || {}) }),
  },
  MERCADO_FARMA: {
    workflow: 'mercadofarma.yml',
    inputs: (id, parametros) => ({
      acao: 'atualizar_mercadofarma_paralelo',
      ufs: texto(parametros?.ufs) || 'MA,MT,PA,PI,TO',
      command_id: id,
    }),
  },
}

async function admin(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return json({ erro: 'Chave administrativa não configurada.' }, 503)
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Chave administrativa inválida.' }, 401)
  }
  return null
}

function tokenDisponivel(env) {
  return typeof env.GITHUB_ACTIONS_TOKEN === 'string' && env.GITHUB_ACTIONS_TOKEN.length >= 20
}

function githubHeaders(env) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'painel-equipe-norte',
  }
}

async function workflowEmAndamento(env, workflow) {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORIO}/actions/workflows/${workflow}/runs?per_page=10`, {
    headers: githubHeaders(env),
  })
  if (!response.ok) throw new Error(`GitHub recusou a consulta do workflow (${response.status}).`)
  const body = await response.json().catch(() => ({}))
  const ativos = new Set(['queued', 'in_progress', 'pending', 'waiting', 'requested'])
  return Array.isArray(body.workflow_runs) && body.workflow_runs.some(run => ativos.has(String(run?.status || '').toLowerCase()))
}

async function dispararWorkflow(env, tipo, id, parametros) {
  const configuracao = DISPAROS[tipo]
  if (!configuracao || !tokenDisponivel(env)) return { imediato: false }

  if (await workflowEmAndamento(env, configuracao.workflow)) {
    return { imediato: false, ocupado: true }
  }

  const response = await fetch(`https://api.github.com/repos/${REPOSITORIO}/actions/workflows/${configuracao.workflow}/dispatches`, {
    method: 'POST',
    headers: githubHeaders(env),
    body: JSON.stringify({ ref: 'main', inputs: configuracao.inputs(id, parametros) }),
  })
  if (response.status !== 204) {
    const detalhe = (await response.text().catch(() => '')).slice(0, 800)
    throw new Error(`GitHub recusou o disparo (${response.status})${detalhe ? `: ${detalhe}` : ''}`)
  }
  return { imediato: true }
}

export async function onRequestGet({ env }) {
  try {
    const [comandos, extracoes, importacoes] = await env.DB.batch([
      env.DB.prepare('SELECT id,tipo,status,parametros_json,solicitado_por,mensagem,erro,solicitado_em,iniciado_em,finalizado_em,atualizado_em FROM comandos_automacao ORDER BY solicitado_em DESC LIMIT 40'),
      env.DB.prepare('SELECT id,tipo,status,total_registros,mensagem,erro,iniciado_em,finalizado_em,criado_em FROM extracoes ORDER BY criado_em DESC LIMIT 40'),
      env.DB.prepare('SELECT id,tipo,nome_arquivo,total_registros,status,criado_em FROM importacoes ORDER BY criado_em DESC LIMIT 15'),
    ])
    const listaComandos = (comandos.results || []).map(item => {
      let parametros = {}
      try { parametros = JSON.parse(String(item.parametros_json || '{}')) } catch {}
      return { ...item, parametros }
    })
    const comandosAtivos = listaComandos.filter(item => ATIVOS.has(String(item.status || '').toLowerCase())).length
    const extracoesAtivas = (extracoes.results || []).filter(item => item.status === 'executando').length
    return json({
      comandos: listaComandos,
      extracoes: extracoes.results || [],
      importacoes: importacoes.results || [],
      em_execucao: comandosAtivos + extracoesAtivas,
      disparo_imediato_configurado: tokenDisponivel(env),
      atualizado_em: new Date().toISOString(),
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table')) {
      return json({ comandos: [], extracoes: [], importacoes: [], em_execucao: 0, atualizado_em: new Date().toISOString(), aviso: 'A migração da Central de Automações ainda não foi aplicada.' })
    }
    return json({ erro: 'Não foi possível consultar as automações.', detalhe }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  const negado = await admin(request, env)
  if (negado) return negado

  try {
    const body = await request.json()
    const tipo = texto(body.tipo).toUpperCase()
    if (!TIPOS.has(tipo)) return json({ erro: 'Tipo de automação inválido.' }, 400)

    const existente = await env.DB.prepare(
      "SELECT id,status FROM comandos_automacao WHERE tipo=? AND status IN ('aguardando','executando') ORDER BY solicitado_em DESC LIMIT 1",
    ).bind(tipo).first()
    if (existente) {
      return json({ erro: 'Este processo já está aguardando ou sendo executado.', comando_id: existente.id, status: existente.status }, 409)
    }

    const configuracao = DISPAROS[tipo]
    if (configuracao && tokenDisponivel(env) && await workflowEmAndamento(env, configuracao.workflow)) {
      return json({ erro: 'Este processo já está em execução no GitHub Actions.', status: 'executando' }, 409)
    }

    const id = `cmd-${crypto.randomUUID()}`
    const agora = new Date().toISOString()
    const parametros = body.parametros && typeof body.parametros === 'object' ? body.parametros : {}
    const disparoImediato = Boolean(configuracao && tokenDisponivel(env))
    const estadoInicial = 'aguardando'
    const mensagemInicial = disparoImediato
      ? 'Enviando agora ao GitHub Actions.'
      : 'Aguardando processador de contingência.'

    const inserido = await env.DB.prepare(
      `INSERT INTO comandos_automacao(id,tipo,parametros_json,status,solicitado_por,mensagem,solicitado_em,atualizado_em)
       SELECT ?,?,?,?,?,?,?,?
       WHERE NOT EXISTS (
         SELECT 1 FROM comandos_automacao
         WHERE tipo=? AND status IN ('aguardando','executando')
       )`,
    ).bind(
      id,
      tipo,
      JSON.stringify(parametros),
      estadoInicial,
      texto(body.solicitado_por) || 'Painel',
      mensagemInicial,
      agora,
      agora,
      tipo,
    ).run()

    if (!inserido.meta?.changes) {
      return json({ erro: 'Este processo já está aguardando ou sendo executado.' }, 409)
    }

    if (!configuracao || !tokenDisponivel(env)) {
      return json({
        sucesso: true,
        id,
        tipo,
        status: 'aguardando',
        imediato: false,
        mensagem: configuracao
          ? 'Solicitação registrada. O disparo imediato ainda não está configurado; a fila de contingência assumirá o processo.'
          : 'Solicitação registrada na fila de processamento.',
      }, 202)
    }

    try {
      const resultado = await dispararWorkflow(env, tipo, id, parametros)
      if (resultado.ocupado) {
        await env.DB.prepare('DELETE FROM comandos_automacao WHERE id=? AND status=?').bind(id, 'aguardando').run()
        return json({ erro: 'Este processo já está em execução no GitHub Actions.', status: 'executando' }, 409)
      }
      const iniciado = new Date().toISOString()
      await env.DB.prepare(
        "UPDATE comandos_automacao SET status='executando',mensagem='Enviado ao GitHub Actions. Aguardando conclusão.',iniciado_em=?,atualizado_em=? WHERE id=? AND status='aguardando'",
      ).bind(iniciado, iniciado, id).run()
      return json({
        sucesso: true,
        id,
        tipo,
        status: 'executando',
        imediato: true,
        mensagem: 'Processo enviado imediatamente ao GitHub Actions.',
      }, 202)
    } catch (error) {
      const detalhe = error instanceof Error ? error.message : String(error)
      const atualizado = new Date().toISOString()
      await env.DB.prepare(
        "UPDATE comandos_automacao SET status='aguardando',mensagem='Falha no disparo imediato. A fila de contingência assumirá o processo.',erro='',atualizado_em=? WHERE id=?",
      ).bind(atualizado, id).run()
      return json({
        sucesso: true,
        id,
        tipo,
        status: 'aguardando',
        imediato: false,
        mensagem: 'O GitHub não aceitou o disparo imediato; a solicitação permaneceu salva e será processada pela contingência.',
        detalhe,
      }, 202)
    }
  } catch (error) {
    return json({ erro: 'Não foi possível registrar a automação.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
