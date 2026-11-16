import { ITEM_FATURADO } from './commercial.js'

// É a classificação comercial já existente, independente da classificação sanitária.
export const MIX = Object.freeze(['PRIORITARIO', 'LANCAMENTO', 'COMBATE', 'LINHA'])
export const FILTROS_VENDA = Object.freeze(['TOP20', 'TOP50', 'VENDIDOS', 'TOP20_VALOR'])

// Usa o MIX vigente do SAP e, se ausente, o mix da apresentação cadastrada.
// Escopo é EAN: não reclassifica o medicamento a partir do nome.
export const MIX_POR_EAN = `COALESCE((
  SELECT UPPER(TRIM(COALESCE(NULLIF(m.tipo_mix,''), NULLIF(p.tipo_mix,''), 'SEM CLASSIFICACAO')))
  FROM produtos p
  LEFT JOIN produtos_mix_sap m ON m.ativo=1 AND TRIM(m.sku)=TRIM(COALESCE(p.sku,''))
  WHERE p.ativo=1 AND TRIM(COALESCE(p.ean,''))=TRIM(COALESCE(mercado_farma_precos.ean,''))
  LIMIT 1
), 'SEM CLASSIFICACAO')`

export const validarMix = raw => {
  const item = String(raw ?? '').trim().toUpperCase()
  return MIX.includes(item) ? item : null
}
export const validarRanking = raw => {
  const item = String(raw ?? '').trim().toUpperCase()
  return FILTROS_VENDA.includes(item) ? item : null
}

export function mesAtualBrasilia(agora = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(agora).map(part => [part.type, part.value]))
  const ano = Number(partes.year)
  const mes = Number(partes.month)
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`
  const proximo = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10)
  return { mes: inicio.slice(0, 7), inicio, proximo }
}

// As vendas vêm somente do Bússola no mês vigente, em unidades líquidas
// faturadas (devoluções podem ter quantidades negativas). Não usa o histórico
// importado e não mede vendas do varejo ao consumidor.
export function sqlVendasMes(uf = '') {
  const ean = `TRIM(COALESCE(NULLIF(TRIM(ip.ean),''), NULLIF(TRIM(pr.ean),''), ''))`
  return `
    SELECT ${ean} ean,
           COALESCE(SUM(ip.quantidade_faturada),0) unidades_mes,
           COALESCE(SUM(ip.valor_faturado),0) valor_mes
    FROM itens_pedido ip
    JOIN pedidos pe ON pe.id=ip.pedido_id
    JOIN clientes cl ON cl.id=pe.cliente_id
    LEFT JOIN produtos pr ON pr.id=ip.produto_id
    WHERE ${ITEM_FATURADO}
      AND UPPER(TRIM(COALESCE(pe.origem,'')))='BUSSOLA'
      AND pe.consultor_id=?
      AND cl.consultor_id=? AND cl.ativo=1 AND cl.carteira_importada=1
      AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido))>=DATE(?)
      AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido))<DATE(?)
      ${uf ? "AND UPPER(TRIM(COALESCE(cl.uf,'')))=?" : ''}
      AND ${ean}<>''
    GROUP BY ${ean}
    HAVING COALESCE(SUM(ip.quantidade_faturada),0)>0
  `
}

// Limita produtos distintos após a combinação dos filtros sanitário, MIX,
// distribuidora, UF, pesquisa e estoque: Top 20 é realmente Top 20 dos elegíveis.
export function aplicarRankingVendas(rows, vendas, filtro) {
  if (!filtro) return rows
  const mapa = new Map((vendas || []).map(item => [
    String(item.ean || '').trim(),
    { unidades_mes: Number(item.unidades_mes || 0), valor_mes: Number(item.valor_mes || 0) },
  ]))
  const unicos = [...new Set(rows.map(item => String(item.ean || '').trim()))]
    .filter(ean => (mapa.get(ean)?.unidades_mes || 0) > 0)
    .sort((a, b) => {
      const aa = mapa.get(a), bb = mapa.get(b)
      const principal = filtro === 'TOP20_VALOR'
        ? bb.valor_mes - aa.valor_mes
        : bb.unidades_mes - aa.unidades_mes
      return principal || (bb.unidades_mes - aa.unidades_mes) || (bb.valor_mes - aa.valor_mes) || a.localeCompare(b)
    })
  const maximo = filtro === 'TOP20' || filtro === 'TOP20_VALOR' ? 20 : filtro === 'TOP50' ? 50 : unicos.length
  const selecionados = unicos.slice(0, maximo)
  const ranks = new Map(selecionados.map((ean, index) => [ean, index + 1]))
  return rows.filter(item => ranks.has(String(item.ean || '').trim()))
    .map(item => ({ ...item, ...mapa.get(String(item.ean || '').trim()), ranking_mes: ranks.get(String(item.ean || '').trim()) }))
    .sort((a, b) => a.ranking_mes - b.ranking_mes || a.produto.localeCompare(b.produto) || a.uf.localeCompare(b.uf))
}

export function resumoDasOfertas(rows) {
  return {
    registros: rows.length,
    produtos: new Set(rows.map(row => row.ean)).size,
    ufs: new Set(rows.map(row => row.uf)).size,
    distribuidoras: new Set(rows.map(row => row.distribuidora)).size,
    com_estoque: rows.filter(row => Number(row.estoque) > 0).length,
  }
}
