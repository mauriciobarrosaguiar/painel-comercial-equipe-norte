import { authorized, json } from '../_lib/credentials.js'

const TIPOS = new Set(['BUSSOLA','MERCADO_FARMA','AUDITORIA','FECHAMENTO_MENSAL','MIGRAR_BASES'])
const texto = (valor) => String(valor ?? '').trim()

async function exigirAdmin(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) return json({ erro: 'Chave administrativa não configurada.' }, 503)
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) return json({ erro: 'Chave administrativa inválida.' }, 401)
  return null
}

export async function onRequestGet({ env }) {
  try {
    const [comandos, extracoes] = await env.DB.batch([
      env.DB.prepare(`SELECT id,tipo,status,parametros_json,solicitado_por,mensagem,erro,solicitado_em,iniciado_em,finalizado_em,atualizado_em FROM comandos_automacao ORDER BY solicitado_em DESC LIMIT 40`),
      env.DB.prepare(`SELECT id,tipo,status,total_registros,mensagem,erro,iniciado_em,finalizado_em,criado_em FROM extracoes ORDER BY criado_em DESC LIMIT 40`),
    ])
    return json({
      comandos: (comandos.results || []).map((item) => ({ ...item, parametros: (() => { try { return JSON.parse(String(item.parametros_json || '{}')) } catch { return {} } })() })),
      extracoes: extracoes.results || [],
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table')) return json({ comandos: [], extracoes: [], aviso: 'A migração da Central de Automações ainda não foi aplicada.' })
    return json({ erro: 'Não foi possível consultar as automações.', detalhe }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  const negado = await exigirAdmin(request, env)
  if (negado) return negado
  try {
    const body = await request.json()
    const tipo = texto(body.tipo).toUpperCase()
    if (!TIPOS.has(tipo)) return json({ erro: 'Tipo de automação inválido.' }, 400)

    const existente = await env.DB.prepare(`SELECT id,status FROM comandos_automacao WHERE tipo=? AND status IN ('aguardando','executando','despachado') ORDER BY solicitado_em DESC LIMIT 1`).bind(tipo).first()
    if (existente) return json({ erro: 'Já existe uma execução aguardando ou em andamento.', comando_id: existente.id, status: existente.status }, 409)

    const id = `cmd-${crypto.randomUUID()}`
    const agora = new Date().toISOString()
    const parametros = body.parametros && typeof body.parametros === 'object' ? body.parametros : {}
    await env.DB.prepare(`INSERT INTO comandos_automacao(id,tipo,parametros_json,status,solicitado_por,mensagem,solicitado_em,atualizado_em) VALUES(?,?,?,'aguardando',?,?,?,?)`)
      .bind(id, tipo, JSON.stringify(parametros), texto(body.solicitado_por) || 'Painel', 'Aguardando processamento seguro.', agora, agora).run()
    return json({ sucesso: true, id, tipo, status: 'aguardando', mensagem: 'Solicitação registrada. O processamento iniciará em poucos minutos.' }, 202)
  } catch (error) {
    return json({ erro: 'Não foi possível registrar a automação.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
