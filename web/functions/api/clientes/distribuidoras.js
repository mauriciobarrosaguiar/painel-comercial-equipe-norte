import { readSession } from '../../_lib/credentials.js'

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private,no-store' },
})

// Consulta apenas nome de distribuidora e UFs atendidas pela carteira do usuário.
// Não devolve preços, estoque, CNPJ referencial nem informações de outras carteiras.
export async function onRequestGet({request,env}) {
  const session = await readSession(request,env.PAINEL_ADMIN_KEY)
  if (!session?.consultor_id) return json({erro:'Acesse sua carteira para consultar distribuidoras.'},401)
  try {
    const uf = String(new URL(request.url).searchParams.get('uf') || '').trim().toUpperCase()
    if (uf && !/^[A-Z]{2}$/.test(uf)) return json({erro:'UF inválida.'},400)
    const rows = await env.DB.prepare(`
      SELECT TRIM(m.distribuidora) nome,
             GROUP_CONCAT(DISTINCT UPPER(TRIM(m.uf))) ufs
      FROM mercado_farma_precos m
      WHERE TRIM(COALESCE(m.distribuidora,''))<>''
        AND TRIM(COALESCE(m.ean,''))<>''
        AND (?='' OR UPPER(TRIM(m.uf))=?)
        AND EXISTS (
          SELECT 1 FROM clientes cl
          WHERE cl.consultor_id=? AND cl.ativo=1 AND cl.carteira_importada=1
            AND UPPER(TRIM(cl.uf))=UPPER(TRIM(m.uf))
        )
      GROUP BY TRIM(m.distribuidora)
      ORDER BY nome COLLATE NOCASE
    `).bind(uf,uf,session.consultor_id).all()
    return json({ distribuidoras: (rows.results || []).map(row=>({
      nome:String(row.nome || ''), ufs:String(row.ufs || '').split(',').filter(Boolean),
    })) })
  } catch(error) {
    return json({erro:'Não foi possível carregar as distribuidoras.',detalhe:error instanceof Error?error.message:String(error)},500)
  }
}
