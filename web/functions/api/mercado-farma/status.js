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
        SELECT
          COUNT(*) AS registros,
          COUNT(DISTINCT uf) AS ufs,
          COUNT(DISTINCT ean) AS produtos,
          MAX(atualizado_em) AS atualizado_em
        FROM mercado_farma_precos
      `),
      env.DB.prepare(`
        SELECT status, total_registros, mensagem, erro, iniciado_em, finalizado_em
        FROM extracoes
        WHERE tipo = 'MERCADO_FARMA'
        ORDER BY criado_em DESC
        LIMIT 1
      `),
      env.DB.prepare(`
        SELECT uf, COUNT(*) AS registros, COUNT(DISTINCT ean) AS produtos
        FROM mercado_farma_precos
        GROUP BY uf
        ORDER BY uf
      `),
    ])

    const resumo = resultados[0]?.results?.[0] || {}
    const ultimaExtracao = resultados[1]?.results?.[0] || null
    const porUf = resultados[2]?.results || []

    return json({
      status: 'ok',
      database: 'ok',
      registros: Number(resumo.registros || 0),
      ufs: Number(resumo.ufs || 0),
      produtos: Number(resumo.produtos || 0),
      atualizado_em: resumo.atualizado_em || null,
      ultima_extracao: ultimaExtracao,
      por_uf: porUf.map((item) => ({
        uf: item.uf,
        registros: Number(item.registros || 0),
        produtos: Number(item.produtos || 0),
      })),
    })
  } catch (error) {
    return json(
      {
        status: 'erro',
        database: 'indisponivel',
        detalhe: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}
