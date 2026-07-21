import { ITEM_ATIVO, MIX_SEM_COMBATE, PEDIDO_FATURADO } from '../_lib/commercial.js'

const HEADERS = { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store, no-cache, must-revalidate' }
const PERIODOS = new Set(['mes-atual', 'mes-anterior', 'todo-periodo', 'personalizado'])
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const mostrar = (v) => v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : ''
const numero = (valor) => Number.isFinite(Number(valor)) ? Number(valor) : 0
const percentual = (valor, base) => numero(base) > 0 ? (numero(valor) / numero(base)) * 100 : 0

function periodo(params) {
  const tipo = PERIODOS.has(params.get('periodo')) ? params.get('periodo') : 'mes-atual'
  if (tipo === 'todo-periodo') return { tipo, inicio: null, fim: null }
  const inicio = params.get('inicio') || ''
  const fim = params.get('fim') || ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(inicio) && /^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    if (inicio > fim) throw new Error('A data inicial não pode ser posterior à data final.')
    return { tipo, inicio, fim }
  }
  if (tipo === 'personalizado') throw new Error('Informe uma data inicial e uma data final válidas.')
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]))
  let ano = Number(partes.year)
  let mes = Number(partes.month)
  if (tipo === 'mes-anterior') { mes -= 1; if (!mes) { mes = 12; ano -= 1 } }
  return { tipo, inicio: iso(ano, mes, 1), fim: iso(ano, mes, new Date(Date.UTC(ano, mes, 0)).getUTCDate()) }
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const faixa = periodo(params)
    const uf = String(params.get('uf') || '').trim().toUpperCase().slice(0, 2)
    const clienteJoin = ['cl.consultor_id=c.id', 'cl.carteira_importada=1', 'cl.ativo=1']
    const clienteParams = []
    if (uf) { clienteJoin.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?"); clienteParams.push(uf) }

    const pedidoJoin = ['pe.cliente_id=cl.id', PEDIDO_FATURADO]
    const pedidoParams = []
    if (faixa.inicio && faixa.fim) {
      pedidoJoin.push('DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)')
      pedidoParams.push(faixa.inicio, faixa.fim)
    }

    const metaCond = faixa.inicio ? 'ano_mes BETWEEN ? AND ?' : '1=1'
    const metaParams = faixa.inicio ? [faixa.inicio.slice(0, 7), faixa.fim.slice(0, 7)] : []
    const rankingSql = `
      WITH metas_periodo AS (
        SELECT consultor_id,
          SUM(ol_sem_combate) ol_sem_combate,SUM(ol_prioritarios) ol_prioritarios,
          SUM(ol_lancamentos) ol_lancamentos,SUM(clientes_positivados) clientes_positivados
        FROM metas WHERE escopo='consultor' AND ${metaCond}
        GROUP BY consultor_id
      )
      SELECT c.id,c.nome,COALESCE(c.uf,'') AS uf_cadastro,
        COUNT(DISTINCT cl.id) AS clientes_ativos,
        COUNT(DISTINCT CASE WHEN pe.id IS NOT NULL AND COALESCE(ip.valor_faturado,0)>0 THEN cl.id END) AS clientes_com_venda,
        COUNT(DISTINCT CASE WHEN pe.id IS NOT NULL AND COALESCE(ip.valor_faturado,0)>0 THEN pe.id END) AS pedidos_faturados,
        COALESCE(SUM(ip.valor_faturado),0) AS ol_total_faturado,
        COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) AS ol_sem_combate,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='COMBATE' THEN ip.valor_faturado ELSE 0 END),0) AS ol_combate,
        COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='PRIORITARIO' THEN ip.valor_faturado ELSE 0 END),0) AS ol_prioritarios,
        COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='LANCAMENTO' THEN ip.valor_faturado ELSE 0 END),0) AS ol_lancamentos,
        COALESCE(m.ol_sem_combate,0) AS meta_ol_sem_combate,
        COALESCE(m.ol_prioritarios,0) AS meta_ol_prioritarios,
        COALESCE(m.ol_lancamentos,0) AS meta_ol_lancamentos,
        COALESCE(m.clientes_positivados,0) AS meta_clientes
      FROM consultores c
      LEFT JOIN clientes cl ON ${clienteJoin.join(' AND ')}
      LEFT JOIN pedidos pe ON ${pedidoJoin.join(' AND ')}
      LEFT JOIN itens_pedido ip ON ip.pedido_id=pe.id AND ${ITEM_ATIVO}
      LEFT JOIN produtos pr ON pr.id=ip.produto_id
      LEFT JOIN metas_periodo m ON m.consultor_id=c.id
      WHERE c.ativo=1 AND c.origem='PAINEL_EQUIPE'
      GROUP BY c.id,c.nome,c.uf,m.ol_sem_combate,m.ol_prioritarios,m.ol_lancamentos,m.clientes_positivados
      ORDER BY ol_sem_combate DESC,c.nome COLLATE NOCASE
    `
    const gerenteSql = `
      SELECT COALESCE(SUM(ol_sem_combate),0) ol_sem_combate,
        COALESCE(SUM(ol_prioritarios),0) ol_prioritarios,
        COALESCE(SUM(ol_lancamentos),0) ol_lancamentos,
        COALESCE(SUM(clientes_positivados),0) clientes_positivados
      FROM metas WHERE escopo='gerente' AND ${metaCond}
    `

    const [rankingResult, gerenteResult, ufsResult, extracaoResult] = await env.DB.batch([
      env.DB.prepare(rankingSql).bind(...metaParams, ...clienteParams, ...pedidoParams),
      env.DB.prepare(gerenteSql).bind(...metaParams),
      env.DB.prepare("SELECT DISTINCT UPPER(TRIM(uf)) AS uf FROM clientes WHERE carteira_importada=1 AND ativo=1 AND LENGTH(TRIM(COALESCE(uf,'')))=2 ORDER BY uf"),
      env.DB.prepare("SELECT finalizado_em FROM extracoes WHERE tipo='BUSSOLA' AND status='concluido' AND finalizado_em IS NOT NULL ORDER BY finalizado_em DESC LIMIT 1"),
    ])

    const consultores = (rankingResult.results || []).map((item) => {
      const clientesAtivos = numero(item.clientes_ativos)
      const clientesComVenda = numero(item.clientes_com_venda)
      const olSemCombate = numero(item.ol_sem_combate)
      const olTotalFaturado = numero(item.ol_total_faturado)
      const metaOlSemCombate = numero(item.meta_ol_sem_combate)
      const pedidos = numero(item.pedidos_faturados)
      const olPrioritarios = numero(item.ol_prioritarios)
      const olLancamentos = numero(item.ol_lancamentos)
      return {
        id: String(item.id || ''), nome: String(item.nome || ''), uf: String(item.uf_cadastro || ''),
        clientes_ativos: clientesAtivos, clientes_com_venda: clientesComVenda,
        clientes_sem_venda: Math.max(0, clientesAtivos - clientesComVenda), pedidos_faturados: pedidos,
        ol_total_faturado: olTotalFaturado, ol_sem_combate: olSemCombate, ol_combate: numero(item.ol_combate),
        ol_prioritarios: olPrioritarios, ol_lancamentos: olLancamentos,
        meta_ol_sem_combate: metaOlSemCombate, meta_ol_prioritarios: numero(item.meta_ol_prioritarios),
        meta_ol_lancamentos: numero(item.meta_ol_lancamentos), meta_clientes: numero(item.meta_clientes),
        resultado_meta_ol: percentual(olSemCombate, metaOlSemCombate),
        resultado_meta_clientes: percentual(clientesComVenda, item.meta_clientes),
        participacao_prioritarios: percentual(olPrioritarios, olSemCombate),
        participacao_lancamentos: percentual(olLancamentos, olSemCombate),
        ticket_medio_cliente: clientesComVenda > 0 ? olTotalFaturado / clientesComVenda : 0,
        ticket_medio_pedido: pedidos > 0 ? olTotalFaturado / pedidos : 0,
      }
    }).filter((item) => item.id && item.nome)

    const gerente = gerenteResult.results?.[0] || {}
    const totais = consultores.reduce((acc, item) => ({
      ol_total_faturado: acc.ol_total_faturado + item.ol_total_faturado,
      ol_sem_combate: acc.ol_sem_combate + item.ol_sem_combate, ol_combate: acc.ol_combate + item.ol_combate,
      ol_prioritarios: acc.ol_prioritarios + item.ol_prioritarios, ol_lancamentos: acc.ol_lancamentos + item.ol_lancamentos,
      clientes_ativos: acc.clientes_ativos + item.clientes_ativos, clientes_com_venda: acc.clientes_com_venda + item.clientes_com_venda,
      clientes_sem_venda: acc.clientes_sem_venda + item.clientes_sem_venda, pedidos_faturados: acc.pedidos_faturados + item.pedidos_faturados,
    }), { ol_total_faturado: 0, ol_sem_combate: 0, ol_combate: 0, ol_prioritarios: 0, ol_lancamentos: 0, clientes_ativos: 0, clientes_com_venda: 0, clientes_sem_venda: 0, pedidos_faturados: 0 })

    const metaGerente = {
      ol_sem_combate: numero(gerente.ol_sem_combate), ol_prioritarios: numero(gerente.ol_prioritarios),
      ol_lancamentos: numero(gerente.ol_lancamentos), clientes_positivados: numero(gerente.clientes_positivados),
    }

    return json({
      periodo: {
        tipo: faixa.tipo, inicio: faixa.inicio, fim: faixa.fim,
        rotulo: faixa.inicio ? `${mostrar(faixa.inicio)} a ${mostrar(faixa.fim)}` : 'Todo o período extraído',
        meta_inicio: faixa.inicio ? faixa.inicio.slice(0, 7) : null, meta_fim: faixa.fim ? faixa.fim.slice(0, 7) : null,
      },
      uf, ufs: (ufsResult.results || []).map((item) => String(item.uf || '')).filter(Boolean), consultores,
      totais: {
        ...totais, meta_gerente: metaGerente,
        resultado_meta_gerente: percentual(totais.ol_sem_combate, metaGerente.ol_sem_combate),
        resultado_meta_clientes: percentual(totais.clientes_com_venda, metaGerente.clientes_positivados),
        participacao_prioritarios: percentual(totais.ol_prioritarios, totais.ol_sem_combate),
        participacao_lancamentos: percentual(totais.ol_lancamentos, totais.ol_sem_combate),
        ticket_medio_cliente: totais.clientes_com_venda > 0 ? totais.ol_total_faturado / totais.clientes_com_venda : 0,
        ticket_medio_pedido: totais.pedidos_faturados > 0 ? totais.ol_total_faturado / totais.pedidos_faturados : 0,
      },
      atualizado_em: extracaoResult.results?.[0]?.finalizado_em || null,
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    return json({ erro: 'Não foi possível carregar o módulo de consultores.', detalhe }, detalhe.includes('data inicial') || detalhe.includes('data final') ? 400 : 500)
  }
}
