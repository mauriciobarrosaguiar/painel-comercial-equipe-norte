const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store',
}

const WORKFLOWS = {
  BUSSOLA: 'bussola-d1.yml',
  MERCADO_FARMA: 'mercadofarma.yml',
  MIGRAR_BASES: 'migrar-bases-legadas-d1.yml',
  FECHAMENTO_MENSAL: 'fechamento-mensal.yml',
}

const texto = (value) => String(value ?? '').trim()
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })

async function respostaJson(response) {
  const body = await response.text()
  let parsed = {}
  if (body) {
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = { detalhe: body.slice(0, 3500) }
    }
  }
  if (!response.ok) {
    const detalhe = parsed?.erro || parsed?.message || parsed?.detalhe || `HTTP ${response.status}`
    throw new Error(texto(detalhe) || `HTTP ${response.status}`)
  }
  return parsed
}

async function painelPost(env, path, body, fetchFn) {
  const baseUrl = texto(env.PAINEL_URL).replace(/\/$/, '')
  const adminKey = texto(env.PAINEL_ADMIN_KEY)
  if (!baseUrl) throw new Error('PAINEL_URL não configurada no Worker.')
  if (adminKey.length < 12) throw new Error('PAINEL_ADMIN_KEY não configurada no Worker.')

  const response = await fetchFn(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'x-admin-key': adminKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
  return respostaJson(response)
}

async function finalizarComando(env, id, status, mensagem, erro, fetchFn) {
  return painelPost(env, '/api/internal/automacoes', {
    acao: 'finalizar',
    id,
    status,
    mensagem: mensagem || '',
    erro: erro || '',
  }, fetchFn)
}

export async function dispararWorkflow(env, workflow, inputs = {}, fetchFn = fetch) {
  const token = texto(env.GITHUB_ACTIONS_TOKEN)
  const repository = texto(env.GITHUB_REPOSITORY)
  const ref = texto(env.GITHUB_REF) || 'main'
  if (!token) throw new Error('GITHUB_ACTIONS_TOKEN não configurado no Worker.')
  if (!repository || !repository.includes('/')) throw new Error('GITHUB_REPOSITORY inválido no Worker.')

  const response = await fetchFn(
    `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'painel-equipe-norte-automacoes',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ ref, inputs }),
    },
  )

  if (response.status !== 204) {
    const body = await response.text()
    throw new Error(`GitHub recusou ${workflow}: HTTP ${response.status}${body ? ` - ${body.slice(0, 1200)}` : ''}`)
  }
}

async function executarAuditoria(env, fetchFn) {
  const baseUrl = texto(env.PAINEL_URL).replace(/\/$/, '')
  const response = await fetchFn(`${baseUrl}/api/admin/auditoria`, {
    method: 'POST',
    headers: {
      'x-admin-key': texto(env.PAINEL_ADMIN_KEY),
      accept: 'application/json',
    },
  })
  return respostaJson(response)
}

async function executarComando(env, comando, fetchFn) {
  const id = texto(comando?.id)
  const tipo = texto(comando?.tipo).toUpperCase()
  const parametros = comando?.parametros && typeof comando.parametros === 'object'
    ? comando.parametros
    : {}

  if (!id || !tipo) throw new Error('Comando recebido sem identificador ou tipo.')

  if (tipo === 'BUSSOLA') {
    await dispararWorkflow(env, WORKFLOWS.BUSSOLA, { command_id: id }, fetchFn)
    return { acompanha_workflow: true, mensagem: 'Extração do Bússola enviada ao GitHub Actions.' }
  }

  if (tipo === 'MERCADO_FARMA') {
    const ufs = texto(parametros.ufs) || 'MA,MT,PA,PI,TO'
    await dispararWorkflow(env, WORKFLOWS.MERCADO_FARMA, {
      acao: 'atualizar_mercadofarma_paralelo',
      ufs,
      command_id: id,
    }, fetchFn)
    return { acompanha_workflow: true, mensagem: `Extração do Mercado Farma enviada para ${ufs}.` }
  }

  if (tipo === 'MIGRAR_BASES') {
    const inputs = {}
    if (texto(parametros.ano_mes)) inputs.ano_mes = texto(parametros.ano_mes)
    await dispararWorkflow(env, WORKFLOWS.MIGRAR_BASES, inputs, fetchFn)
    return { acompanha_workflow: false, mensagem: 'Migração das bases legadas enviada ao GitHub Actions.' }
  }

  if (tipo === 'FECHAMENTO_MENSAL') {
    const inputs = {}
    if (texto(parametros.ano_mes)) inputs.ano_mes = texto(parametros.ano_mes)
    await dispararWorkflow(env, WORKFLOWS.FECHAMENTO_MENSAL, inputs, fetchFn)
    return { acompanha_workflow: false, mensagem: 'Fechamento mensal enviado ao GitHub Actions.' }
  }

  if (tipo === 'AUDITORIA') {
    await executarAuditoria(env, fetchFn)
    return { acompanha_workflow: false, mensagem: 'Auditoria dos cálculos concluída.' }
  }

  throw new Error(`Tipo de automação não reconhecido: ${tipo}`)
}

export async function processarFila(env, fetchFn = fetch) {
  const resumo = {
    agendamentos: null,
    processados: [],
    erros: [],
    verificado_em: new Date().toISOString(),
  }

  try {
    resumo.agendamentos = await painelPost(env, '/api/internal/agendar-automacoes', {}, fetchFn)
  } catch (error) {
    resumo.erros.push(`Agendamento: ${error instanceof Error ? error.message : String(error)}`)
  }

  for (let tentativa = 1; tentativa <= 10; tentativa += 1) {
    let proximo
    try {
      proximo = await painelPost(env, '/api/internal/automacoes', { acao: 'proxima' }, fetchFn)
    } catch (error) {
      resumo.erros.push(`Fila: ${error instanceof Error ? error.message : String(error)}`)
      break
    }

    const comando = proximo?.comando
    if (!comando?.id) break

    try {
      const resultado = await executarComando(env, comando, fetchFn)
      if (!resultado.acompanha_workflow) {
        await finalizarComando(env, comando.id, 'concluido', resultado.mensagem, '', fetchFn)
      }
      resumo.processados.push({
        id: comando.id,
        tipo: comando.tipo,
        acompanha_workflow: Boolean(resultado.acompanha_workflow),
        mensagem: resultado.mensagem,
      })
    } catch (error) {
      const detalhe = error instanceof Error ? error.message : String(error)
      try {
        await finalizarComando(env, comando.id, 'erro', '', detalhe.slice(0, 3500), fetchFn)
      } catch (finalizacaoError) {
        resumo.erros.push(
          `Finalização ${comando.id}: ${finalizacaoError instanceof Error ? finalizacaoError.message : String(finalizacaoError)}`,
        )
      }
      resumo.erros.push(`${comando.tipo || 'COMANDO'} ${comando.id}: ${detalhe}`)
    }
  }

  return resumo
}

function autorizado(request, env) {
  const recebido = texto(request.headers.get('x-admin-key'))
  const esperado = texto(env.PAINEL_ADMIN_KEY)
  return esperado.length >= 12 && recebido === esperado
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      processarFila(env)
        .then((resumo) => console.log(JSON.stringify({ evento: 'cron', ...resumo })))
        .catch((error) => console.error('Falha no cron de automações:', error)),
    )
  },

  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ sucesso: true, servico: 'painel-equipe-norte-automacoes' })
    }
    if (request.method === 'POST' && url.pathname === '/processar') {
      if (!autorizado(request, env)) return json({ erro: 'Acesso não autorizado.' }, 401)
      try {
        return json(await processarFila(env))
      } catch (error) {
        return json({
          erro: 'Não foi possível processar a fila.',
          detalhe: error instanceof Error ? error.message : String(error),
        }, 500)
      }
    }
    return json({ erro: 'Rota não encontrada.' }, 404)
  },
}
