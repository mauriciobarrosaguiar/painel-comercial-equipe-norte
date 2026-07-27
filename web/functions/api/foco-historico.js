import { authorized, json } from '../_lib/credentials.js'
import {
  arquivarPeriodosEncerrados,
  consultarLinhasMissao,
  garantirTabelaFocoHistorico,
  listarHistoricosFoco,
  montarSnapshot,
} from '../_lib/focus-history.js'

const texto = value => String(value ?? '').trim()

async function listarTodosOsFocos(env) {
  await arquivarPeriodosEncerrados(env)
  const historicos = (await listarHistoricosFoco(env, 100)).map(item => ({ ...item, historico: true }))
  const chavesHistoricas = new Set(historicos.map(item => `${item.periodo?.inicio}|${item.periodo?.fim}`))

  const periodosAtivos = await env.DB.prepare(`
    SELECT DISTINCT semana_inicio,semana_fim
    FROM foco_semanal
    WHERE ativo=1
      AND EXISTS (
        SELECT 1 FROM foco_consultores fc
        WHERE fc.foco_id=foco_semanal.id
          AND fc.ativo=1
          AND COALESCE(fc.meta_quantidade,0)>0
      )
    ORDER BY DATE(semana_fim) DESC,DATE(semana_inicio) DESC
    LIMIT 100
  `).all()

  const ativos = []
  for (const periodo of periodosAtivos.results || []) {
    const inicio = texto(periodo.semana_inicio)
    const fim = texto(periodo.semana_fim)
    if (!inicio || !fim || chavesHistoricas.has(`${inicio}|${fim}`)) continue
    const linhas = await consultarLinhasMissao(env, inicio, fim)
    if (!linhas.length) continue
    ativos.push({
      ...montarSnapshot(inicio, fim, linhas),
      id: `foco-ativo-${inicio}-${fim}`,
      historico: false,
    })
  }

  return [...ativos, ...historicos].sort((a, b) =>
    String(b.periodo?.fim || '').localeCompare(String(a.periodo?.fim || '')) ||
    String(b.periodo?.inicio || '').localeCompare(String(a.periodo?.inicio || '')),
  )
}

async function excluirFoco(env, focoId) {
  await garantirTabelaFocoHistorico(env)
  const agora = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare('UPDATE foco_semanal SET ativo=0,atualizado_em=? WHERE id=?').bind(agora, focoId),
    env.DB.prepare('UPDATE foco_consultores SET ativo=0 WHERE foco_id=?').bind(focoId),
  ])

  const historicos = await env.DB.prepare(`
    SELECT id,resultado_json
    FROM foco_historico
    ORDER BY DATE(semana_fim) DESC
    LIMIT 100
  `).all()

  for (const item of historicos.results || []) {
    let snapshot = null
    try {
      snapshot = JSON.parse(String(item.resultado_json || 'null'))
    } catch {
      snapshot = null
    }
    if (!snapshot?.produtos?.some(produto => texto(produto.foco_id) === focoId)) continue

    const produtos = (snapshot.produtos || []).filter(produto => texto(produto.foco_id) !== focoId)
    const linhas = (snapshot.linhas || []).filter(linha => texto(linha.foco_id) !== focoId)
    if (!produtos.length) {
      await env.DB.prepare('DELETE FROM foco_historico WHERE id=?').bind(item.id).run()
      continue
    }

    const consultoresMap = new Map()
    for (const linha of linhas) {
      if (!consultoresMap.has(linha.consultor_id)) {
        consultoresMap.set(linha.consultor_id, {
          consultor_id: linha.consultor_id,
          consultor: linha.consultor,
          setor: linha.setor,
        })
      }
    }
    const atualizado = { ...snapshot, produtos, linhas, consultores: [...consultoresMap.values()] }
    await env.DB.prepare(`
      UPDATE foco_historico
      SET resultado_json=?,total_produtos=?,total_consultores=?
      WHERE id=?
    `).bind(JSON.stringify(atualizado), produtos.length, atualizado.consultores.length, item.id).run()
  }
}

export async function onRequestGet({ env }) {
  try {
    return json({ historicos: await listarTodosOsFocos(env) })
  } catch (error) {
    return json({
      erro: 'Não foi possível carregar todos os focos semanais.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Sessão inválida. Entre novamente no painel.' }, 401)
  }
  try {
    const body = await request.json()
    const focoId = texto(body?.foco_id)
    if (!focoId) return json({ erro: 'Informe o foco que será excluído.' }, 400)
    await excluirFoco(env, focoId)
    return json({ sucesso: true, foco_id: focoId })
  } catch (error) {
    return json({
      erro: 'Não foi possível excluir o foco semanal.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
