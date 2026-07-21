import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../_lib/commercial.js'

const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
}
const PERIODOS = new Set(['mes-atual', 'mes-anterior', 'todo-periodo', 'personalizado'])
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const mostrar = (v) => v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : ''
const numero = (valor) => Number.isFinite(Number(valor)) ? Number(valor) : 0

function hojeSaoPaulo() {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((parte) => [parte.type, parte.value]))
  return `${partes.year}-${partes.month}-${partes.day}`
}

function limitesMes(offset = 0) {
  const hoje = hojeSaoPaulo().split('-').map(Number)
  let ano = hoje[0]
  let mes = hoje[1] + offset
  while (mes < 1) { mes += 12; ano -= 1 }
  while (mes > 12) { mes -= 12; ano += 1 }
  return { inicio: iso(ano, mes, 1), fim: iso(ano, mes, new Date(Date.UTC(ano, mes, 0)).getUTCDate()) }
}

function deslocarDia(data, dias) {
  const valor = new Date(`${data}T12:00:00Z`)
  valor.setUTCDate(valor.getUTCDate() + dias)
  return valor.toISOString().slice(0, 10)
}

function diferencaDias(inicio, fim) {
  if (!inicio || !fim) return null
  const a = new Date(`${inicio}T12:00:00Z`).getTime()
  const b = new Date(`${fim}T12:00:00Z`).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, Math.floor((b - a) / 86400000))
}

function periodo(params) {
  const tipo = PERIODOS.has(params.get('periodo')) ? params.get('periodo') : 'mes-atual'
  if (tipo === 'todo-periodo') return { tipo, inicio: null, fim: null, anteriorInicio: null, anteriorFim: null }

  let inicio = params.get('inicio') || ''
  let fim = params.get('fim') || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    if (tipo === 'personalizado') throw new Error('Informe uma data inicial e uma data final válidas.')
    const limites = limitesMes(tipo === 'mes-anterior' ? -1 : 0)
    inicio = limites.inicio
    fim = limites.fim
  }
  if (inicio > fim) throw new Error('A data inicial não pode ser posterior à data final.')

  const duracao = diferencaDias(inicio, fim) + 1
  const anteriorFim = deslocarDia(inicio, -1)
  const anteriorInicio = deslocarDia(anteriorFim, -(duracao - 1))
  return { tipo, inicio, fim, anteriorInicio, anteriorFim }
}

