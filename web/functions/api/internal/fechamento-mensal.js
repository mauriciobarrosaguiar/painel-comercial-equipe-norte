import { authorized, json } from '../../_lib/credentials.js'
import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../../_lib/commercial.js'

const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const texto = (value) => String(value ?? '').trim()
const META_KEYS = ['meta_ol_sem_combate', 'meta_ol_prioritarios', 'meta_ol_lancamentos', 'meta_clientes']

const mesAnterior = () => {
  const date = new Date()
  date.setUTCMonth(date.getUTCMonth() - 1)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

const datasMes = (anoMes) => {
  const [ano, mes] = anoMes.split('-').map(Number)
  return {
    inicio: `${anoMes}-01`,
    fim: `${anoMes}-${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, '0')}`,
  }
}

const percentual = (realizado, meta) => numero(meta) > 0 ? numero(realizado) / numero(meta) * 100 : 0

const normalizar = (row) => {
  const result = {}
  for (const [key, value] of Object.entries(row || {})) {
    result[key] = typeof value === 'number' ? numero(value) : value
  }
  result.clientes_sem_venda = Math.max(0, numero(result.clientes_ativos) - numero(result.clientes_com_venda))
  result.positivacao_percentual = numero(result.clientes_ativos) > 0
    ? numero(result.clientes_com_venda) / numero(result.clientes_ativos) * 100
    : 0
  result.ticket_medio_cliente = numero(result.clientes_com_venda) > 0
    ? numero(result.ol_total) / numero(result.clientes_com_venda)
    : 0
  result.ticket_medio_pedido = numero(result.pedidos) > 0
    ? numero(result.ol_total) / numero(result.pedidos)
    : 0
  result.resultado_meta_ol = percentual(result.ol_sem_combate, result.meta_ol_sem_combate)
  result.resultado_meta_prioritarios = percentual(result.ol_prioritarios, result.meta_ol_prioritarios)
  result.resultado_meta_lancamentos = percentual(result.ol_lancamentos, result.meta_ol_lancamentos)
  result.resultado_meta_clientes = percentual(result.clientes_com_venda, result.meta_clientes)
  return result
}

function canonico(value) {
  if (typeof value === 'number') return Math.round(value * 1_000_000) / 1_000_000
  if (Array.isArray(value)) return value.map(canonico)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonico(value[key])]),
    )
  }
  return value
}

