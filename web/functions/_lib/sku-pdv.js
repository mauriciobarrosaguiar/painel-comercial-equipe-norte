// Independent monthly query: never reads historical imports or Mercado Farma.
export const categories = ['prioritarios', 'lancamentos', 'linha', 'sem_combate', 'total']
export function monthlyQuery() {
  return `WITH carteira_bruta AS (
    SELECT REPLACE(REPLACE(REPLACE(TRIM(cnpj),'.',''),'/',''),'-','') cnpj,
      MIN(COALESCE(NULLIF(nome_fantasia,''),razao_social,cnpj)) cliente
    FROM clientes WHERE consultor_id=? AND ativo=1 AND carteira_importada=1
    GROUP BY 1
  ), carteira AS (
    SELECT * FROM carteira_bruta WHERE LENGTH(cnpj)=14 AND cnpj NOT GLOB '*[^0-9]*' AND cnpj<>'00000000000000'
  ), catalogo AS (
    SELECT TRIM(p.ean) ean,
      MAX(CASE WHEN UPPER(COALESCE(m.tipo_mix,p.tipo_mix,'')) LIKE '%PRIORIT%' THEN 1 ELSE 0 END) prioritarios,
      MAX(CASE WHEN REPLACE(UPPER(COALESCE(m.tipo_mix,p.tipo_mix,'')),'Ç','C') LIKE '%LANC%' THEN 1 ELSE 0 END) lancamentos,
      MAX(CASE WHEN UPPER(TRIM(COALESCE(m.tipo_mix,p.tipo_mix,''))) IN ('LINHA','SEM COMBATE','NAO COMBATE','NÃO COMBATE') THEN 1 ELSE 0 END) linha
    FROM produtos p LEFT JOIN produtos_mix_sap m ON m.ativo=1 AND TRIM(m.sku)=TRIM(p.sku)
    WHERE p.ativo=1 AND TRIM(COALESCE(p.ean,''))<>'' GROUP BY 1
  ), movimentos AS (
    SELECT REPLACE(REPLACE(REPLACE(TRIM(cl.cnpj),'.',''),'/',''),'-','') cnpj,
      TRIM(COALESCE(NULLIF(TRIM(ip.ean),''),pr.ean,'')) ean, SUM(ip.quantidade_faturada) quantidade
    FROM pedidos pe JOIN clientes cl ON cl.id=pe.cliente_id JOIN itens_pedido ip ON ip.pedido_id=pe.id
    LEFT JOIN produtos pr ON pr.id=ip.produto_id
    WHERE cl.consultor_id=? AND pe.consultor_id=? AND pe.origem='BUSSOLA' AND pe.ativo=1 AND ip.ativo=1
      AND UPPER(TRIM(pe.status)) IN ('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO')
      AND COALESCE(pe.data_faturamento,pe.data_pedido)>=? AND COALESCE(pe.data_faturamento,pe.data_pedido)<?
    GROUP BY 1,2
  ), contagem AS (
    SELECT v.cnpj, SUM(c.prioritarios) prioritarios,SUM(c.lancamentos) lancamentos,SUM(c.linha) linha,
      SUM(CASE WHEN c.prioritarios+c.lancamentos+c.linha>0 THEN 1 ELSE 0 END) sem_combate,COUNT(*) total
    FROM movimentos v JOIN catalogo c ON c.ean=v.ean WHERE v.quantidade>0 GROUP BY v.cnpj
  ), resultado AS (
    SELECT ca.*,COALESCE(c.prioritarios,0) prioritarios,COALESCE(c.lancamentos,0) lancamentos,
      COALESCE(c.linha,0) linha,COALESCE(c.sem_combate,0) sem_combate,COALESCE(c.total,0) total
    FROM carteira ca LEFT JOIN contagem c ON c.cnpj=ca.cnpj
  ) `
}
export function queryFilters(params) {
  const search = (params.get('busca') || '').slice(0, 150).toLocaleLowerCase('pt-BR')
  const status = params.get('situacao') || 'todos'
  const clauses = [], binds = []
  if (search) { clauses.push('(LOWER(cliente) LIKE ? OR cnpj LIKE ?)'); binds.push(`%${search}%`, `%${search.replace(/\D/g, '') || search}%`) }
  if (status === 'zerados') clauses.push('sem_combate=0')
  if (status === 'compradores') clauses.push('sem_combate>0')
  if (status === 'abaixo') clauses.push('sem_combate>0 AND sem_combate<(SELECT AVG(sem_combate) FROM resultado)')
  if (status === 'acima') clauses.push('sem_combate>0 AND sem_combate>=(SELECT AVG(sem_combate) FROM resultado)')
  const sort = [...categories, 'cnpj','cliente'].includes(params.get('ordem')) ? params.get('ordem') : 'sem_combate'
  return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', binds, order: `${sort} ${params.get('direcao') === 'desc' ? 'DESC' : 'ASC'},cnpj ASC` }
}
