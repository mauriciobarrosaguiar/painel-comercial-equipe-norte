// Escopo SIP: as UFs são derivadas exclusivamente dos clientes ativos vinculados.
// Nunca aceitar uma lista de UFs ou CNPJs enviada pelo navegador para liberar preços.
const texto = (valor) => String(valor ?? '').trim()

export async function ufsVinculadasSip(db, sipId) {
  const resultado = await db.prepare(
    'SELECT DISTINCT UPPER(TRIM(cl.uf)) uf ' +
    'FROM sip_clientes sc JOIN clientes cl ' +
    'ON cl.cnpj=sc.cnpj AND cl.carteira_importada=1 AND cl.ativo=1 ' +
    'WHERE sc.sip_id=? AND sc.ativo=1 ' +
    'ORDER BY uf'
  ).bind(sipId).all()
  return (resultado.results || [])
    .map((item) => texto(item.uf).toUpperCase())
    .filter((uf) => /^[A-Z]{2}$/.test(uf))
}

export async function resumoPrecosSip(db, ufs) {
  if (!ufs.length) return { ufs: [], por_uf: [], registros: 0, atualizado_em: null }
  const marcadores = ufs.map(() => '?').join(',')
  const resultado = await db.prepare(
    'SELECT UPPER(TRIM(uf)) uf, COUNT(*) registros, ' +
    'MAX(NULLIF(TRIM(atualizado_em), \'\')) atualizado_em ' +
    'FROM mercado_farma_precos ' +
    'WHERE UPPER(TRIM(uf)) IN (' + marcadores + ') ' +
    'GROUP BY UPPER(TRIM(uf)) ORDER BY uf'
  ).bind(...ufs).all()
  const porUf = new Map((resultado.results || []).map((item) => [item.uf, item]))
  const registros = ufs.map((uf) => ({
    uf,
    registros: Number(porUf.get(uf)?.registros || 0),
    atualizado_em: porUf.get(uf)?.atualizado_em || null,
  }))
  return {
    ufs,
    por_uf: registros,
    registros: registros.reduce((total, item) => total + item.registros, 0),
    atualizado_em: registros.map((item) => item.atualizado_em).filter(Boolean).sort().at(-1) || null,
  }
}
