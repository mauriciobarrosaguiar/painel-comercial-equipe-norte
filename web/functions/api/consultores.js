import { ITEM_ATIVO, MIX_SEM_COMBATE, PEDIDO_FATURADO } from '../_lib/commercial.js'

const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
}

const PERIODOS = new Set(['mes-atual', 'mes-anterior', 'todo-periodo', 'personalizado'])
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const mostrar = (v) => v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : ''

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

  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  )

  let ano = Number(partes.year)
  let mes = Number(partes.month)
  if (tipo === 'mes-anterior') {
    mes -= 1
    if (!mes) {
      mes = 12
      ano -= 1
    }
  }

  return {
    tipo,
    inicio: iso(ano, mes, 1),
    fim: iso(ano, mes, new Date(Date.UTC(ano, mes, 0)).getUTCDate()),
  }
}

function numero(valor) {
  const resultado = Number(valor || 0)
  return Number.isFinite(resultado) ? resultado : 0
}

function percentual(valor, base) {
  const denominador = numero(base)
  return denominador > 0 ? (numero(valor) / denominador) * 100 : 0
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const faixa = periodo(params)
    const uf = String(params.get('uf') || '').trim().toUpperCase().slice(0, 2)
    const anoMes = faixa.inicio ? faixa.inicio.slice(0, 7) : new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date()).slice(0, 7)

    const clienteJoin = [
      'cl.consultor_id=c.id',
      'cl.carteira_importada=1',
      'cl.ativo=1',
    ]
    const clienteParams = []
    if (uf) {
      clienteJoin.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?")
      clienteParams.push(uf)
    }

    const pedidoJoin = ['pe.cliente_id=cl.id', PEDIDO_FATURADO]
    const pedidoParams = []
    if (faixa.inicio && faixa.fim) {
      pedidoJoin.push('DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)')
      pedidoParams.push(faixa.inicio, faixa.fim)
    }

    const rankingSql = `
      SELECT
        c.id,
        c.nome,
        COALESCE(c.uf,'') AS uf_cadastro,
        COUNT(DISTINCT cl.id) AS clientes_ativos,
        COUNT(DISTINCT CASE WHEN pe.id IS NOT NULL AND COALESCE(ip.valor_faturado,0)>0 THEN cl.id END) AS clientes_com_venda,
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
      LEFT JOIN metas m ON m.consultor_id=c.id AND m.escopo='consultor' AND m.ano_mes=?
      WHERE c.ativo=1 AND c.origem='PAINEL_EQUIPE'
      GROUP BY
        c.id,c.nome,c.uf,
        m.ol_sem_combate,m.ol_prioritarios,m.ol_lancamentos,m.clientes_positivados
      ORDER BY ol_sem_combate DESC, c.nome COLLATE NOCASE
    `

    const rankingParams = [...clienteParams, ...pedidoParams, anoMes]
    const gerenteSql = `
      SELECT
        COALESCE(ol_sem_combate,0) AS ol_sem_combate,
        COALESCE(ol_prioritarios,0) AS ol_prioritarios,
        COALESCE(ol_lancamentos,0) AS ol_lancamentos,
        COALESCE(clientes_positivados,0) AS clientes_positivados
      FROM metas
      WHERE escopo='gerente' AND ano_mes=?
      LIMIT 1
    `

    const [rankingResult, gerenteResult] = await env.DB.batch([
      env.DB.prepare(rankingSql).bind(...rankingParams),
      env.DB.prepare(gerenteSql).bind(anoMes),
    ])

    const consultores = (rankingResult.results || []).map((item) => {
      const clientesAtivos = numero(item.clientes_ativos)
      const clientesComVenda = numero(item.clientes_com_venda)
      const olSemCombate = numero(item.ol_sem_combate)
      const olTotalFaturado = numero(item.ol_total_faturado)
      const metaOlSemCombate = numero(item.meta_ol_sem_combate)
      const olPrioritarios = numero(item.ol_prioritarios)
      const olLancamentos = numero(item.ol_lancamentos)

      return {
        id: String(item.id || ''),
        nome: String(item.nome || ''),
        uf: String(item.uf_cadastro || ''),
        clientes_ativos: clientesAtivos,
        clientes_com_venda: clientesComVenda,
        clientes_sem_venda: Math.max(0, clientesAtivos - clientesComVenda),
        ol_total_faturado: olTotalFaturado,
        ol_sem_combate: olSemCombate,
        ol_combate: numero(item.ol_combate),
        ol_prioritarios: olPrioritarios,
        ol_lancamentos: olLancamentos,
        meta_ol_sem_combate: metaOlSemCombate,
        meta_ol_prioritarios: numero(item.meta_ol_prioritarios),
        meta_ol_lancamentos: numero(item.meta_ol_lancamentos),
        meta_clientes: numero(item.meta_clientes),
        resultado_meta_ol: percentual(olSemCombate, metaOlSemCombate),
        participacao_prioritarios: percentual(olPrioritarios, olSemCombate),
        participacao_lancamentos: percentual(olLancamentos, olSemCombate),
      }
    }).filter((item) => item.id && item.nome)

    const gerente = gerenteResult.results?.[0] || {}
    const totais = consultores.reduce((acc, item) => ({
      ol_total_faturado: acc.ol_total_faturado + item.ol_total_faturado,
      ol_sem_combate: acc.ol_sem_combate + item.ol_sem_combate,
      ol_combate: acc.ol_combate + item.ol_combate,
      ol_prioritarios: acc.ol_prioritarios + item.ol_prioritarios,
      ol_lancamentos: acc.ol_lancamentos + item.ol_lancamentos,
      clientes_ativos: acc.clientes_ativos + item.clientes_ativos,
      clientes_com_venda: acc.clientes_com_venda + item.clientes_com_venda,
      clientes_sem_venda: acc.clientes_sem_venda + item.clientes_sem_venda,
    }), {
      ol_total_faturado: 0,
      ol_sem_combate: 0,
      ol_combate: 0,
      ol_prioritarios: 0,
      ol_lancamentos: 0,
      clientes_ativos: 0,
      clientes_com_venda: 0,
      clientes_sem_venda: 0,
    })

    const metaGerente = {
      ol_sem_combate: numero(gerente.ol_sem_combate),
      ol_prioritarios: numero(gerente.ol_prioritarios),
      ol_lancamentos: numero(gerente.ol_lancamentos),
      clientes_positivados: numero(gerente.clientes_positivados),
    }

    return json({
      periodo: {
        tipo: faixa.tipo,
        inicio: faixa.inicio,
        fim: faixa.fim,
        rotulo: faixa.inicio ? `${mostrar(faixa.inicio)} a ${mostrar(faixa.fim)}` : 'Todo o período extraído',
        ano_mes_meta: anoMes,
      },
      uf,
      ufs: (await env.DB.prepare("SELECT DISTINCT UPPER(TRIM(uf)) AS uf FROM clientes WHERE carteira_importada=1 AND ativo=1 AND LENGTH(TRIM(COALESCE(uf,'')))=2 ORDER BY uf").all()).results.map((item) => String(item.uf || '')).filter(Boolean),
      consultores,
      totais: {
        ...totais,
        meta_gerente: metaGerente,
        resultado_meta_gerente: percentual(totais.ol_sem_combate, metaGerente.ol_sem_combate),
        participacao_prioritarios: percentual(totais.ol_prioritarios, totais.ol_sem_combate),
        participacao_lancamentos: percentual(totais.ol_lancamentos, totais.ol_sem_combate),
      },
      atualizado_em: new Date().toISOString(),
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    return json({ erro: 'Não foi possível carregar o módulo de consultores.', detalhe }, 500)
  }
}
