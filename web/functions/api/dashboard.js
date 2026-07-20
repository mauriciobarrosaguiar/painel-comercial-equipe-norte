const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  })
}

const STATUS_FATURADO = `
  UPPER(COALESCE(pe.status, '')) LIKE '%FATURAD%'
  AND UPPER(COALESCE(pe.status, '')) NOT LIKE '%CANCEL%'
`

const PERIODOS = new Set(['mes-atual', 'mes-anterior', 'todo-periodo', 'personalizado'])

function datePartsInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function resolvePeriod(searchParams) {
  const periodo = PERIODOS.has(searchParams.get('periodo')) ? searchParams.get('periodo') : 'mes-atual'
  if (periodo === 'todo-periodo') return { periodo, inicio: null, fim: null }

  const requestedStart = searchParams.get('inicio') || ''
  const requestedEnd = searchParams.get('fim') || ''
  if (validIsoDate(requestedStart) && validIsoDate(requestedEnd)) {
    if (requestedStart > requestedEnd) throw new Error('A data inicial não pode ser posterior à data final.')
    return { periodo, inicio: requestedStart, fim: requestedEnd }
  }

  if (periodo === 'personalizado') {
    throw new Error('Informe uma data inicial e uma data final válidas.')
  }

  const today = datePartsInSaoPaulo()
  let year = Number(today.year)
  let month = Number(today.month)
  if (periodo === 'mes-anterior') {
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }

  return {
    periodo,
    inicio: isoDate(year, month, 1),
    fim: isoDate(year, month, lastDayOfMonth(year, month)),
  }
}

function displayDate(value) {
  if (!value) return ''
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function prepare(env, sql, params = []) {
  const statement = env.DB.prepare(sql)
  return params.length ? statement.bind(...params) : statement
}

function filterContext(searchParams) {
  const period = resolvePeriod(searchParams)
  const consultant = String(searchParams.get('consultor') || '').trim().slice(0, 160)
  const uf = String(searchParams.get('uf') || '').trim().toUpperCase().slice(0, 2)
  const conditions = [STATUS_FATURADO]
  const params = []

  if (period.inicio && period.fim) {
    conditions.push('DATE(COALESCE(pe.data_pedido, pe.data_faturamento)) >= DATE(?)')
    conditions.push('DATE(COALESCE(pe.data_pedido, pe.data_faturamento)) <= DATE(?)')
    params.push(period.inicio, period.fim)
  }
  if (consultant) {
    conditions.push('pe.consultor_id = ?')
    params.push(consultant)
  }
  if (uf) {
    conditions.push(`UPPER(COALESCE(NULLIF(TRIM(cl.uf), ''), NULLIF(TRIM(pe.uf_centro_distribuicao), ''), '')) = ?`)
    params.push(uf)
  }

  const label = period.inicio && period.fim
    ? `${displayDate(period.inicio)} a ${displayDate(period.fim)}`
    : 'Todo o período extraído'

  return {
    ...period,
    consultant,
    uf,
    where: conditions.join('\n AND '),
    params,
    label,
  }
}

const BASE_JOINS = `
  FROM itens_pedido ip
  JOIN pedidos pe ON pe.id = ip.pedido_id
  LEFT JOIN produtos pr ON pr.id = ip.produto_id
  LEFT JOIN clientes cl ON cl.id = pe.cliente_id
`

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url)
    const filter = filterContext(url.searchParams)

    const metricStatements = [
      prepare(env, `
        SELECT COALESCE(SUM(ip.valor_faturado), 0) AS total
        ${BASE_JOINS}
        WHERE ${filter.where}
          AND UPPER(COALESCE(pr.tipo_mix, 'SEM CLASSIFICACAO')) <> 'COMBATE'
      `, filter.params),
      prepare(env, `
        SELECT COALESCE(SUM(ip.valor_faturado), 0) AS total
        ${BASE_JOINS}
        WHERE ${filter.where}
          AND UPPER(COALESCE(pr.tipo_mix, '')) = 'PRIORITARIO'
      `, filter.params),
      prepare(env, `
        SELECT COALESCE(SUM(ip.valor_faturado), 0) AS total
        ${BASE_JOINS}
        WHERE ${filter.where}
          AND UPPER(COALESCE(pr.tipo_mix, '')) = 'LANCAMENTO'
      `, filter.params),
      prepare(env, `
        SELECT COUNT(DISTINCT pe.cliente_id) AS total
        ${BASE_JOINS}
        WHERE pe.cliente_id IS NOT NULL
          AND ${filter.where}
          AND ip.valor_faturado > 0
          AND UPPER(COALESCE(pr.tipo_mix, 'SEM CLASSIFICACAO')) <> 'COMBATE'
      `, filter.params),
      prepare(env, 'SELECT COUNT(*) AS total FROM clientes WHERE ativo = 1'),
      prepare(env, 'SELECT COUNT(*) AS total FROM consultores WHERE ativo = 1'),
      prepare(env, `
        SELECT COALESCE(SUM(ip.valor_faturado), 0) AS total
        ${BASE_JOINS}
        WHERE ${filter.where}
      `, filter.params),
      prepare(env, "SELECT COUNT(*) AS total FROM extracoes WHERE status = 'executando'"),
      prepare(env, `SELECT id, nome FROM consultores WHERE ativo = 1 AND TRIM(nome) <> '' ORDER BY nome COLLATE NOCASE`),
      prepare(env, `
        SELECT uf FROM (
          SELECT UPPER(TRIM(uf)) AS uf FROM clientes WHERE ativo = 1 AND TRIM(COALESCE(uf, '')) <> ''
          UNION
          SELECT UPPER(TRIM(uf_centro_distribuicao)) AS uf FROM pedidos WHERE TRIM(COALESCE(uf_centro_distribuicao, '')) <> ''
        ) WHERE LENGTH(uf) = 2 ORDER BY uf
      `),
    ]

    const resultados = await env.DB.batch(metricStatements)
    const consultores = (resultados[8]?.results || []).map((item) => ({
      id: String(item.id || ''),
      nome: String(item.nome || ''),
    })).filter((item) => item.id && item.nome)
    const ufs = (resultados[9]?.results || []).map((item) => String(item.uf || '')).filter(Boolean)

    return json({
      ol_sem_combate: Number(resultados[0]?.results?.[0]?.total || 0),
      ol_prioritarios: Number(resultados[1]?.results?.[0]?.total || 0),
      ol_lancamentos: Number(resultados[2]?.results?.[0]?.total || 0),
      clientes_com_venda: Number(resultados[3]?.results?.[0]?.total || 0),
      clientes_ativos: Number(resultados[4]?.results?.[0]?.total || 0),
      consultores_ativos: Number(resultados[5]?.results?.[0]?.total || 0),
      vendas_faturadas: Number(resultados[6]?.results?.[0]?.total || 0),
      automacoes_executando: Number(resultados[7]?.results?.[0]?.total || 0),
      filtros: {
        consultores,
        ufs,
        aplicado: {
          periodo: filter.periodo,
          inicio: filter.inicio,
          fim: filter.fim,
          consultor: filter.consultant,
          uf: filter.uf,
          rotulo: filter.label,
        },
      },
      atualizado_em: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json(
      {
        erro: 'Não foi possível carregar os indicadores.',
        detalhe: message,
      },
      message.includes('data inicial') || message.includes('data final') ? 400 : 500,
    )
  }
}
