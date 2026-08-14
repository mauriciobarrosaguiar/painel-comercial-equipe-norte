const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store,no-cache,must-revalidate',
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const texto = (value) => String(value ?? '').trim()

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const anoMes = texto(params.get('ano_mes')).slice(0, 7)
    const condicoes = []
    const binds = []
    if (anoMes) {
      condicoes.push('ano_mes=?')
      binds.push(anoMes)
    }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''
    const result = await env.DB.prepare(`
      SELECT id,ano_mes,escopo,referencia_id,referencia_nome,snapshot_json,fechado_em,criado_em
        FROM desafio_gigantes_fechamentos
        ${where}
       ORDER BY ano_mes DESC,CASE escopo WHEN 'gerente' THEN 0 ELSE 1 END,referencia_nome COLLATE NOCASE
       LIMIT 1000
    `).bind(...binds).all()

    const itens = (result.results || []).map((row) => {
      let snapshot = {}
      try { snapshot = JSON.parse(String(row.snapshot_json || '{}')) } catch {}
      return { ...row, snapshot }
    })
    const meses = [...new Map(itens.map((item) => [item.ano_mes, {
      ano_mes: item.ano_mes,
      fechado_em: item.fechado_em,
      registros: itens.filter((row) => row.ano_mes === item.ano_mes).length,
    }])).values()]
    return json({ meses, itens, imutavel: true })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table')) return json({ meses: [], itens: [], imutavel: true })
    return json({ erro: 'Não foi possível carregar o histórico do Desafio de Gigantes.', detalhe }, 500)
  }
}
