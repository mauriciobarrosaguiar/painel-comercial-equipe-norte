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
    const database = await env.DB.prepare('SELECT 1 AS ok').first()
    const tabelas = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).first()

    return json({
      status: 'ok',
      app: 'Painel Comercial Equipe Norte',
      database: Number(database?.ok || 0) === 1 ? 'ok' : 'erro',
      tabelas: Number(tabelas?.total || 0),
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return json(
      {
        status: 'parcial',
        app: 'Painel Comercial Equipe Norte',
        database: 'indisponivel',
        detalhe: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      503,
    )
  }
}
