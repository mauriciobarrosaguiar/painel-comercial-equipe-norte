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
    inicio_3m: inicio(-2),
    inicio_6m: inicio(-5),
    fim: `${partes.year}-${partes.month}-${partes.day}`,
    rotulo: `${inicio(-2).slice(0, 7)} a ${partes.year}-${partes.month}`,
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
    fim: periodo.fim,
    criterio: 'Produtos ativos com EAN. Compras faturadas e itens ativos dos três meses-calendário (inclui o atual). Histórico agregado importado não identifica EANs.',
  }
  const sugestoes = []
  for (const produto of produtos) {
    const compra = comprasPorId.get(String(produto.id))
    const tres = inteiro(compra?.quantidade_3m)
    const seis = inteiro(compra?.quantidade_6m)
    const linhas3 = inteiro(compra?.linhas_3m)
    const mix = String(produto.tipo_mix || '').toUpperCase()
    let tipo, quantidade, justificativa, ordem
    if (linhas3 > 0) {
      tipo = 'REPOSICAO'
      quantidade = Math.max(1, Math.ceil(tres / 3))
      justificativa = `Comprou ${tres} un. nos últimos 3 meses; sugestão de aproximadamente 1 mês de giro.`
      ordem = 1
    } else if (seis > 0) {
      tipo = 'REATIVACAO'
      quantidade = Math.max(1, Math.ceil(seis / 6))
      justificativa = `Comprava anteriormente, mas não faturou este produto nos últimos 3 meses.`
      ordem = 0
    } else if (mix === 'PRIORITARIO' || mix === 'LANCAMENTO') {
      tipo = 'EXPANSAO_MIX'
      quantidade = 1
      justificativa = 'Produto do mix ainda sem compra identificada; quantidade inicial sugerida para avaliação, não previsão de demanda.'
      ordem = 2
    } else continue

    sugestoes.push({
      id: String(produto.id), ean: String(produto.ean), produto: String(produto.descricao),
      tipo_mix: mix, tipo, quantidade_sugerida: quantidade, justificativa,
      quantidade_3m: tres, quantidade_6m: seis,
      ultima_compra: compra?.ultima_compra || null,
      pedidos_3m: inteiro(compra?.pedidos_3m), ordem,
    })
  }
  sugestoes.sort((a, b) => a.ordem - b.ordem || b.quantidade_3m - a.quantidade_3m || b.quantidade_6m - a.quantidade_6m || a.produto.localeCompare(b.produto, 'pt-BR'))
  return { cobertura, sugestoes: sugestoes.slice(0, limite).map(({ ordem, ...resto }) => resto) }
}
