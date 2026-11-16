import { json, readSession } from '../../_lib/credentials.js'

export async function onRequestGet({ request, env }) {
  try {
    const session = await readSession(request, env.PAINEL_ADMIN_KEY)
    if (!session?.consultor_id) return json({ erro: 'Entre no painel para consultar ofertas.' }, 401)
    const params = new URL(request.url).searchParams
    const id = String(params.get('id') || '').trim()
    const eans = [...new Set(String(params.get('eans') || '').split(',').filter(Boolean))]
    if (!id || id.length > 128 || eans.length > 40 || eans.some(ean => !/^\d{1,14}$/.test(ean))) {
      return json({ erro: 'Cliente ou produtos inválidos.' }, 400)
    }
    const cliente = await env.DB.prepare(`
      SELECT id,cnpj,UPPER(TRIM(COALESCE(uf,''))) uf
      FROM clientes WHERE id=? AND consultor_id=? AND carteira_importada=1 AND ativo=1 LIMIT 1
    `).bind(id, session.consultor_id).first()
    if (!cliente) return json({ erro: 'Cliente não encontrado na sua carteira ativa.' }, 404)
    if (!/^[A-Z]{2}$/.test(cliente.uf)) return json({ erro: 'Cadastre uma UF válida para este cliente antes de consultar preços.' }, 422)
    const result = eans.length ? await env.DB.prepare(`
      SELECT mf.ean,mf.uf,TRIM(mf.distribuidora) distribuidora,mf.estoque,
        CASE WHEN COALESCE(mf.preco_com_imposto,0)>0 THEN mf.preco_com_imposto ELSE mf.preco_sem_imposto END preco,
        mf.atualizado_em
      FROM mercado_farma_precos mf
      WHERE UPPER(TRIM(mf.uf))=? AND mf.ean IN (${eans.map(() => '?').join(',')})
        AND COALESCE(mf.estoque,0)>=1 AND TRIM(COALESCE(mf.distribuidora,''))<>''
        AND (COALESCE(mf.preco_com_imposto,0)>0 OR COALESCE(mf.preco_sem_imposto,0)>0)
        AND UPPER(TRIM(COALESCE(mf.status,'OK')))='OK'
        AND EXISTS(SELECT 1 FROM produtos pr WHERE pr.ean=mf.ean AND pr.ativo=1)
      ORDER BY preco ASC,mf.estoque DESC,mf.distribuidora COLLATE NOCASE
    `).bind(cliente.uf, ...eans).all() : { results: [] }
    return json({
      cliente: { ...cliente, cnpj: String(cliente.cnpj).replace(/\D/g, '') },
      ofertas: (result.results || []).map(row => ({ ...row, uf: cliente.uf, preco: Number(row.preco), estoque: Math.floor(Number(row.estoque)) })),
    })
  } catch {
    return json({ erro: 'Não foi possível consultar os preços das oportunidades. Tente novamente.' }, 503)
  }
}
