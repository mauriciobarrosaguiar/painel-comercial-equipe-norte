// Métricas e sugestões são calculadas apenas com compras faturadas identificadas por EAN.
// Importações de totais mensais não identificam quais medicamentos foram comprados.
const inteiro = valor => Math.max(0, Number(valor) || 0)

export function mesesReferencia(agora = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(agora).filter(item => item.type !== 'literal').map(item => [item.type, item.value]))
  const ano = Number(partes.year), mes = Number(partes.month)
  const inicio = diferenca => {
    const data = new Date(Date.UTC(ano, mes - 1 + diferenca, 1))
    return data.toISOString().slice(0, 10)
  }
  return {
    // Base: três meses completos anteriores. Mês corrente é verificado separadamente.
    inicio_3m: inicio(-3),
    inicio_6m: inicio(-6),
    inicio_mes_atual: inicio(0),
    fim_3m: new Date(new Date(`${inicio(0)}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10),
    fim: `${partes.year}-${partes.month}-${partes.day}`,
    rotulo: `${inicio(-3).slice(0, 7)} a ${inicio(-1).slice(0, 7)}`,

  }
}

export function gerarInteligencia(catalogo, compras, periodo, limite = 45) {
  const comprasPorId = new Map(compras.map(item => [String(item.id), item]))
  const produtos = catalogo.filter(produto => String(produto.ean || '').trim())
  const comprados = produtos.filter(produto => {
    const compra = comprasPorId.get(String(produto.id))
    return compra && inteiro(compra.linhas_3m) > 0
  })
  const cobertura = {
    total: produtos.length,
    comprados: comprados.length,
    nao_comprados: produtos.length - comprados.length,
    percentual: produtos.length ? Math.round(comprados.length / produtos.length * 1000) / 10 : 0,
    periodo: periodo.rotulo,
    inicio: periodo.inicio_3m,
    fim: periodo.fim_3m,
    criterio: 'Produtos ativos com EAN. Somente compras faturadas nos três meses completos anteriores, sem incluir o mês em andamento. Histórico agregado importado não identifica EANs.',
  }
  const sugestoes = []
  for (const produto of produtos) {
    const compra = comprasPorId.get(String(produto.id))
    const tres = inteiro(compra?.quantidade_3m)
    const seis = inteiro(compra?.quantidade_6m)
    const linhas3 = inteiro(compra?.linhas_3m)
    const mix = String(produto.tipo_mix || '').toUpperCase()
    const vendidoMesAtual = inteiro(compra?.quantidade_mes_atual)
    const linhasMesAtual = inteiro(compra?.linhas_mes_atual)
    let tipo, quantidade, justificativa, ordem
    if (linhas3 > 0) {
      tipo = 'REPOSICAO'
      quantidade = Math.max(1, Math.ceil(tres / 3))
      justificativa = `Comprou ${tres} un. nos 3 meses anteriores; média de ${quantidade} un./mês.`
      ordem = 1
    } else if (seis > 0) {
      tipo = 'REATIVACAO'
      quantidade = Math.max(1, Math.ceil(seis / 6))
      justificativa = `Já comprou este produto no histórico anterior, porém não faturou nos 3 últimos meses completos.`
      ordem = 0
    } else if ((mix === 'PRIORITARIO' || mix === 'LANCAMENTO') && linhasMesAtual === 0) {
      tipo = 'EXPANSAO_MIX'
      quantidade = 1
      justificativa = 'Produto do mix ainda sem compra identificada; quantidade inicial sugerida para avaliação, não previsão de demanda.'
      ordem = 2
    } else continue

    // Não recomenda novamente o que já foi faturado neste mês;
    // necessidades parcialmente atendidas ficam com o saldo restante.
    const quantidadeBase = quantidade
    const quantidadePendente = Math.max(0, quantidadeBase - vendidoMesAtual)
    if (!quantidadePendente || (tipo === 'EXPANSAO_MIX' && linhasMesAtual > 0)) continue
    justificativa += ` Em ${periodo.inicio_mes_atual.slice(0, 7)}: ${vendidoMesAtual} un. já faturadas; saldo sugerido: ${quantidadePendente} un.`

    sugestoes.push({
      id: String(produto.id), ean: String(produto.ean), produto: String(produto.descricao),
      tipo_mix: mix, tipo, quantidade_sugerida: quantidadePendente, quantidade_base: quantidadeBase,
      quantidade_mes_atual: vendidoMesAtual, ja_faturado_mes_atual: linhasMesAtual > 0, justificativa,
      quantidade_3m: tres, quantidade_6m: seis,
      ultima_compra: compra?.ultima_compra || null,
      pedidos_3m: inteiro(compra?.pedidos_3m), ordem,
    })
  }
  sugestoes.sort((a, b) => a.ordem - b.ordem || b.quantidade_3m - a.quantidade_3m || b.quantidade_6m - a.quantidade_6m || a.produto.localeCompare(b.produto, 'pt-BR'))
  return { cobertura, sugestoes: sugestoes.slice(0, limite).map(({ ordem, ...resto }) => resto) }
}
