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

export async function onRequestGet({ env }) {
  try {
    const resultados = await env.DB.batch([
      env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM itens_pedido ip
        LEFT JOIN produtos p ON p.id = ip.produto_id
        WHERE UPPER(COALESCE(p.tipo_mix, '')) LIKE '%SEM COMBATE%'
      `),
      env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM itens_pedido ip
        LEFT JOIN produtos p ON p.id = ip.produto_id
        WHERE UPPER(COALESCE(p.tipo_mix, '')) LIKE '%PRIORIT%'
      `),
      env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM itens_pedido ip
        LEFT JOIN produtos p ON p.id = ip.produto_id
        WHERE UPPER(COALESCE(p.tipo_mix, '')) LIKE '%LANC%'
      `),
      env.DB.prepare(`
        SELECT COUNT(DISTINCT cliente_id) AS total
        FROM pedidos
        WHERE cliente_id IS NOT NULL AND valor_faturado > 0
      `),
      env.DB.prepare('SELECT COUNT(*) AS total FROM clientes WHERE ativo = 1'),
      env.DB.prepare('SELECT COUNT(*) AS total FROM consultores WHERE ativo = 1'),
      env.DB.prepare('SELECT COALESCE(SUM(valor_faturado), 0) AS total FROM pedidos'),
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
