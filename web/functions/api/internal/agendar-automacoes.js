import { authorized, json } from '../../_lib/credentials.js'

const AGENDAVEIS = new Set(['BUSSOLA', 'MERCADO_FARMA', 'AUDITORIA'])
const texto = value => String(value ?? '').trim()
const numero = value => Number.isFinite(Number(value)) ? Number(value) : 0

async function admin(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return json({ erro: 'Chave administrativa não configurada.' }, 503)
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Chave administrativa inválida.' }, 401)
  }
  return null
}

function parametros(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function liberarExecucoesTravadas(env, agoraIso) {
  const result = await env.DB.prepare(`
    UPDATE comandos_automacao
       SET status='erro',
           erro='Execução interrompida por tempo excedido. A automação foi liberada para um novo disparo.',
           finalizado_em=?,
           atualizado_em=?
     WHERE status='executando'
       AND iniciado_em IS NOT NULL
       AND (
         (tipo='BUSSOLA' AND datetime(iniciado_em)<=datetime(?,'-75 minutes'))
         OR
         (tipo<>'BUSSOLA' AND datetime(iniciado_em)<=datetime(?,'-2 hours'))
       )
  `).bind(agoraIso, agoraIso, agoraIso, agoraIso).run()
  return Number(result.meta?.changes || 0)
}

export async function onRequestPost({ request, env }) {
  const negado = await admin(request, env)
  if (negado) return negado

  try {
    const agora = new Date()
    const agoraIso = agora.toISOString()
    const execucoesExpiradas = await liberarExecucoesTravadas(env, agoraIso)
    const vencidas = await env.DB.prepare(`
      SELECT tipo,intervalo_minutos,parametros_json,proxima_execucao_em
        FROM configuracoes_automacao
       WHERE ativo=1
         AND (proxima_execucao_em IS NULL OR datetime(proxima_execucao_em)<=datetime(?))
       ORDER BY COALESCE(proxima_execucao_em,'') ASC
    `).bind(agoraIso).all()

    const agendados = []
    const ignorados = []

    for (const configuracao of vencidas.results || []) {
      const tipo = texto(configuracao.tipo).toUpperCase()
      if (!AGENDAVEIS.has(tipo)) {
        ignorados.push({ tipo, motivo: 'Tipo não agendável.' })
        continue
      }

      const intervalo = Math.min(10080, Math.max(5, Math.trunc(numero(configuracao.intervalo_minutos) || 30)))
      const id = `cmd-${crypto.randomUUID()}`
      const parametrosSalvos = parametros(configuracao.parametros_json)
      if (tipo === 'MERCADO_FARMA' && !texto(parametrosSalvos.ufs)) {
        parametrosSalvos.ufs = 'MA,MT,PA,PI,TO'
      }

      const inserido = await env.DB.prepare(`
        INSERT INTO comandos_automacao(
          id,tipo,parametros_json,status,solicitado_por,mensagem,solicitado_em,atualizado_em
        )
        SELECT ?,?,?, 'aguardando','Agendamento automático',?,?,?
         WHERE NOT EXISTS (
           SELECT 1 FROM comandos_automacao
            WHERE tipo=? AND status IN ('aguardando','executando')
         )
      `).bind(
        id,
        tipo,
        JSON.stringify(parametrosSalvos),
        `Execução automática programada a cada ${intervalo} minutos.`,
        agoraIso,
        agoraIso,
        tipo,
      ).run()

      if (!inserido.meta?.changes) {
        ignorados.push({ tipo, motivo: 'Já existe uma execução aguardando ou em andamento.' })
        continue
      }

      const proxima = new Date(agora.getTime() + intervalo * 60_000).toISOString()
      await env.DB.prepare(`
        UPDATE configuracoes_automacao
           SET ultima_execucao_em=?,proxima_execucao_em=?,atualizado_em=?
         WHERE tipo=?
      `).bind(agoraIso, proxima, agoraIso, tipo).run()

      agendados.push({ id, tipo, intervalo_minutos: intervalo, proxima_execucao_em: proxima })
    }

    return json({
      sucesso: true,
      agendados,
      ignorados,
      total_agendados: agendados.length,
      execucoes_expiradas: execucoesExpiradas,
      verificado_em: agoraIso,
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table')) {
      return json({
        erro: 'A estrutura de agendamentos ainda não foi instalada.',
        detalhe: 'Aplique as migrações do banco antes de executar o verificador.',
      }, 503)
    }
    return json({ erro: 'Não foi possível verificar os agendamentos.', detalhe }, 500)
  }
}
