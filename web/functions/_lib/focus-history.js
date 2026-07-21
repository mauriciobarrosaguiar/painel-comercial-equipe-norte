import { ITEM_FATURADO } from './commercial.js'

const texto = value => String(value ?? '').trim()
const numero = value => (Number.isFinite(Number(value)) ? Number(value) : 0)

export function hojeSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export async function garantirTabelaFocoHistorico(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS foco_historico (
      id TEXT PRIMARY KEY,
      semana_inicio TEXT NOT NULL,
      semana_fim TEXT NOT NULL,
      resultado_json TEXT NOT NULL,
      total_produtos INTEGER NOT NULL DEFAULT 0,
      total_consultores INTEGER NOT NULL DEFAULT 0,
      fechado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(semana_inicio, semana_fim)
    )
  `).run()
}

export async function consultarLinhasMissao(env, inicio, fim) {
  const sql = `
    WITH focos AS (
      SELECT
        f.id foco_id,
        f.semana_inicio,
        f.semana_fim,
        COALESCE(NULLIF(TRIM(f.produto_id), ''), pr.id, '') produto_id,
        COALESCE(NULLIF(TRIM(f.ean), ''), pr.ean, '') ean,
        COALESCE(NULLIF(TRIM(f.descricao), ''), pr.descricao, 'Produto foco') descricao,
        COALESCE(f.observacoes, '') observacoes
      FROM foco_semanal f
      LEFT JOIN produtos pr
        ON pr.id = NULLIF(TRIM(f.produto_id), '')
        OR (NULLIF(TRIM(f.produto_id), '') IS NULL AND pr.ean = f.ean)
      WHERE f.ativo = 1
        AND DATE(f.semana_inicio) = DATE(?)
        AND DATE(f.semana_fim) = DATE(?)
    ),
    metas AS (
      SELECT
        f.*,
        co.id consultor_id,
        co.nome consultor,
        COALESCE((
          SELECT MIN(NULLIF(TRIM(clx.setor_rep), ''))
          FROM clientes clx
          WHERE clx.consultor_id = co.id
            AND clx.carteira_importada = 1
            AND clx.ativo = 1
        ), '') setor,
        COALESCE(fc.meta_quantidade, 0) meta_quantidade
      FROM focos f
      JOIN foco_consultores fc
        ON fc.foco_id = f.foco_id
       AND fc.ativo = 1
       AND COALESCE(fc.meta_quantidade, 0) > 0
      JOIN consultores co
        ON co.id = fc.consultor_id
       AND co.ativo = 1
       AND co.origem = 'PAINEL_EQUIPE'
    ),
    vendas AS (
      SELECT
        COALESCE(NULLIF(TRIM(pe.consultor_id), ''), cl.consultor_id) consultor_id,
        cl.id cliente_id,
        COALESCE(NULLIF(TRIM(ip.produto_id), ''), pr.id, '') produto_id,
        COALESCE(NULLIF(TRIM(ip.ean), ''), pr.ean, '') ean,
        pe.id pedido_id,
        COALESCE(ip.quantidade_faturada, 0) quantidade_faturada,
        COALESCE(ip.valor_faturado, 0) faturamento
      FROM itens_pedido ip
      JOIN pedidos pe ON pe.id = ip.pedido_id
      LEFT JOIN produtos pr ON pr.id = ip.produto_id
      JOIN clientes cl
        ON cl.id = pe.cliente_id
       AND cl.carteira_importada = 1
       AND cl.ativo = 1
      WHERE ${ITEM_FATURADO}
        AND DATE(COALESCE(NULLIF(TRIM(pe.data_faturamento), ''), NULLIF(TRIM(pe.data_pedido), ''))) BETWEEN DATE(?) AND DATE(?)
    )
    SELECT
      m.foco_id,
      m.semana_inicio,
      m.semana_fim,
      m.produto_id,
      m.ean,
      m.descricao,
      m.observacoes,
      m.consultor_id,
      m.consultor,
      m.setor,
      m.meta_quantidade,
      COUNT(DISTINCT CASE WHEN v.quantidade_faturada > 0 THEN v.cliente_id END) cnpj_positivados,
      COUNT(DISTINCT CASE WHEN v.quantidade_faturada > 0 THEN v.pedido_id END) pedidos,
      COALESCE(SUM(v.quantidade_faturada), 0) realizado_quantidade,
      COALESCE(SUM(v.faturamento), 0) faturamento
    FROM metas m
    LEFT JOIN vendas v
      ON v.consultor_id = m.consultor_id
     AND (
       (m.produto_id <> '' AND v.produto_id = m.produto_id)
       OR (
         m.ean <> ''
         AND REPLACE(REPLACE(REPLACE(TRIM(v.ean), '.0', ''), ' ', ''), '-', '') =
             REPLACE(REPLACE(REPLACE(TRIM(m.ean), '.0', ''), ' ', ''), '-', '')
       )
     )
    GROUP BY m.foco_id, m.consultor_id
    ORDER BY m.descricao COLLATE NOCASE, m.setor, m.consultor COLLATE NOCASE
  `

  const result = await env.DB.prepare(sql).bind(inicio, fim, inicio, fim).all()
  return (result.results || []).map(item => {
    const meta = numero(item.meta_quantidade)
    const realizado = numero(item.realizado_quantidade)
    return {
      ...item,
      id: `${item.foco_id}:${item.consultor_id}`,
      meta_quantidade: meta,
      realizado_quantidade: realizado,
      cobertura_percentual: meta > 0 ? realizado / meta * 100 : 0,
      cnpj_positivados: numero(item.cnpj_positivados),
      pedidos: numero(item.pedidos),
      faturamento: numero(item.faturamento),
    }
  })
}

export function montarSnapshot(inicio, fim, linhas, fechadoEm = new Date().toISOString()) {
  const produtosMap = new Map()
  const consultoresMap = new Map()

  for (const linha of linhas) {
    if (!produtosMap.has(linha.foco_id)) {
      produtosMap.set(linha.foco_id, {
        foco_id: linha.foco_id,
        produto_id: texto(linha.produto_id),
        ean: texto(linha.ean),
        descricao: texto(linha.descricao),
        observacoes: texto(linha.observacoes),
      })
    }
    if (!consultoresMap.has(linha.consultor_id)) {
      consultoresMap.set(linha.consultor_id, {
        consultor_id: linha.consultor_id,
        consultor: texto(linha.consultor),
        setor: texto(linha.setor),
      })
    }
  }

  const produtos = [...produtosMap.values()]
  const consultores = [...consultoresMap.values()].sort((a, b) =>
    a.setor.localeCompare(b.setor) || a.consultor.localeCompare(b.consultor, 'pt-BR'),
  )

  return {
    periodo: { inicio, fim },
    produtos,
    consultores,
    linhas,
    fechado_em: fechadoEm,
  }
}

export async function arquivarPeriodosEncerrados(env) {
  await garantirTabelaFocoHistorico(env)
  const hoje = hojeSaoPaulo()
  const pendentes = await env.DB.prepare(`
    SELECT DISTINCT f.semana_inicio, f.semana_fim
    FROM foco_semanal f
    WHERE f.ativo = 1
      AND DATE(f.semana_fim) < DATE(?)
      AND EXISTS (
        SELECT 1 FROM foco_consultores fc
        WHERE fc.foco_id = f.id
          AND fc.ativo = 1
          AND COALESCE(fc.meta_quantidade, 0) > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM foco_historico h
        WHERE h.semana_inicio = f.semana_inicio
          AND h.semana_fim = f.semana_fim
      )
    ORDER BY DATE(f.semana_fim) DESC
    LIMIT 24
  `).bind(hoje).all()

  for (const periodo of pendentes.results || []) {
    const inicio = texto(periodo.semana_inicio)
    const fim = texto(periodo.semana_fim)
    const linhas = await consultarLinhasMissao(env, inicio, fim)
    if (!linhas.length) continue
    const fechadoEm = new Date().toISOString()
    const snapshot = montarSnapshot(inicio, fim, linhas, fechadoEm)
    const id = `foco-historico-${inicio}-${fim}`
    await env.DB.prepare(`
      INSERT OR IGNORE INTO foco_historico(
        id,semana_inicio,semana_fim,resultado_json,total_produtos,total_consultores,fechado_em
      ) VALUES(?,?,?,?,?,?,?)
    `).bind(
      id,
      inicio,
      fim,
      JSON.stringify(snapshot),
      snapshot.produtos.length,
      snapshot.consultores.length,
      fechadoEm,
    ).run()
  }
}

export async function listarHistoricosFoco(env, limite = 50) {
  await garantirTabelaFocoHistorico(env)
  const result = await env.DB.prepare(`
    SELECT id,semana_inicio,semana_fim,resultado_json,total_produtos,total_consultores,fechado_em
    FROM foco_historico
    ORDER BY DATE(semana_fim) DESC, fechado_em DESC
    LIMIT ?
  `).bind(limite).all()

  return (result.results || []).map(item => {
    let snapshot = null
    try {
      snapshot = JSON.parse(String(item.resultado_json || 'null'))
    } catch {
      snapshot = null
    }
    return snapshot ? { ...snapshot, id: item.id } : null
  }).filter(Boolean)
}

export async function obterMissaoFoco(env, inicio, fim) {
  await garantirTabelaFocoHistorico(env)
  const historico = await env.DB.prepare(`
    SELECT id,resultado_json
    FROM foco_historico
    WHERE semana_inicio=? AND semana_fim=?
    LIMIT 1
  `).bind(inicio, fim).first()

  if (historico?.resultado_json) {
    try {
      return { ...JSON.parse(String(historico.resultado_json)), id: historico.id, historico: true }
    } catch {
      // Recalcula abaixo quando o JSON histórico estiver inválido.
    }
  }

  const linhas = await consultarLinhasMissao(env, inicio, fim)
  return { ...montarSnapshot(inicio, fim, linhas), historico: false }
}
