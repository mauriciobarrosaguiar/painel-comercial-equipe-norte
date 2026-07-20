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

export async function onRequestGet({ env }) {
  try {
    const resultados = await env.DB.batch([
      env.DB.prepare(`
        SELECT COALESCE(SUM(ip.valor_faturado), 0) AS total
        FROM itens_pedido ip
        JOIN pedidos pe ON pe.id = ip.pedido_id
        LEFT JOIN produtos pr ON pr.id = ip.produto_id
        WHERE ${STATUS_FATURADO}
          AND UPPER(COALESCE(pr.tipo_mix, 'SEM CLASSIFICACAO')) <> 'COMBATE'
      `),
      env.DB.prepare(`
        SELECT COALESCE(SUM(ip.valor_faturado), 0) AS total
        FROM itens_pedido ip
        JOIN pedidos pe ON pe.id = ip.pedido_id
        LEFT JOIN produtos pr ON pr.id = ip.produto_id
        WHERE ${STATUS_FATURADO}
          AND UPPER(COALESCE(pr.tipo_mix, '')) = 'PRIORITARIO'
      `),
      env.DB.prepare(`
        SELECT COALESCE(SUM(ip.valor_faturado), 0) AS total
        FROM itens_pedido ip
        JOIN pedidos pe ON pe.id = ip.pedido_id
        LEFT JOIN produtos pr ON pr.id = ip.produto_id
        WHERE ${STATUS_FATURADO}
          AND UPPER(COALESCE(pr.tipo_mix, '')) = 'LANCAMENTO'
      `),
      env.DB.prepare(`
        SELECT COUNT(DISTINCT pe.cliente_id) AS total
        FROM pedidos pe
        JOIN itens_pedido ip ON ip.pedido_id = pe.id
        LEFT JOIN produtos pr ON pr.id = ip.produto_id
        WHERE pe.cliente_id IS NOT NULL
          AND ${STATUS_FATURADO}
          AND ip.valor_faturado > 0
          AND UPPER(COALESCE(pr.tipo_mix, 'SEM CLASSIFICACAO')) <> 'COMBATE'
      `),
      env.DB.prepare('SELECT COUNT(*) AS total FROM clientes WHERE ativo = 1'),
      env.DB.prepare('SELECT COUNT(*) AS total FROM consultores WHERE ativo = 1'),
      env.DB.prepare(`
        SELECT COALESCE(SUM(ip.valor_faturado), 0) AS total
        FROM itens_pedido ip
        JOIN pedidos pe ON pe.id = ip.pedido_id
        WHERE ${STATUS_FATURADO}
      `),
      env.DB.prepare("SELECT COUNT(*) AS total FROM extracoes WHERE status = 'executando'"),
    ])

    return json({
      ol_sem_combate: Number(resultados[0]?.results?.[0]?.total || 0),
      ol_prioritarios: Number(resultados[1]?.results?.[0]?.total || 0),
      ol_lancamentos: Number(resultados[2]?.results?.[0]?.total || 0),
      clientes_com_venda: Number(resultados[3]?.results?.[0]?.total || 0),
      clientes_ativos: Number(resultados[4]?.results?.[0]?.total || 0),
      consultores_ativos: Number(resultados[5]?.results?.[0]?.total || 0),
      vendas_faturadas: Number(resultados[6]?.results?.[0]?.total || 0),
      automacoes_executando: Number(resultados[7]?.results?.[0]?.total || 0),
      atualizado_em: new Date().toISOString(),
    })
  } catch (error) {
    return json(
      {
        erro: 'Não foi possível carregar os indicadores.',
        detalhe: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}
