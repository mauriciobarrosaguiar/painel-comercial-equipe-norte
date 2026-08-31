const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const text = value => String(value ?? '').trim()
const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value))

function todaySaoPaulo() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function defaultBounds() {
  const today = todaySaoPaulo()
  return { inicio: `${today.slice(0, 8)}01`, fim: today }
}

function wherePeriod(url) {
  const defaults = defaultBounds()
  const inicio = text(url.searchParams.get('inicio')) || defaults.inicio
  const fim = text(url.searchParams.get('fim')) || defaults.fim
  const uf = text(url.searchParams.get('uf')).toUpperCase()
  if (!isoDate(inicio) || !isoDate(fim) || inicio > fim) {
    throw new Error('Período inválido. Use data inicial e final no formato AAAA-MM-DD.')
  }
  return { inicio, fim, uf }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  let periodo
  try {
    periodo = wherePeriod(url)
  } catch (error) {
    return json({ erro: error instanceof Error ? error.message : String(error) }, 400)
  }

  const ufSql = periodo.uf ? ' AND p.cliente_uf=?' : ''
  const baseParams = periodo.uf ? [periodo.inicio, periodo.fim, periodo.uf] : [periodo.inicio, periodo.fim]

  try {
    const [
      resumoPedidos,
      resumoItens,
      clientes,
      distribuidores,
      statuses,
      pedidos,
      execucoes,
    ] = await env.DB.batch([
      env.DB.prepare(`
        SELECT
          COUNT(*) AS pedidos,
          COUNT(DISTINCT p.cnpj) AS clientes_com_pedido,
          COALESCE(SUM(p.total_pedido),0) AS valor_pedidos,
          COALESCE(SUM(p.total_faturado),0) AS valor_faturado,
          COALESCE(SUM(p.total_atendido),0) AS valor_atendido,
          COALESCE(SUM(p.desconto),0) AS descontos
        FROM mercadofarma_pedidos p
        WHERE p.data_criacao BETWEEN ? AND ?${ufSql}
      `).bind(...baseParams),

      env.DB.prepare(`
        SELECT
          COALESCE(SUM(i.solicitado),0) AS unidades_solicitadas,
          COALESCE(SUM(i.atendido),0) AS unidades_atendidas,
          COALESCE(SUM(i.cancelado),0) AS unidades_canceladas,
          COALESCE(SUM(i.faturado),0) AS unidades_faturadas,
          COALESCE(SUM(i.solicitado * i.valor_unitario),0) AS valor_solicitado_itens,
          COALESCE(SUM(i.cancelado * i.valor_unitario),0) AS valor_cancelado,
          COALESCE(SUM(i.faturado * i.valor_unitario),0) AS valor_faturado_itens,
          COUNT(*) AS itens
        FROM mercadofarma_pedido_itens i
        JOIN mercadofarma_pedidos p ON p.id=i.pedido_id
        WHERE p.data_criacao BETWEEN ? AND ?${ufSql}
      `).bind(...baseParams),

      env.DB.prepare(`
        SELECT
          p.cnpj,
          MAX(p.cliente_nome) AS cliente_nome,
          MAX(p.cliente_uf) AS uf,
          MAX(p.consultor_nome) AS consultor,
          COUNT(DISTINCT p.id) AS pedidos,
          COALESCE(SUM(p.total_pedido),0) AS valor_pedidos,
          COALESCE(SUM(p.total_faturado),0) AS valor_faturado,
          COALESCE(SUM(x.solicitado),0) AS solicitado,
          COALESCE(SUM(x.atendido),0) AS atendido,
          COALESCE(SUM(x.cancelado),0) AS cancelado,
          COALESCE(SUM(x.faturado),0) AS faturado
        FROM mercadofarma_pedidos p
        LEFT JOIN (
          SELECT pedido_id,
                 SUM(solicitado) AS solicitado,
                 SUM(atendido) AS atendido,
                 SUM(cancelado) AS cancelado,
                 SUM(faturado) AS faturado
            FROM mercadofarma_pedido_itens
           GROUP BY pedido_id
        ) x ON x.pedido_id=p.id
        WHERE p.data_criacao BETWEEN ? AND ?${ufSql}
        GROUP BY p.cnpj
        ORDER BY valor_pedidos DESC, cliente_nome
        LIMIT 500
      `).bind(...baseParams),

      env.DB.prepare(`
        SELECT
          COALESCE(NULLIF(TRIM(p.distribuidora),''),'Não informada') AS distribuidora,
          COUNT(*) AS pedidos,
          COUNT(DISTINCT p.cnpj) AS clientes,
          COALESCE(SUM(p.total_pedido),0) AS valor_pedidos,
          COALESCE(SUM(p.total_faturado),0) AS valor_faturado
        FROM mercadofarma_pedidos p
        WHERE p.data_criacao BETWEEN ? AND ?${ufSql}
        GROUP BY COALESCE(NULLIF(TRIM(p.distribuidora),''),'Não informada')
        ORDER BY valor_pedidos DESC
      `).bind(...baseParams),

      env.DB.prepare(`
        SELECT
          COALESCE(NULLIF(TRIM(p.status),''),'Sem status') AS status,
          COUNT(*) AS pedidos,
          COALESCE(SUM(p.total_pedido),0) AS valor
        FROM mercadofarma_pedidos p
        WHERE p.data_criacao BETWEEN ? AND ?${ufSql}
        GROUP BY COALESCE(NULLIF(TRIM(p.status),''),'Sem status')
        ORDER BY pedidos DESC
      `).bind(...baseParams),

      env.DB.prepare(`
        SELECT
          p.id,p.cnpj,p.cliente_nome,p.cliente_uf,p.consultor_nome,p.pedido_numero,
          p.status,p.distribuidora,p.laboratorio,p.data_criacao,p.hora_criacao,
          p.criado_por,p.total_pedido,p.total_atendido,p.total_faturado,p.desconto,
          p.qtd_itens,p.pedido_distribuidor,p.pedido_interno,p.numero_nfe
        FROM mercadofarma_pedidos p
        WHERE p.data_criacao BETWEEN ? AND ?${ufSql}
        ORDER BY p.data_criacao DESC,p.hora_criacao DESC,p.pedido_numero DESC
        LIMIT 300
      `).bind(...baseParams),

      env.DB.prepare(`
        SELECT
          id,uf,inicio_periodo,fim_periodo,status,clientes_total,clientes_processados,
          clientes_com_erro,pedidos_total,itens_total,mensagem,erro,iniciado_em,finalizado_em
        FROM mercadofarma_pedidos_execucoes
        ORDER BY iniciado_em DESC
        LIMIT 25
      `),
    ])

    const orders = resumoPedidos.results?.[0] || {}
    const items = resumoItens.results?.[0] || {}
    const solicitado = number(items.unidades_solicitadas)
    const atendido = number(items.unidades_atendidas)
    const faturado = number(items.unidades_faturadas)

    return json({
      periodo,
      resumo: {
        pedidos: number(orders.pedidos),
        clientes_com_pedido: number(orders.clientes_com_pedido),
        valor_pedidos: number(orders.valor_pedidos),
        valor_faturado: number(orders.valor_faturado),
        valor_atendido: number(orders.valor_atendido),
        descontos: number(orders.descontos),
        itens: number(items.itens),
        unidades_solicitadas: solicitado,
        unidades_atendidas: atendido,
        unidades_canceladas: number(items.unidades_canceladas),
        unidades_faturadas: faturado,
        valor_cancelado: number(items.valor_cancelado),
        valor_faturado_itens: number(items.valor_faturado_itens),
        atendimento_pct: solicitado > 0 ? atendido / solicitado * 100 : 0,
        faturamento_pct: solicitado > 0 ? faturado / solicitado * 100 : 0,
      },
      clientes: clientes.results || [],
      distribuidores: distribuidores.results || [],
      status: statuses.results || [],
      pedidos: pedidos.results || [],
      execucoes: execucoes.results || [],
      atualizado_em: new Date().toISOString(),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (detail.includes('no such table')) {
      return json({
        periodo,
        resumo: {},
        clientes: [],
        distribuidores: [],
        status: [],
        pedidos: [],
        execucoes: [],
        aviso: 'A estrutura de pedidos do Mercado Farma ainda está sendo publicada.',
        atualizado_em: new Date().toISOString(),
      })
    }
    return json({ erro: 'Não foi possível consultar os pedidos dos clientes.', detalhe: detail }, 500)
  }
}
