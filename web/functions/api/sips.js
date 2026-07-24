import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../_lib/commercial.js'

const HEADERS = { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store, no-cache, must-revalidate' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const PERIODOS = new Set(['mes-atual', 'mes-anterior', 'todo-periodo', 'personalizado'])
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const mostrar = (v) => v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : ''
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const comGaps = (client) => {
  const objetivo = numero(client.objetivo)
  const realizado = numero(client.ol_sem_combate)
  return {
    ...client,
    objetivo,
    ol_sem_combate: realizado,
    cobertura: objetivo > 0 ? realizado / objetivo * 100 : 0,
    gap_80: realizado - objetivo * 0.8,
    gap_90: realizado - objetivo * 0.9,
    gap_100: realizado - objetivo,
  }
}

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
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]))
  let ano = Number(partes.year)
  let mes = Number(partes.month)
  if (tipo === 'mes-anterior') {
    mes -= 1
    if (!mes) { mes = 12; ano -= 1 }
  }
  return { tipo, inicio: iso(ano, mes, 1), fim: iso(ano, mes, new Date(Date.UTC(ano, mes, 0)).getUTCDate()) }
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const faixa = periodo(params)
    const consultor = String(params.get('consultor') || '').trim().slice(0, 180)
    const uf = String(params.get('uf') || '').trim().toUpperCase().slice(0, 2)
    const busca = String(params.get('busca') || '').trim().slice(0, 160)
    const condData = faixa.inicio
      ? `AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE('${faixa.inicio}') AND DATE('${faixa.fim}')`
      : ''
    const filtrosCliente = ['cl.carteira_importada=1', 'cl.ativo=1']
    const binds = []
    if (consultor) { filtrosCliente.push('cl.consultor_id=?'); binds.push(consultor) }
    if (uf) { filtrosCliente.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?"); binds.push(uf) }
    const filtroSip = busca ? 'AND UPPER(s.nome) LIKE UPPER(?)' : ''
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
        WHERE ${ITEM_FATURADO} ${condData}
        GROUP BY pe.cliente_id
      ), carteira AS (
        SELECT sc.sip_id,cl.id cliente_id,cl.consultor_id,cl.uf,COALESCE(v.ol_total,0) ol_total,
          COALESCE(v.ol_sem_combate,0) ol_sem_combate,COALESCE(v.ol_combate,0) ol_combate,
          COALESCE(v.ol_prioritarios,0) ol_prioritarios,COALESCE(v.ol_lancamentos,0) ol_lancamentos,
          COALESCE(v.pedidos,0) pedidos
        FROM sip_clientes sc
        JOIN clientes cl ON cl.cnpj=sc.cnpj
        LEFT JOIN vendas v ON v.cliente_id=cl.id
        WHERE sc.ativo=1 AND ${filtrosCliente.join(' AND ')}
      )
      SELECT s.id,s.nome,s.meta_mes,s.pagamento_percentual,s.acesso_publico_ativo,
        (SELECT COUNT(*) FROM sip_redes sr WHERE sr.sip_id=s.id AND sr.ativo=1) redes,
        (SELECT GROUP_CONCAT(r.nome, ', ') FROM sip_redes sr JOIN redes r ON r.id=sr.rede_id WHERE sr.sip_id=s.id AND sr.ativo=1 AND r.ativo=1) nomes_redes,
        (SELECT COUNT(*) FROM sip_recados rec WHERE rec.sip_id=s.id AND rec.ativo=1 AND UPPER(rec.status)<>'CONCLUIDO') recados_pendentes,
        COUNT(DISTINCT c.cliente_id) clientes_ativos,
        COUNT(DISTINCT CASE WHEN c.ol_total>0 THEN c.cliente_id END) clientes_com_venda,
        COALESCE(SUM(c.ol_total),0) ol_total,COALESCE(SUM(c.ol_sem_combate),0) ol_sem_combate,
        COALESCE(SUM(c.ol_combate),0) ol_combate,COALESCE(SUM(c.ol_prioritarios),0) ol_prioritarios,
        COALESCE(SUM(c.ol_lancamentos),0) ol_lancamentos,COALESCE(SUM(c.pedidos),0) pedidos
      FROM sips s
      LEFT JOIN carteira c ON c.sip_id=s.id
      WHERE s.ativo=1 ${filtroSip}
      GROUP BY s.id,s.nome,s.meta_mes,s.pagamento_percentual,s.acesso_publico_ativo
      ORDER BY ol_sem_combate DESC,s.nome COLLATE NOCASE
    `

    const resumosSql = `
      WITH vendas AS (
        SELECT pe.cliente_id,
          COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) ol_sem_combate
        FROM pedidos pe
        JOIN itens_pedido ip ON ip.pedido_id=pe.id
        LEFT JOIN produtos pr ON pr.id=ip.produto_id
        WHERE ${ITEM_FATURADO} ${condData}
        GROUP BY pe.cliente_id
      )
      SELECT s.id sip_id,s.nome sip_nome,s.meta_mes,
        cl.id,cl.cnpj,COALESCE(cl.nome_fantasia,cl.razao_social,cl.cnpj) nome,
        cl.cidade,cl.uf,COALESCE(co.nome,'') consultor,
        COALESCE(sc.objetivo_preco_liquido,0) objetivo,
        COALESCE(v.ol_sem_combate,0) ol_sem_combate
      FROM sips s
      JOIN sip_clientes sc ON sc.sip_id=s.id AND sc.ativo=1
      JOIN clientes cl ON cl.cnpj=sc.cnpj
      LEFT JOIN consultores co ON co.id=cl.consultor_id
      LEFT JOIN vendas v ON v.cliente_id=cl.id
      WHERE s.ativo=1 AND ${filtrosCliente.join(' AND ')} ${filtroSip}
      ORDER BY s.nome COLLATE NOCASE,ol_sem_combate DESC,nome COLLATE NOCASE
    `

    const [resultado, resumosResult, consultoresResult, ufsResult, extracaoResult] = await env.DB.batch([
      env.DB.prepare(sql).bind(...binds),
      env.DB.prepare(resumosSql).bind(...binds),
      env.DB.prepare("SELECT id,nome FROM consultores WHERE ativo=1 AND origem='PAINEL_EQUIPE' ORDER BY nome COLLATE NOCASE"),
      env.DB.prepare("SELECT DISTINCT UPPER(TRIM(uf)) uf FROM clientes WHERE carteira_importada=1 AND ativo=1 AND LENGTH(TRIM(COALESCE(uf,'')))=2 ORDER BY uf"),
      env.DB.prepare("SELECT finalizado_em FROM extracoes WHERE tipo='BUSSOLA' AND status='concluido' AND finalizado_em IS NOT NULL ORDER BY finalizado_em DESC LIMIT 1"),
    ])

    const sips = (resultado.results || []).map((item) => {
      const ativos = numero(item.clientes_ativos)
      const comVenda = numero(item.clientes_com_venda)
      const realizado = numero(item.ol_sem_combate)
      const meta = numero(item.meta_mes)
      const total = numero(item.ol_total)
      const pedidos = numero(item.pedidos)
      return {
        ...item,
        redes: numero(item.redes),
        recados_pendentes: numero(item.recados_pendentes),
        clientes_ativos: ativos,
        clientes_com_venda: comVenda,
        clientes_sem_venda: Math.max(0, ativos - comVenda),
        positivacao_percentual: ativos > 0 ? comVenda / ativos * 100 : 0,
        ol_total: total,
        ol_sem_combate: realizado,
        ol_combate: numero(item.ol_combate),
        ol_prioritarios: numero(item.ol_prioritarios),
        ol_lancamentos: numero(item.ol_lancamentos),
        pedidos,
        ticket_medio: comVenda > 0 ? total / comVenda : 0,
        meta_mes: meta,
        resultado_meta: meta > 0 ? realizado / meta * 100 : 0,
      }
    })

    const clientesPorSip = new Map()
    for (const item of resumosResult.results || []) {
      const sipId = String(item.sip_id || '')
      if (!clientesPorSip.has(sipId)) clientesPorSip.set(sipId, [])
      clientesPorSip.get(sipId).push({
        id: String(item.id || ''),
        cnpj: String(item.cnpj || ''),
        nome: String(item.nome || ''),
        cidade: String(item.cidade || ''),
        uf: String(item.uf || ''),
        consultor: String(item.consultor || ''),
        objetivo: numero(item.objetivo),
        ol_total: 0,
        ol_sem_combate: numero(item.ol_sem_combate),
        prioritarios: 0,
        lancamentos: 0,
        ultima_compra: null,
        notas_faturadas: 0,
        notas_canceladas: 0,
        notas_a_faturar: 0,
        valor_a_faturar: 0,
      })
    }

    const origin = new URL(request.url).origin
    const periodoExportacao = faixa.inicio && faixa.fim ? `&inicio=${faixa.inicio}&fim=${faixa.fim}` : ''
    const resumosSip = sips.map((sip) => {
      let clientes = clientesPorSip.get(String(sip.id)) || []
      const objetivoCadastrado = clientes.reduce((total, client) => total + numero(client.objetivo), 0)
      if (clientes.length && objetivoCadastrado <= 0 && numero(sip.meta_mes) > 0) {
        const objetivoPadrao = numero(sip.meta_mes) / clientes.length
        clientes = clientes.map((client) => ({ ...client, objetivo: objetivoPadrao }))
      }
      clientes = clientes.map(comGaps)
      const objetivoClientes = clientes.reduce((total, client) => total + numero(client.objetivo), 0)
      const objetivo = objetivoClientes > 0 ? objetivoClientes : numero(sip.meta_mes)
      const realizado = clientes.reduce((total, client) => total + numero(client.ol_sem_combate), 0)
      const parametros = `id=${encodeURIComponent(String(sip.id))}${periodoExportacao}&publico=0`
      return {
        sip: { id: String(sip.id), nome: String(sip.nome || ''), meta_mes: objetivo },
        periodo: { inicio: faixa.inicio || '', fim: faixa.fim || '' },
        clientes,
        resumo_sip: {
          objetivo,
          realizado,
          cobertura: objetivo > 0 ? realizado / objetivo * 100 : 0,
          gap_80: realizado - objetivo * 0.8,
          gap_90: realizado - objetivo * 0.9,
          gap_100: realizado - objetivo,
        },
        link_resumo_excel: `${origin}/api/sips/resumo-exportar?${parametros}&formato=xls`,
        link_resumo_pdf: `${origin}/api/sips/resumo-exportar?${parametros}&formato=pdf`,
      }
    })

    const totais = sips.reduce((acc, item) => ({
      sips: acc.sips + 1,
      redes: acc.redes + item.redes,
      clientes_ativos: acc.clientes_ativos + item.clientes_ativos,
      clientes_com_venda: acc.clientes_com_venda + item.clientes_com_venda,
      ol_total: acc.ol_total + item.ol_total,
      ol_sem_combate: acc.ol_sem_combate + item.ol_sem_combate,
    }), { sips: 0, redes: 0, clientes_ativos: 0, clientes_com_venda: 0, ol_total: 0, ol_sem_combate: 0 })

    return json({
      periodo: {
        ...faixa,
        rotulo: faixa.inicio ? `${mostrar(faixa.inicio)} a ${mostrar(faixa.fim)}` : 'Todo o período extraído',
      },
      totais: {
        ...totais,
        clientes_sem_venda: Math.max(0, totais.clientes_ativos - totais.clientes_com_venda),
        positivacao_percentual: totais.clientes_ativos > 0 ? totais.clientes_com_venda / totais.clientes_ativos * 100 : 0,
      },
      sips,
      resumos_sip: resumosSip,
      filtros: {
        consultores: consultoresResult.results || [],
        ufs: (ufsResult.results || []).map((item) => String(item.uf || '')).filter(Boolean),
      },
      atualizado_em: extracaoResult.results?.[0]?.finalizado_em || null,
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table')) return json({ erro: 'A estrutura de SIPs ainda não foi aplicada no banco.', detalhe }, 503)
    return json({ erro: 'Não foi possível carregar SIP / Redes.', detalhe }, 500)
  }
}
