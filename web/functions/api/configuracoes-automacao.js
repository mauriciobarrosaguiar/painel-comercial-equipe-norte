import { authorized, json } from '../_lib/credentials.js'

const AGENDAVEIS = new Map([
  ['BUSSOLA', {
    nome: 'Bússola',
    descricao: 'Atualiza pedidos, faturamento, clientes e indicadores comerciais.',
    padrao: 30,
  }],
  ['MERCADO_FARMA', {
    nome: 'Mercado Farma',
    descricao: 'Atualiza preços e estoques das UFs configuradas.',
    padrao: 30,
  }],
  ['AUDITORIA', {
    nome: 'Auditoria dos cálculos',
    descricao: 'Confere vínculos, EANs, datas, status e conciliação dos valores.',
    padrao: 1440,
  }],
])

const texto = value => String(value ?? '').trim()
const numero = value => Number.isFinite(Number(value)) ? Number(value) : 0

async function admin(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return json({ erro: 'Chave administrativa não configurada.' }, 503)
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Acesso não autorizado.' }, 401)
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

function apresentar(item) {
  const tipo = texto(item.tipo).toUpperCase()
  const cadastro = AGENDAVEIS.get(tipo) || { nome: tipo, descricao: '', padrao: 30 }
  return {
    tipo,
    nome: cadastro.nome,
    descricao: cadastro.descricao,
    ativo: Boolean(numero(item.ativo)),
    intervalo_minutos: Math.max(5, numero(item.intervalo_minutos) || cadastro.padrao),
    parametros: parametros(item.parametros_json),
    ultima_execucao_em: item.ultima_execucao_em || null,
    proxima_execucao_em: item.proxima_execucao_em || null,
    atualizado_por: texto(item.atualizado_por),
    atualizado_em: item.atualizado_em || null,
  }
}

async function listar(env) {
  const result = await env.DB.prepare(`
    SELECT tipo,ativo,intervalo_minutos,parametros_json,ultima_execucao_em,
           proxima_execucao_em,atualizado_por,atualizado_em
      FROM configuracoes_automacao
     ORDER BY CASE tipo
       WHEN 'BUSSOLA' THEN 1
       WHEN 'MERCADO_FARMA' THEN 2
       WHEN 'AUDITORIA' THEN 3
       ELSE 9 END
  `).all()
  return (result.results || []).map(apresentar)
}

export async function onRequestGet({ request, env }) {
  const negado = await admin(request, env)
  if (negado) return negado

  try {
    return json({
      configuracoes: await listar(env),
      verificador_minutos: 5,
      atualizado_em: new Date().toISOString(),
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table')) {
      return json({
        erro: 'A configuração de intervalos ainda não foi instalada.',
        detalhe: 'Aguarde a conclusão da publicação e das migrações do banco.',
      }, 503)
    }
    return json({ erro: 'Não foi possível consultar os intervalos.', detalhe }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  const negado = await admin(request, env)
  if (negado) return negado

  try {
    const body = await request.json().catch(() => ({}))
    const tipo = texto(body.tipo).toUpperCase()
    const cadastro = AGENDAVEIS.get(tipo)
    if (!cadastro) return json({ erro: 'Esta automação não aceita agendamento recorrente.' }, 400)

    const intervalo = Math.trunc(numero(body.intervalo_minutos))
    if (intervalo < 5 || intervalo > 10080) {
      return json({ erro: 'O intervalo deve ficar entre 5 minutos e 7 dias.' }, 400)
    }

    const ativo = body.ativo === true || body.ativo === 1 || body.ativo === '1'
    const existente = await env.DB.prepare(
      'SELECT parametros_json FROM configuracoes_automacao WHERE tipo=?',
    ).bind(tipo).first()
    const parametrosAtuais = parametros(existente?.parametros_json)
    const novosParametros = body.parametros && typeof body.parametros === 'object' && !Array.isArray(body.parametros)
      ? { ...parametrosAtuais, ...body.parametros }
      : parametrosAtuais
    if (tipo === 'MERCADO_FARMA' && !texto(novosParametros.ufs)) {
      novosParametros.ufs = 'MA,MT,PA,PI,TO'
    }

    const agora = new Date()
    const proxima = ativo ? new Date(agora.getTime() + intervalo * 60_000).toISOString() : null
    const atualizadoPor = texto(body.atualizado_por) || 'Painel'

    await env.DB.prepare(`
      INSERT INTO configuracoes_automacao(
        tipo,ativo,intervalo_minutos,parametros_json,proxima_execucao_em,atualizado_por,atualizado_em
      ) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(tipo) DO UPDATE SET
        ativo=excluded.ativo,
        intervalo_minutos=excluded.intervalo_minutos,
        parametros_json=excluded.parametros_json,
        proxima_execucao_em=excluded.proxima_execucao_em,
        atualizado_por=excluded.atualizado_por,
        atualizado_em=excluded.atualizado_em
    `).bind(
      tipo,
      ativo ? 1 : 0,
      intervalo,
      JSON.stringify(novosParametros),
      proxima,
      atualizadoPor,
      agora.toISOString(),
    ).run()

    const salvo = await env.DB.prepare(`
      SELECT tipo,ativo,intervalo_minutos,parametros_json,ultima_execucao_em,
             proxima_execucao_em,atualizado_por,atualizado_em
        FROM configuracoes_automacao WHERE tipo=?
    `).bind(tipo).first()

    return json({
      sucesso: true,
      configuracao: apresentar(salvo),
      mensagem: ativo
        ? `${cadastro.nome} será executada a cada ${intervalo} minutos.`
        : `${cadastro.nome} teve o agendamento automático desativado.`,
    })
  } catch (error) {
    return json({
      erro: 'Não foi possível salvar o intervalo da automação.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
