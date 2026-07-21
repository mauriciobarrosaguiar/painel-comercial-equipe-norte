import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../_lib/commercial.js'

const HEADERS = { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store, no-cache, must-revalidate' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const PERIODOS = new Set(['mes-atual', 'mes-anterior', 'todo-periodo', 'personalizado'])
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
  if (tipo === 'personalizado') throw new Error('Informe datas válidas.')
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((p) => [p.type, p.value]))
  let ano = Number(partes.year), mes = Number(partes.month)
  if (tipo === 'mes-anterior') { mes -= 1; if (!mes) { mes = 12; ano -= 1 } }
  return { tipo, inicio: iso(ano, mes, 1), fim: iso(ano, mes, new Date(Date.UTC(ano, mes, 0)).getUTCDate()) }
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const faixa = periodo(params)
    const consultor = String(params.get('consultor') || '').trim().slice(0, 180)
    const uf = String(params.get('uf') || '').trim().toUpperCase().slice(0, 2)
    const busca = String(params.get('busca') || '').trim().slice(0, 160)
    const condData = faixa.inicio ? `AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE('${faixa.inicio}') AND DATE('${faixa.fim}')` : ''
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
        FROM pedidos pe JOIN itens_pedido ip ON ip.pedido_id=pe.id LEFT JOIN produtos pr ON pr.id=ip.produto_id
        WHERE ${ITEM_FATURADO} ${condData}
        GROUP BY pe.cliente_id
      ), carteira AS (
        SELECT sc.sip_id,cl.id cliente_id,cl.consultor_id,cl.uf,COALESCE(v.ol_total,0) ol_total,
          COALESCE(v.ol_sem_combate,0) ol_sem_combate,COALESCE(v.ol_combate,0) ol_combate,
          COALESCE(v.ol_prioritarios,0) ol_prioritarios,COALESCE(v.ol_lancamentos,0) ol_lancamentos,
          COALESCE(v.pedidos,0) pedidos
        FROM sip_clientes sc JOIN clientes cl ON cl.cnpj=sc.cnpj
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
      FROM sips s LEFT JOIN carteira c ON c.sip_id=s.id
      WHERE s.ativo=1 ${filtroSip}
      GROUP BY s.id,s.nome,s.meta_mes,s.pagamento_percentual,s.acesso_publico_ativo
      ORDER BY ol_sem_combate DESC,s.nome COLLATE NOCASE
    `

    const [resultado, consultoresResult, ufsResult, extracaoResult] = await env.DB.batch([
      env.DB.prepare(sql).bind(...binds),
      env.DB.prepare("SELECT id,nome FROM consultores WHERE ativo=1 AND origem='PAINEL_EQUIPE' ORDER BY nome COLLATE NOCASE"),
      env.DB.prepare("SELECT DISTINCT UPPER(TRIM(uf)) uf FROM clientes WHERE carteira_importada=1 AND ativo=1 AND LENGTH(TRIM(COALESCE(uf,'')))=2 ORDER BY uf"),
      env.DB.prepare("SELECT finalizado_em FROM extracoes WHERE tipo='BUSSOLA' AND status='concluido' AND finalizado_em IS NOT NULL ORDER BY finalizado_em DESC LIMIT 1"),
    ])

    const sips = (resultado.results || []).map((item) => {
      const ativos = Number(item.clientes_ativos || 0), comVenda = Number(item.clientes_com_venda || 0)
      const realizado = Number(item.ol_sem_combate || 0), meta = Number(item.meta_mes || 0)
      const total = Number(item.ol_total || 0), pedidos = Number(item.pedidos || 0)
      return {
        ...item, redes: Number(item.redes || 0), recados_pendentes: Number(item.recados_pendentes || 0),
        clientes_ativos: ativos, clientes_com_venda: comVenda, clientes_sem_venda: Math.max(0, ativos - comVenda),
        positivacao_percentual: ativos > 0 ? (comVenda / ativos) * 100 : 0,
        ol_total: total, ol_sem_combate: realizado, ol_combate: Number(item.ol_combate || 0),
        ol_prioritarios: Number(item.ol_prioritarios || 0), ol_lancamentos: Number(item.ol_lancamentos || 0),
        pedidos, ticket_medio: comVenda > 0 ? total / comVenda : 0,
        meta_mes: meta, resultado_meta: meta > 0 ? (realizado / meta) * 100 : 0,
      }
    })
    const totais = sips.reduce((acc, item) => ({
      sips: acc.sips + 1, redes: acc.redes + item.redes, clientes_ativos: acc.clientes_ativos + item.clientes_ativos,
      clientes_com_venda: acc.clientes_com_venda + item.clientes_com_venda, ol_total: acc.ol_total + item.ol_total,
      ol_sem_combate: acc.ol_sem_combate + item.ol_sem_combate,
    }), { sips: 0, redes: 0, clientes_ativos: 0, clientes_com_venda: 0, ol_total: 0, ol_sem_combate: 0 })

    return json({
      periodo: { ...faixa, rotulo: faixa.inicio ? `${mostrar(faixa.inicio)} a ${mostrar(faixa.fim)}` : 'Todo o período extraído' },
      totais: { ...totais, clientes_sem_venda: Math.max(0, totais.clientes_ativos - totais.clientes_com_venda), positivacao_percentual: totais.clientes_ativos > 0 ? (totais.clientes_com_venda / totais.clientes_ativos) * 100 : 0 },
      sips,
      filtros: { consultores: consultoresResult.results || [], ufs: (ufsResult.results || []).map((item) => String(item.uf || '')).filter(Boolean) },
      atualizado_em: extracaoResult.results?.[0]?.finalizado_em || null,
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table')) return json({ erro: 'A estrutura de SIPs ainda não foi aplicada no banco.', detalhe }, 503)
    return json({ erro: 'Não foi possível carregar SIP / Redes.', detalhe }, 500)
  }
}
