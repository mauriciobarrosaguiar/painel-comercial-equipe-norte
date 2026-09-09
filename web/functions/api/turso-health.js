import { createTursoD1 } from '../_lib/turso-d1.js'

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

export async function onRequestGet({ env }) {
  try {
    const db = createTursoD1(env)
    const results = await db.batch([
      db.prepare('SELECT 1 AS ok'),
      db.prepare("SELECT COUNT(*) total FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"),
      db.prepare('SELECT COUNT(*) total FROM clientes'),
      db.prepare('SELECT COUNT(*) total FROM pedidos'),
      db.prepare('SELECT COUNT(*) total FROM itens_pedido'),
      db.prepare('SELECT COUNT(*) total FROM produtos'),
    ])

    return json({
      ok: Number(results[0]?.results?.[0]?.ok || 0) === 1,
      backend: 'turso',
      tabelas: Number(results[1]?.results?.[0]?.total || 0),
      clientes: Number(results[2]?.results?.[0]?.total || 0),
      pedidos: Number(results[3]?.results?.[0]?.total || 0),
      itens_pedido: Number(results[4]?.results?.[0]?.total || 0),
      produtos: Number(results[5]?.results?.[0]?.total || 0),
    })
  } catch (error) {
    return json({
      ok: false,
      backend: 'turso',
      erro: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
