import { mesesReferencia } from './client-insights.js'

// O mês em aberto nunca usa totais de planilha como substituto da extração.
// Ausência de itens faturados no Bússola significa zero no mês, sem fallback.
export function historicoCliente(importados, bussola, agora = new Date()) {
  const mesAtual = mesesReferencia(agora).fim.slice(0, 7)
  const meses = new Map()
  for (const item of importados) {
    if (item.ano_mes < mesAtual) meses.set(item.ano_mes, { ...item, origem: 'IMPORTADO' })
  }
  for (const item of bussola) {
    if (item.ano_mes <= mesAtual) meses.set(item.ano_mes, { ...item, origem: 'BUSSOLA' })
  }
  if (!meses.has(mesAtual)) {
    meses.set(mesAtual, { ano_mes: mesAtual, faturamento: 0, pedidos: 0, produtos: 0, quantidade: 0, origem: 'BUSSOLA' })
  }
  return [...meses.values()]
    .sort((a, b) => String(a.ano_mes).localeCompare(String(b.ano_mes)))
    .map(item => ({ ...item,
      faturamento: Number(item.faturamento || 0), pedidos: Number(item.pedidos || 0),
      produtos: Number(item.produtos || 0), quantidade: Number(item.quantidade || 0),
    }))
}
