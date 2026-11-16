import { readSession, json } from '../../_lib/credentials.js'

// Pesquisa leve e autenticada: não carrega vendas nem fichas para montar o seletor.
export async function onRequestGet({ request, env }) {
  const session = await readSession(request, env.PAINEL_ADMIN_KEY)
  if (!session?.consultor_id) return json({ erro: 'Entre com seu usuário para pesquisar os PDVs.' }, 401)
  try {
    const params = new URL(request.url).searchParams
    const busca = String(params.get('busca') || '').trim().slice(0, 160)
    if (busca.length < 2) return json({ pdvs: [], total: 0, truncado: false })
    const uf = String(params.get('uf') || '').trim().toUpperCase()
    if (uf && !/^[A-Z]{2}$/.test(uf)) return json({ erro: 'UF inválida.' }, 400)
    const cidade = String(params.get('cidade') || '').trim().slice(0, 120)
    const termo = `%${busca}%`
    const digits = busca.replace(/\D/g, '')
    const where = ["cl.consultor_id=?", "cl.ativo=1", "cl.carteira_importada=1",
      "(UPPER(COALESCE(cl.nome_fantasia,'')) LIKE UPPER(?) OR UPPER(COALESCE(cl.razao_social,'')) LIKE UPPER(?) OR COALESCE(cl.cnpj,'') LIKE ? OR UPPER(COALESCE(cl.cidade,'')) LIKE UPPER(?))"]
    const binds = [session.consultor_id, termo, termo, digits ? `%${digits}%` : '-SEM-CNPJ-', termo]
    if (uf) { where.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?"); binds.push(uf) }
    if (cidade) { where.push("UPPER(TRIM(COALESCE(cl.cidade,'')))=UPPER(?)"); binds.push(cidade) }
    const result = await env.DB.prepare(`
      SELECT cl.cnpj, COALESCE(NULLIF(TRIM(cl.nome_fantasia),''), NULLIF(TRIM(cl.razao_social),''),cl.cnpj) nome,
             COALESCE(cl.cidade,'') cidade, UPPER(TRIM(COALESCE(cl.uf,''))) uf
      FROM clientes cl WHERE ${where.join(' AND ')}
      ORDER BY nome COLLATE NOCASE, cl.cnpj
      LIMIT 501
    `).bind(...binds).all()
    const seen = new Set()
    const pdvs = []
    for (const row of result.results || []) {
      const cnpj = String(row.cnpj || '').replace(/\D/g, '')
      if (!/^\d{14}$/.test(cnpj) || seen.has(cnpj)) continue
      seen.add(cnpj)
      pdvs.push({ cnpj, nome: String(row.nome || cnpj), cidade: String(row.cidade || ''), uf: String(row.uf || '') })
    }
    return json({ pdvs: pdvs.slice(0, 500), total: pdvs.length, truncado: pdvs.length > 500 })
  } catch (error) {
    return json({ erro: 'Erro ao pesquisar PDVs.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
