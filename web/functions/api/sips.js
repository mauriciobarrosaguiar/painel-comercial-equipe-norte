import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../_lib/commercial.js'

const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const PERIODOS = new Set(['mes-atual', 'mes-anterior', 'todo-periodo', 'personalizado'])
const iso = (year, month, day) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
const mostrar = (value) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : ''
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0

function periodo(params) {
  const tipo = PERIODOS.has(params.get('periodo')) ? params.get('periodo') : 'mes-atual'
  if (tipo === 'todo-periodo') return { tipo, inicio: null, fim: null }

  const inicio = params.get('inicio') || ''
  const fim = params.get('fim') || ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(inicio) && /^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    if (inicio > fim) throw new Error('A data inicial não pode ser posterior à data final.')
    return { tipo, inicio, fim }
  }
  if (tipo === 'personalizado') throw new Error('Informe datas válidas.')

  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]))

  let year = Number(parts.year)
  let month = Number(parts.month)
  if (tipo === 'mes-anterior') {
    month -= 1
    if (!month) {
      month = 12
      year -= 1
    }
  }
  return {
    tipo,
    inicio: iso(year, month, 1),
    fim: iso(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()),
  }
}

function withGaps(item) {
  const objetivo = numero(item.meta_mes)
  const realizado = numero(item.ol_sem_combate)
  return {
    ...item,
    meta_mes: objetivo,
    ol_sem_combate: realizado,
    resultado_meta: objetivo > 0 ? realizado / objetivo * 100 : 0,
    gap_80: realizado - objetivo * 0.8,
    gap_90: realizado - objetivo * 0.9,
    gap_100: realizado - objetivo,
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const range = periodo(params)
    const consultor = String(params.get('consultor') || '').trim().slice(0, 180)
    const uf = String(params.get('uf') || '').trim().toUpperCase().slice(0, 2)
    const busca = String(params.get('busca') || '').trim().slice(0, 160)

    const dateCondition = range.inicio
      ? `AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE('${range.inicio}') AND DATE('${range.fim}')`
      : ''
    const clientConditions = ['cl.carteira_importada=1', 'cl.ativo=1']
    const binds = []

    if (consultor) {
      clientConditions.push('cl.consultor_id=?')
      binds.push(consultor)
    }
    if (uf) {
      clientConditions.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?")
      binds.push(uf)
    }

    const sipCondition = busca ? 'AND UPPER(s.nome) LIKE UPPER(?)' : ''
    if (busca) binds.push(`%${busca}%`)

    const sql = `
      WITH vendas AS (
        SELECT pe.cliente_id,
          COALESCE(SUM(ip.valor_faturado),0) ol_total,
          COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) ol_sem_combate,
          COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='COMBATE' THEN ip.valor_faturado ELSE 0 END),0) ol_combate,
          COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='PRIORITARIO' THEN ip.valor_faturado ELSE 0 END),0) ol_prioritarios,
          COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='LANCAMENTO' THEN ip.valor_faturado ELSE 0 END),0) ol_lancamentos,
          COUNT(DISTINCT pe.id) pedidos
        FROM pedidos pe
        JOIN itens_pedido ip ON ip.pedido_id=pe.id
        LEFT JOIN produtos pr ON pr.id=ip.produto_id
        WHERE ${ITEM_FATURADO} ${dateCondition}
        GROUP BY pe.cliente_id
      ),
      carteira AS (
        SELECT sc.sip_id,
          cl.id cliente_id,
          COALESCE(v.ol_total,0) ol_total,
          COALESCE(v.ol_sem_combate,0) ol_sem_combate,
          COALESCE(v.ol_combate,0) ol_combate,
          COALESCE(v.ol_prioritarios,0) ol_prioritarios,
          COALESCE(v.ol_lancamentos,0) ol_lancamentos,
          COALESCE(v.pedidos,0) pedidos
        FROM sip_clientes sc
        JOIN clientes cl ON cl.cnpj=sc.cnpj
        LEFT JOIN vendas v ON v.cliente_id=cl.id
        WHERE sc.ativo=1 AND ${clientConditions.join(' AND ')}
      )
      SELECT s.id,s.nome,s.meta_mes,s.pagamento_percentual,s.acesso_publico_ativo,
        (SELECT COUNT(*) FROM sip_redes sr WHERE sr.sip_id=s.id AND sr.ativo=1) redes,
        (SELECT COUNT(DISTINCT sc2.cnpj) FROM sip_clientes sc2 WHERE sc2.sip_id=s.id AND sc2.ativo=1) cnpjs_vinculados,
        (SELECT GROUP_CONCAT(r.nome, ', ')
           FROM sip_redes sr
           JOIN redes r ON r.id=sr.rede_id
          WHERE sr.sip_id=s.id AND sr.ativo=1 AND r.ativo=1) nomes_redes,
        (SELECT COUNT(*)
           FROM sip_recados rec
          WHERE rec.sip_id=s.id AND rec.ativo=1 AND UPPER(rec.status)<>'CONCLUIDO') recados_pendentes,
        COUNT(DISTINCT c.cliente_id) clientes_ativos,
        COUNT(DISTINCT CASE WHEN c.ol_total>0 THEN c.cliente_id END) clientes_com_venda,
        COALESCE(SUM(c.ol_total),0) ol_total,
        COALESCE(SUM(c.ol_sem_combate),0) ol_sem_combate,
        COALESCE(SUM(c.ol_combate),0) ol_combate,
        COALESCE(SUM(c.ol_prioritarios),0) ol_prioritarios,
        COALESCE(SUM(c.ol_lancamentos),0) ol_lancamentos,
        COALESCE(SUM(c.pedidos),0) pedidos
      FROM sips s
      LEFT JOIN carteira c ON c.sip_id=s.id
      WHERE s.ativo=1 ${sipCondition}
      GROUP BY s.id,s.nome,s.meta_mes,s.pagamento_percentual,s.acesso_publico_ativo
      ORDER BY s.nome COLLATE NOCASE
    `

    const [result, consultantsResult, statesResult, extractionResult] = await env.DB.batch([
      env.DB.prepare(sql).bind(...binds),
      env.DB.prepare("SELECT id,nome FROM consultores WHERE ativo=1 AND origem='PAINEL_EQUIPE' ORDER BY nome COLLATE NOCASE"),
      env.DB.prepare("SELECT DISTINCT UPPER(TRIM(uf)) uf FROM clientes WHERE carteira_importada=1 AND ativo=1 AND LENGTH(TRIM(COALESCE(uf,'')))=2 ORDER BY uf"),
      env.DB.prepare("SELECT finalizado_em FROM extracoes WHERE tipo='BUSSOLA' AND status='concluido' AND finalizado_em IS NOT NULL ORDER BY finalizado_em DESC LIMIT 1"),
    ])

    const sips = (result.results || []).map((raw) => {
      const activeClients = numero(raw.clientes_ativos)
      const clientsWithSales = numero(raw.clientes_com_venda)
      const totalSales = numero(raw.ol_total)
      const orders = numero(raw.pedidos)
      return withGaps({
        ...raw,
        redes: numero(raw.redes),
        cnpjs_vinculados: numero(raw.cnpjs_vinculados),
        recados_pendentes: numero(raw.recados_pendentes),
        clientes_ativos: activeClients,
        clientes_com_venda: clientsWithSales,
        clientes_sem_venda: Math.max(0, activeClients - clientsWithSales),
        positivacao_percentual: activeClients > 0 ? clientsWithSales / activeClients * 100 : 0,
        ol_total: totalSales,
        ol_sem_combate: numero(raw.ol_sem_combate),
        ol_combate: numero(raw.ol_combate),
        ol_prioritarios: numero(raw.ol_prioritarios),
        ol_lancamentos: numero(raw.ol_lancamentos),
        pedidos: orders,
        ticket_medio: clientsWithSales > 0 ? totalSales / clientsWithSales : 0,
        meta_mes: numero(raw.meta_mes),
      })
    })

    const totals = sips.reduce((accumulator, sip) => ({
      sips: accumulator.sips + 1,
      redes: accumulator.redes + sip.redes,
      clientes_ativos: accumulator.clientes_ativos + sip.clientes_ativos,
      cnpjs_vinculados: accumulator.cnpjs_vinculados + sip.cnpjs_vinculados,
      clientes_com_venda: accumulator.clientes_com_venda + sip.clientes_com_venda,
      ol_total: accumulator.ol_total + sip.ol_total,
      ol_sem_combate: accumulator.ol_sem_combate + sip.ol_sem_combate,
      objetivo: accumulator.objetivo + sip.meta_mes,
    }), {
      sips: 0,
      redes: 0,
      clientes_ativos: 0,
      cnpjs_vinculados: 0,
      clientes_com_venda: 0,
      ol_total: 0,
      ol_sem_combate: 0,
      objetivo: 0,
    })

    const totalCoverage = totals.objetivo > 0 ? totals.ol_sem_combate / totals.objetivo * 100 : 0
    const origin = new URL(request.url).origin
    const periodQuery = range.inicio && range.fim ? `inicio=${range.inicio}&fim=${range.fim}` : ''
    const exportBase = `${origin}/api/sips/resumo-geral-exportar?${periodQuery}`

    return json({
      periodo: {
        ...range,
        rotulo: range.inicio ? `${mostrar(range.inicio)} a ${mostrar(range.fim)}` : 'Todo o período extraído',
      },
      totais: {
        ...totals,
        clientes_sem_venda: Math.max(0, totals.clientes_ativos - totals.clientes_com_venda),
        positivacao_percentual: totals.clientes_ativos > 0
          ? totals.clientes_com_venda / totals.clientes_ativos * 100
          : 0,
      },
      sips,
      resumo_sip: {
        periodo: { inicio: range.inicio || '', fim: range.fim || '' },
        linhas: sips.map((sip) => ({
          id: String(sip.id),
          nome: String(sip.nome || ''),
          cnpjs: sip.cnpjs_vinculados,
          objetivo: sip.meta_mes,
          realizado: sip.ol_sem_combate,
          cobertura: sip.resultado_meta,
          gap_80: sip.gap_80,
          gap_90: sip.gap_90,
          gap_100: sip.gap_100,
        })),
        total: {
          cnpjs: totals.cnpjs_vinculados,
          objetivo: totals.objetivo,
          realizado: totals.ol_sem_combate,
          cobertura: totalCoverage,
          gap_80: totals.ol_sem_combate - totals.objetivo * 0.8,
          gap_90: totals.ol_sem_combate - totals.objetivo * 0.9,
          gap_100: totals.ol_sem_combate - totals.objetivo,
        },
        link_resumo_excel: `${exportBase}${periodQuery ? '&' : ''}formato=xls`,
        link_resumo_pdf: `${exportBase}${periodQuery ? '&' : ''}formato=pdf`,
      },
      filtros: {
        consultores: consultantsResult.results || [],
        ufs: (statesResult.results || []).map((item) => String(item.uf || '')).filter(Boolean),
      },
      atualizado_em: extractionResult.results?.[0]?.finalizado_em || null,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (detail.includes('no such table')) {
      return json({ erro: 'A estrutura de SIPs ainda não foi aplicada no banco.', detalhe: detail }, 503)
    }
    return json({ erro: 'Não foi possível carregar SIP / Redes.', detalhe: detail }, 500)
  }
}
