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

// Janela móvel de três meses-calendário, incluindo o mês corrente em Brasília.
// Novembro/2026 => 01/09/2026 a 30/11/2026 (consulta antes de 01/12/2026).
export function periodoTresMesesBrasilia(agora = new Date()) {
  const atual = mesAtualBrasilia(agora)
  const ano = Number(atual.mes.slice(0, 4))
  const mes = Number(atual.mes.slice(5, 7))
  const meses = [2, 1, 0].map(recuo =>
    new Date(Date.UTC(ano, mes - 1 - recuo, 1)).toISOString().slice(0, 7))
  return { meses, mes: atual.mes, inicio: `${meses[0]}-01`, inicioMesAtual: atual.inicio, proximo: atual.proximo, divisor: 3 }
}

// Ao atualizar o Bússola, a rotina deixa os pedidos de extrações anteriores
// inativos, mas não os apaga. Para meses FECHADOS, essas linhas arquivadas
// permanecem úteis. Para o mês ABERTO, só entram pedidos/itens ativos.
// Cada item tem ID estável (ON CONFLICT UPSERT), evitando duplicação de extrações.
// Fontes como planilhas agregadas de histórico NÃO fornecem EAN e não entram.
export function sqlVendasTresMeses(uf = '') {
  const ean = `TRIM(COALESCE(NULLIF(TRIM(ip.ean),''), NULLIF(TRIM(pr.ean),''), ''))`
  const dataPedido = 'DATE(COALESCE(pe.data_faturamento,pe.data_pedido))'
  return `
    SELECT ${ean} ean,
           SUBSTR(${dataPedido},1,7) mes,
           COALESCE(SUM(ip.quantidade_faturada),0) unidades_mes,
           COALESCE(SUM(ip.valor_faturado),0) valor_mes
    FROM itens_pedido ip
    JOIN pedidos pe ON pe.id=ip.pedido_id
    JOIN clientes cl ON cl.id=pe.cliente_id
    LEFT JOIN produtos pr ON pr.id=ip.produto_id
    WHERE UPPER(TRIM(COALESCE(pe.status,''))) IN ('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO')
      AND UPPER(TRIM(COALESCE(pe.origem,'')))='BUSSOLA'
      AND pe.consultor_id=?
      AND cl.consultor_id=? AND cl.ativo=1 AND cl.carteira_importada=1
      AND ${dataPedido}>=DATE(?)
      AND ${dataPedido}<DATE(?)
      AND ((pe.ativo=1 AND ip.ativo=1)
           OR (pe.ativo=0 AND ip.ativo=0 AND ${dataPedido}<DATE(?)))
      ${uf ? "AND UPPER(TRIM(COALESCE(cl.uf,'')))=?" : ''}
      AND ${ean}<>''
    GROUP BY ${ean},SUBSTR(${dataPedido},1,7)
  `
}

// Identifica a presença de registros nos meses da janela. Não interpreta
// ausência de extração como 'zero vendas' sem avisar ao usuário.
export function sqlCoberturaTresMeses(uf = '') {
  const dataPedido = 'DATE(COALESCE(pe.data_faturamento,pe.data_pedido))'
  return `
    SELECT SUBSTR(${dataPedido},1,7) mes, COUNT(DISTINCT pe.id) pedidos
    FROM pedidos pe
    JOIN clientes cl ON cl.id=pe.cliente_id
    WHERE UPPER(TRIM(COALESCE(pe.origem,'')))='BUSSOLA'
      AND pe.consultor_id=?
      AND cl.consultor_id=? AND cl.ativo=1 AND cl.carteira_importada=1
      AND ${dataPedido}>=DATE(?) AND ${dataPedido}<DATE(?)
      AND (pe.ativo=1 OR (pe.ativo=0 AND ${dataPedido}<DATE(?)))
      ${uf ? "AND UPPER(TRIM(COALESCE(cl.uf,'')))=?" : ''}
    GROUP BY SUBSTR(${dataPedido},1,7)
  `
}

// Mantém ranking por EAN, mesmo com várias distribuidoras; só aplica Top 20/50
// depois dos demais filtros. O divisor é SEMPRE três meses, inclusive o corrente
// parcial: médias comparáveis e sem inflar produtos vendidos só em um mês.
export function aplicarRankingVendas(rows, vendas, filtro, periodo = periodoTresMesesBrasilia()) {
  if (!filtro) return rows
  const somas = new Map()
  for (const item of vendas || []) {
    const ean = String(item.ean || '').trim()
    const mes = String(item.mes || '')
    if (!ean || !periodo.meses.includes(mes)) continue
    if (!somas.has(ean)) somas.set(ean, new Map())
    const mensal = somas.get(ean)
    const anterior = mensal.get(mes) || { unidades: 0, valor: 0 }
    mensal.set(mes, {
      unidades: anterior.unidades + Number(item.unidades_mes || 0),
      valor: anterior.valor + Number(item.valor_mes || 0),
    })
  }
  const indicadores = new Map([...somas].map(([ean, mensal]) => {
    const vendasPorMes = periodo.meses.map(mes => ({ mes, ...(mensal.get(mes) || { unidades: 0, valor: 0 }) }))
    const unidadesPeriodo = vendasPorMes.reduce((acc, item) => acc + item.unidades, 0)
    const valorPeriodo = vendasPorMes.reduce((acc, item) => acc + item.valor, 0)
    return [ean, {
      unidades_periodo: unidadesPeriodo,
      valor_periodo: valorPeriodo,
      unidades_media_mensal: unidadesPeriodo / 3,
      valor_media_mensal: valorPeriodo / 3,
      vendas_por_mes: vendasPorMes,
    }]
  }))
  const elegiveis = [...new Set(rows.map(item => String(item.ean || '').trim()))]
    .filter(ean => (indicadores.get(ean)?.unidades_periodo || 0) > 0)
    .sort((a, b) => {
      const aa = indicadores.get(a)
      const bb = indicadores.get(b)
      const principal = filtro === 'TOP20_VALOR'
        ? bb.valor_media_mensal - aa.valor_media_mensal
        : bb.unidades_media_mensal - aa.unidades_media_mensal
      return principal ||
        (bb.unidades_media_mensal - aa.unidades_media_mensal) ||
        (bb.valor_media_mensal - aa.valor_media_mensal) || a.localeCompare(b)
    })
  const maximo = filtro === 'TOP20' || filtro === 'TOP20_VALOR' ? 20 : filtro === 'TOP50' ? 50 : elegiveis.length
  const ranking = new Map(elegiveis.slice(0, maximo).map((ean, index) => [ean, index + 1]))
  return rows.filter(row => ranking.has(String(row.ean || '').trim()))
    .map(row => ({
      ...row,
      ...indicadores.get(String(row.ean || '').trim()),
      ranking_mes: ranking.get(String(row.ean || '').trim()), // campo legado; posição da média dos 3 meses
    }))
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