function prioridade(cliente, referencia) {
  const atual = numero(cliente.faturamento_atual)
  const anterior = numero(cliente.faturamento_anterior)
  const dias = diferencaDias(cliente.ultima_compra, referencia)
  const prioritarios = numero(cliente.produtos_prioritarios)
  const lancamentos = numero(cliente.produtos_lancamentos)

  if (atual <= 0 && anterior > 0) return { codigo: 'CRITICA', ordem: 1, motivo: 'Comprou no período anterior e ainda não comprou no período atual.' }
  if (atual <= 0 && dias !== null && dias >= 45) return { codigo: 'CRITICA', ordem: 1, motivo: `Está há ${dias} dias sem comprar.` }
  if (atual <= 0 && cliente.ultima_compra) return { codigo: 'ALTA', ordem: 2, motivo: 'Cliente ativo sem faturamento no período.' }
  if (atual <= 0) return { codigo: 'NOVO', ordem: 5, motivo: 'Cliente ativo ainda sem histórico de faturamento.' }
  if (anterior > 0 && atual < anterior * 0.5) return { codigo: 'ALTA', ordem: 2, motivo: 'Queda de faturamento superior a 50%.' }
  if (prioritarios <= 0 && lancamentos <= 0) return { codigo: 'ALTA', ordem: 2, motivo: 'Sem compra de prioritários e lançamentos no período.' }
  if (anterior > 0 && atual < anterior * 0.85) return { codigo: 'MEDIA', ordem: 3, motivo: 'Faturamento abaixo do período anterior.' }
  if (prioritarios <= 0 || lancamentos <= 0) return { codigo: 'MEDIA', ordem: 3, motivo: prioritarios <= 0 ? 'Sem produtos prioritários no período.' : 'Sem lançamentos no período.' }
  return { codigo: 'BAIXA', ordem: 4, motivo: 'Cliente positivado e sem alerta comercial urgente.' }
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const faixa = periodo(params)
    const consultor = String(params.get('consultor') || '').trim().slice(0, 180)
    const uf = String(params.get('uf') || '').trim().toUpperCase().slice(0, 2)
    const cidade = String(params.get('cidade') || '').trim().slice(0, 120)
    const busca = String(params.get('busca') || '').trim().slice(0, 160)
    const filtroPrioridade = String(params.get('prioridade') || '').trim().toUpperCase()
    const ordenacao = String(params.get('ordenar') || 'prioridade').trim()
    const limite = Math.min(500, Math.max(10, Number(params.get('limite') || 100)))
    const pagina = Math.max(1, Number(params.get('pagina') || 1))

    const atualCond = faixa.inicio
      ? `DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE('${faixa.inicio}') AND DATE('${faixa.fim}')`
      : '1=1'
    const anteriorCond = faixa.anteriorInicio
      ? `DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE('${faixa.anteriorInicio}') AND DATE('${faixa.anteriorFim}')`
      : '0=1'

    const where = ['cl.carteira_importada=1', 'cl.ativo=1']
    const binds = []
    if (consultor) { where.push('cl.consultor_id=?'); binds.push(consultor) }
    if (uf) { where.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?"); binds.push(uf) }
    if (cidade) { where.push("UPPER(TRIM(COALESCE(cl.cidade,'')))=UPPER(?)"); binds.push(cidade) }
    if (busca) {
      where.push("(UPPER(COALESCE(cl.nome_fantasia,'')) LIKE UPPER(?) OR COALESCE(cl.cnpj,'') LIKE ? OR UPPER(COALESCE(cl.cidade,'')) LIKE UPPER(?))")
      const termo = `%${busca}%`
      binds.push(termo, termo.replace(/\D/g, ''), termo)
    }

    const sql = `
      WITH vendas AS (
        SELECT
          pe.cliente_id,
          SUM(CASE WHEN ${atualCond} THEN COALESCE(ip.valor_faturado,0) ELSE 0 END) AS faturamento_atual,
          SUM(CASE WHEN ${anteriorCond} THEN COALESCE(ip.valor_faturado,0) ELSE 0 END) AS faturamento_anterior,
          COUNT(DISTINCT CASE WHEN ${atualCond} AND COALESCE(ip.valor_faturado,0)>0 THEN pe.id END) AS pedidos_atual,
          COUNT(DISTINCT CASE WHEN ${atualCond} AND COALESCE(ip.valor_faturado,0)>0 THEN ip.produto_id END) AS produtos_comprados,
          COUNT(DISTINCT CASE WHEN ${atualCond} AND UPPER(COALESCE(pr.tipo_mix,''))='PRIORITARIO' AND COALESCE(ip.valor_faturado,0)>0 THEN ip.produto_id END) AS produtos_prioritarios,
          COUNT(DISTINCT CASE WHEN ${atualCond} AND UPPER(COALESCE(pr.tipo_mix,''))='LANCAMENTO' AND COALESCE(ip.valor_faturado,0)>0 THEN ip.produto_id END) AS produtos_lancamentos,
          SUM(CASE WHEN ${atualCond} AND ${MIX_SEM_COMBATE} THEN COALESCE(ip.valor_faturado,0) ELSE 0 END) AS ol_sem_combate,
          MAX(CASE WHEN COALESCE(ip.valor_faturado,0)>0 THEN DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) END) AS ultima_compra
        FROM pedidos pe
        JOIN itens_pedido ip ON ip.pedido_id=pe.id
        LEFT JOIN produtos pr ON pr.id=ip.produto_id
        WHERE ${ITEM_FATURADO}
        GROUP BY pe.cliente_id
      )
      SELECT
        cl.id, cl.cnpj, COALESCE(cl.nome_fantasia,cl.razao_social,'Cliente sem nome') AS nome,
        COALESCE(cl.cidade,'') AS cidade, COALESCE(cl.uf,'') AS uf,
        COALESCE(cl.nome_gd,'') AS gd, COALESCE(co.nome,'') AS consultor,
        COALESCE(cl.grupo_economico,'') AS grupo_economico,
        COALESCE(cl.rede_associacao,'') AS rede_associacao,
        COALESCE(v.faturamento_atual,0) AS faturamento_atual,
        COALESCE(v.faturamento_anterior,0) AS faturamento_anterior,
        COALESCE(v.pedidos_atual,0) AS pedidos_atual,
        COALESCE(v.produtos_comprados,0) AS produtos_comprados,
        COALESCE(v.produtos_prioritarios,0) AS produtos_prioritarios,
        COALESCE(v.produtos_lancamentos,0) AS produtos_lancamentos,
        COALESCE(v.ol_sem_combate,0) AS ol_sem_combate,
        v.ultima_compra
      FROM clientes cl
      LEFT JOIN consultores co ON co.id=cl.consultor_id
      LEFT JOIN vendas v ON v.cliente_id=cl.id
      WHERE ${where.join(' AND ')}
    `

    const resultado = await env.DB.prepare(sql).bind(...binds).all()
    const referencia = faixa.fim || hojeSaoPaulo()
    let clientes = (resultado.results || []).map((item) => {
      const classificacao = prioridade(item, referencia)
      const faturamentoAtual = numero(item.faturamento_atual)
      const faturamentoAnterior = numero(item.faturamento_anterior)
      const pedidos = numero(item.pedidos_atual)
      return {
        ...item,
        faturamento_atual: faturamentoAtual,
        faturamento_anterior: faturamentoAnterior,
        variacao_percentual: faturamentoAnterior > 0 ? ((faturamentoAtual - faturamentoAnterior) / faturamentoAnterior) * 100 : (faturamentoAtual > 0 ? 100 : 0),
        pedidos_atual: pedidos,
        ticket_medio: pedidos > 0 ? faturamentoAtual / pedidos : 0,
        produtos_comprados: numero(item.produtos_comprados),
        produtos_prioritarios: numero(item.produtos_prioritarios),
        produtos_lancamentos: numero(item.produtos_lancamentos),
        ol_sem_combate: numero(item.ol_sem_combate),
        dias_sem_comprar: diferencaDias(item.ultima_compra, referencia),
        prioridade: classificacao.codigo,
        prioridade_ordem: classificacao.ordem,
        motivo_prioridade: classificacao.motivo,
      }
    })

    if (filtroPrioridade) clientes = clientes.filter((item) => item.prioridade === filtroPrioridade)
    const ordenar = {
      prioridade: (a, b) => a.prioridade_ordem - b.prioridade_ordem || b.faturamento_anterior - a.faturamento_anterior,
      dias_sem_comprar: (a, b) => (b.dias_sem_comprar ?? -1) - (a.dias_sem_comprar ?? -1),
      maior_faturamento: (a, b) => b.faturamento_atual - a.faturamento_atual,
      menor_faturamento: (a, b) => a.faturamento_atual - b.faturamento_atual,
      maior_queda: (a, b) => a.variacao_percentual - b.variacao_percentual,
      nome: (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'),
    }
    clientes.sort(ordenar[ordenacao] || ordenar.prioridade)

    const totalFiltrado = clientes.length
    const inicioPagina = (pagina - 1) * limite
    const lista = clientes.slice(inicioPagina, inicioPagina + limite)
    const totalAtivos = clientes.length
    const comVenda = clientes.filter((item) => item.faturamento_atual > 0).length
    const faturamento = clientes.reduce((soma, item) => soma + item.faturamento_atual, 0)
    const pedidos = clientes.reduce((soma, item) => soma + item.pedidos_atual, 0)
    const porPrioridade = clientes.reduce((acc, item) => { acc[item.prioridade] = (acc[item.prioridade] || 0) + 1; return acc }, {})

    const [opcoesConsultores, opcoesUfs, opcoesCidades, ultimaExtracao] = await env.DB.batch([
      env.DB.prepare("SELECT id,nome FROM consultores WHERE ativo=1 AND origem='PAINEL_EQUIPE' ORDER BY nome COLLATE NOCASE"),
      env.DB.prepare("SELECT DISTINCT UPPER(TRIM(uf)) uf FROM clientes WHERE carteira_importada=1 AND ativo=1 AND LENGTH(TRIM(COALESCE(uf,'')))=2 ORDER BY uf"),
      env.DB.prepare("SELECT DISTINCT cidade FROM clientes WHERE carteira_importada=1 AND ativo=1 AND TRIM(COALESCE(cidade,''))<>'' ORDER BY cidade COLLATE NOCASE"),
      env.DB.prepare("SELECT finalizado_em FROM extracoes WHERE tipo='BUSSOLA' AND status='concluido' ORDER BY finalizado_em DESC LIMIT 1"),
    ])

    return json({
      periodo: {
        tipo: faixa.tipo, inicio: faixa.inicio, fim: faixa.fim,
        anterior_inicio: faixa.anteriorInicio, anterior_fim: faixa.anteriorFim,
        rotulo: faixa.inicio ? `${mostrar(faixa.inicio)} a ${mostrar(faixa.fim)}` : 'Todo o período extraído',
      },
      resumo: {
        clientes_ativos: totalAtivos,
        clientes_com_venda: comVenda,
        clientes_sem_venda: Math.max(0, totalAtivos - comVenda),
        cobertura_percentual: totalAtivos > 0 ? (comVenda / totalAtivos) * 100 : 0,
        faturamento_total: faturamento,
        pedidos_faturados: pedidos,
        ticket_medio_cliente: comVenda > 0 ? faturamento / comVenda : 0,
        prioridades: porPrioridade,
      },
      paginacao: { pagina, limite, total: totalFiltrado, paginas: Math.max(1, Math.ceil(totalFiltrado / limite)) },
      clientes: lista,
      filtros: {
        consultores: opcoesConsultores.results || [],
        ufs: (opcoesUfs.results || []).map((item) => String(item.uf || '')).filter(Boolean),
        cidades: (opcoesCidades.results || []).map((item) => String(item.cidade || '')).filter(Boolean),
      },
      atualizado_em: ultimaExtracao.results?.[0]?.finalizado_em || null,
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    return json({ erro: 'Não foi possível carregar os clientes.', detalhe }, detalhe.includes('data inicial') || detalhe.includes('data final') ? 400 : 500)
  }
}