function assinatura(rows) {
  const normalized = rows
    .map((row) => ({
      escopo: texto(row.escopo),
      referencia_id: texto(row.referencia_id),
      referencia_nome: texto(row.referencia_nome),
      resultado: canonico(row.resultado || {}),
    }))
    .sort((a, b) =>
      a.escopo.localeCompare(b.escopo)
      || a.referencia_id.localeCompare(b.referencia_id)
      || a.referencia_nome.localeCompare(b.referencia_nome, 'pt-BR'))
  return JSON.stringify(normalized)
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

function mapaMetas(rows) {
  return new Map((rows || []).map((row) => [texto(row.referencia_id), row]))
}

function mesclarMetas(rows, metas) {
  const porReferencia = mapaMetas(metas)
  return (rows || []).map((row) => ({
    ...row,
    ...(porReferencia.get(texto(row.referencia_id)) || {}),
    referencia_id: row.referencia_id,
    referencia_nome: row.referencia_nome,
  }))
}

async function calcularBlocos(env, anoMes) {
  const { inicio, fim } = datasMes(anoMes)
  const dataPeriodo = 'DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)'
  const colunas = `
    COUNT(DISTINCT pe.id) pedidos,
    COALESCE(SUM(ip.valor_faturado),0) ol_total,
    COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) ol_sem_combate,
    COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='COMBATE' THEN ip.valor_faturado ELSE 0 END),0) ol_combate,
    COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='PRIORITARIO' THEN ip.valor_faturado ELSE 0 END),0) ol_prioritarios,
    COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='LANCAMENTO' THEN ip.valor_faturado ELSE 0 END),0) ol_lancamentos
  `

  const geral = env.DB.prepare(`
    SELECT ${colunas},
           COUNT(DISTINCT CASE
             WHEN cl.carteira_importada=1 AND cl.ativo=1 AND ip.valor_faturado>0
             THEN cl.id END) clientes_com_venda
      FROM itens_pedido ip
      JOIN pedidos pe ON pe.id=ip.pedido_id
      LEFT JOIN clientes cl ON cl.id=pe.cliente_id
      LEFT JOIN produtos pr ON pr.id=ip.produto_id
     WHERE ${ITEM_FATURADO}
       AND ${dataPeriodo}
  `).bind(inicio, fim)

  const grupos = (id, nome, from, where) => env.DB.prepare(`
    SELECT ${id} referencia_id,
           ${nome} referencia_nome,
           COUNT(DISTINCT cl.id) clientes_ativos,
           COUNT(DISTINCT CASE WHEN pe.id IS NOT NULL AND ip.valor_faturado>0 THEN cl.id END) clientes_com_venda,
           ${colunas}
      ${from}
     WHERE ${where}
     GROUP BY ${id},${nome}
  `).bind(inicio, fim)

  const pedidosFaturados = `
    LEFT JOIN pedidos pe
      ON pe.cliente_id=cl.id
     AND pe.ativo=1
     AND UPPER(TRIM(COALESCE(pe.status,''))) IN ('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO')
     AND ${dataPeriodo}
    LEFT JOIN itens_pedido ip ON ip.pedido_id=pe.id AND ip.ativo=1
    LEFT JOIN produtos pr ON pr.id=ip.produto_id
  `

  const consultaMeta = (referenciaSql, origemSql, whereSql = '1=1') => env.DB.prepare(`
    SELECT ${referenciaSql} referencia_id,
           COALESCE(SUM(m.ol_sem_combate),0) meta_ol_sem_combate,
           COALESCE(SUM(m.ol_prioritarios),0) meta_ol_prioritarios,
           COALESCE(SUM(m.ol_lancamentos),0) meta_ol_lancamentos,
           COALESCE(SUM(m.clientes_positivados),0) meta_clientes
      ${origemSql}
     WHERE m.escopo='consultor'
       AND m.ano_mes=?
       AND ${whereSql}
     GROUP BY ${referenciaSql}
  `).bind(anoMes)

  const consultas = [
    geral,
    env.DB.prepare("SELECT COUNT(*) clientes_ativos FROM clientes WHERE carteira_importada=1 AND ativo=1"),
    env.DB.prepare(`
      SELECT COALESCE(SUM(ol_sem_combate),0) meta_ol_sem_combate,
             COALESCE(SUM(ol_prioritarios),0) meta_ol_prioritarios,
             COALESCE(SUM(ol_lancamentos),0) meta_ol_lancamentos,
             COALESCE(SUM(clientes_positivados),0) meta_clientes
        FROM metas
       WHERE escopo='gerente' AND ano_mes=?
    `).bind(anoMes),
    grupos(
      'co.id',
      'co.nome',
      `FROM consultores co
       LEFT JOIN clientes cl
         ON cl.consultor_id=co.id
        AND cl.carteira_importada=1
        AND cl.ativo=1
       ${pedidosFaturados}`,
      "co.ativo=1 AND co.origem='PAINEL_EQUIPE'",
    ),
    grupos(
      "UPPER(TRIM(cl.uf))",
      "UPPER(TRIM(cl.uf))",
      `FROM clientes cl ${pedidosFaturados}`,
      "cl.carteira_importada=1 AND cl.ativo=1 AND TRIM(COALESCE(cl.uf,''))<>''",
    ),
    grupos(
      "COALESCE(NULLIF(TRIM(cl.nome_gd),''),'SEM GD')",
      "COALESCE(NULLIF(TRIM(cl.nome_gd),''),'SEM GD')",
      `FROM clientes cl ${pedidosFaturados}`,
      'cl.carteira_importada=1 AND cl.ativo=1',
    ),
    grupos(
      's.id',
      's.nome',
      `FROM sips s
       LEFT JOIN sip_clientes sc ON sc.sip_id=s.id AND sc.ativo=1
       LEFT JOIN clientes cl
         ON cl.cnpj=sc.cnpj
        AND cl.carteira_importada=1
        AND cl.ativo=1
       ${pedidosFaturados}`,
      's.ativo=1',
    ),
    consultaMeta(
      'm.consultor_id',
      'FROM metas m',
      "TRIM(COALESCE(m.consultor_id,''))<>''",
    ),
    consultaMeta(
      'c.uf',
      `FROM metas m
       JOIN (
         SELECT DISTINCT consultor_id,UPPER(TRIM(uf)) uf
           FROM clientes
          WHERE carteira_importada=1 AND ativo=1
            AND TRIM(COALESCE(consultor_id,''))<>''
            AND TRIM(COALESCE(uf,''))<>''
       ) c ON c.consultor_id=m.consultor_id`,
      "TRIM(COALESCE(c.uf,''))<>''",
    ),
    consultaMeta(
      'c.nome_gd',
      `FROM metas m
       JOIN (
         SELECT DISTINCT consultor_id,COALESCE(NULLIF(TRIM(nome_gd),''),'SEM GD') nome_gd
           FROM clientes
          WHERE carteira_importada=1 AND ativo=1
            AND TRIM(COALESCE(consultor_id,''))<>''
       ) c ON c.consultor_id=m.consultor_id`,
    ),
  ]

  const results = await env.DB.batch(consultas)
  const geralNormalizado = normalizar({
    ...results[0].results?.[0],
    ...results[1].results?.[0],
    ...results[2].results?.[0],
  })

  return [
    ['GERAL', [{ referencia_id: '', referencia_nome: 'Equipe Norte', ...geralNormalizado }]],
    ['CONSULTOR', mesclarMetas(results[3].results || [], results[7].results || [])],
    ['UF', mesclarMetas(results[4].results || [], results[8].results || [])],
    ['GD', mesclarMetas(results[5].results || [], results[9].results || [])],
    ['SIP', results[6].results || []],
  ]
}

function linhasDosBlocos(blocos) {
  const rows = []
  for (const [escopo, linhas] of blocos) {
    for (const raw of linhas) {
      const resultado = normalizar(raw)
      rows.push({
        escopo,
        referencia_id: texto(resultado.referencia_id),
        referencia_nome: texto(resultado.referencia_nome),
        resultado,
      })
    }
  }
  return rows
}

async function carregarAtual(env, anoMes) {
  const result = await env.DB.prepare(`
    SELECT escopo,referencia_id,referencia_nome,versao,fechado_em,resultado_json
      FROM historico_mensal
     WHERE ano_mes=? AND versao_atual=1
     ORDER BY escopo,referencia_id
  `).bind(anoMes).all()

  return (result.results || []).map((row) => {
    let resultado = {}
    try { resultado = JSON.parse(String(row.resultado_json || '{}')) } catch {}
    return { ...row, resultado }
  })
}

function preservarMetasDoFechamento(novasLinhas, atuais) {
  const anteriores = new Map(
    (atuais || []).map((row) => [`${texto(row.escopo)}|${texto(row.referencia_id)}`, row.resultado || {}]),
  )

  return novasLinhas.map((row) => {
    const anterior = anteriores.get(`${texto(row.escopo)}|${texto(row.referencia_id)}`)
    if (!anterior) return row

    const resultado = { ...row.resultado }
    for (const key of META_KEYS) {
      if (Object.prototype.hasOwnProperty.call(anterior, key)) resultado[key] = numero(anterior[key])
    }
    return { ...row, resultado: normalizar(resultado) }
  })
}

export async function onRequestPost({ request, env }) {
  const negado = await admin(request, env)
  if (negado) return negado

  try {
    const body = await request.json().catch(() => ({}))
    const anoMes = texto(body.ano_mes || mesAnterior())
    const automatico = Boolean(body.automatico)
    const reprocessar = Boolean(body.reprocessar || automatico)
    const somenteSeAlterado = Boolean(body.somente_se_alterado || automatico)
    const apenasFechado = Object.prototype.hasOwnProperty.call(body, 'apenas_fechado')
      ? Boolean(body.apenas_fechado)
      : automatico
    const motivoInformado = texto(body.motivo).slice(0, 500)
    const motivo = motivoInformado || (automatico
      ? 'Fechamento/atualização automática após extração da Bússola: metas congeladas e faturamentos retroativos incorporados ao mês fechado.'
      : '')

    if (!/^\d{4}-\d{2}$/.test(anoMes)) {
      return json({ erro: 'Mês inválido. Use AAAA-MM.' }, 400)
    }

    const atual = await carregarAtual(env, anoMes)
    const geralAtual = atual.find((row) => row.escopo === 'GERAL')

    if (!geralAtual && apenasFechado) {
      return json({
        sucesso: true,
        ignorado: true,
        motivo: 'O mês ainda não possui fechamento para ser atualizado.',
        ano_mes: anoMes,
      })
    }

    if (geralAtual && !reprocessar) {
      return json({
        sucesso: true,
        ja_existia: true,
        ano_mes: anoMes,
        versao: geralAtual.versao,
        fechado_em: geralAtual.fechado_em,
      })
    }

    if (reprocessar && !motivo) {
      return json({ erro: 'Informe o motivo do reprocessamento.' }, 400)
    }

    const blocos = await calcularBlocos(env, anoMes)
    let novasLinhas = linhasDosBlocos(blocos)
    if (automatico && geralAtual) novasLinhas = preservarMetasDoFechamento(novasLinhas, atual)

    if (geralAtual && somenteSeAlterado && assinatura(atual) === assinatura(novasLinhas)) {
      return json({
        sucesso: true,
        sem_alteracao: true,
        ano_mes: anoMes,
        versao: geralAtual.versao,
        fechado_em: geralAtual.fechado_em,
        mensagem: 'O mês fechado já está atualizado; nenhuma nova versão foi criada.',
      })
    }

    const versionResult = await env.DB.prepare(
      'SELECT COALESCE(MAX(versao),0)+1 proxima FROM historico_mensal WHERE ano_mes=?',
    ).bind(anoMes).first()
    const versao = numero(versionResult?.proxima) || 1
    const fechadoEm = new Date().toISOString()
    const statements = []

    if (geralAtual) {
      statements.push(
        env.DB.prepare('UPDATE historico_mensal SET versao_atual=0 WHERE ano_mes=? AND versao_atual=1')
          .bind(anoMes),
      )
    }

    for (const row of novasLinhas) {
      statements.push(
        env.DB.prepare(`
          INSERT INTO historico_mensal(
            id,ano_mes,escopo,referencia_id,referencia_nome,versao,versao_atual,
            motivo_reprocessamento,resultado_json,fechado_em
          ) VALUES(?,?,?,?,?,?,1,?,?,?)
        `).bind(
          `hist-${crypto.randomUUID()}`,
          anoMes,
          row.escopo,
          row.referencia_id,
          row.referencia_nome,
          versao,
          motivo,
          JSON.stringify(row.resultado),
          fechadoEm,
        ),
      )
    }

    await env.DB.batch(statements)

    const anteriorGeral = geralAtual?.resultado || {}
    const novoGeral = novasLinhas.find((row) => row.escopo === 'GERAL')?.resultado || {}
    return json({
      sucesso: true,
      atualizado: Boolean(geralAtual),
      ano_mes: anoMes,
      versao,
      versao_anterior: geralAtual?.versao || null,
      registros: novasLinhas.length,
      fechado_em: fechadoEm,
      motivo,
      diferencas: geralAtual ? {
        ol_total: numero(novoGeral.ol_total) - numero(anteriorGeral.ol_total),
        ol_sem_combate: numero(novoGeral.ol_sem_combate) - numero(anteriorGeral.ol_sem_combate),
        ol_prioritarios: numero(novoGeral.ol_prioritarios) - numero(anteriorGeral.ol_prioritarios),
        ol_lancamentos: numero(novoGeral.ol_lancamentos) - numero(anteriorGeral.ol_lancamentos),
      } : null,
    })
  } catch (error) {
    return json({
      erro: 'Não foi possível concluir o fechamento mensal.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
