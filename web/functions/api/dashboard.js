import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../_lib/commercial.js'

const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
}

const PERIODOS = new Set(['mes-atual', 'mes-anterior', 'todo-periodo', 'personalizado'])
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const stmt = (env, sql, params = []) => params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql)
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
  let y = Number(partes.year)
  let m = Number(partes.month)
  if (tipo === 'mes-anterior') {
    m -= 1
    if (!m) {
      m = 12
      y -= 1
    }
  }
  return { tipo, inicio: iso(y, m, 1), fim: iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate()) }
}

function filtros(params) {
  const p = periodo(params)
  const consultor = String(params.get('consultor') || '').trim().slice(0, 180)
  const uf = String(params.get('uf') || '').trim().toUpperCase().slice(0, 2)

  // O total geral vem diretamente dos pedidos faturados do Bússola.
  // A carteira oficial só é obrigatória quando o usuário filtra por consultor ou UF.
  const cond = [ITEM_FATURADO]
  const valores = []

  if (p.inicio && p.fim) {
    cond.push('DATE(COALESCE(pe.data_faturamento, pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)')
    valores.push(p.inicio, p.fim)
  }
  if (consultor || uf) cond.push('cl.carteira_importada=1')
  if (consultor) {
    cond.push('cl.consultor_id=?')
    valores.push(consultor)
  }
  if (uf) {
    cond.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?")
    valores.push(uf)
  }

  // Clientes com venda sempre são contados pela carteira oficial.
  const condClientesVenda = [ITEM_FATURADO, 'cl.carteira_importada=1', 'cl.ativo=1', 'ip.valor_faturado>0']
  const valoresClientesVenda = []
  if (p.inicio && p.fim) {
    condClientesVenda.push('DATE(COALESCE(pe.data_faturamento, pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)')
    valoresClientesVenda.push(p.inicio, p.fim)
  }
  if (consultor) {
    condClientesVenda.push('cl.consultor_id=?')
    valoresClientesVenda.push(consultor)
  }
  if (uf) {
    condClientesVenda.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?")
    valoresClientesVenda.push(uf)
  }

  const condClientes = ['cl.carteira_importada=1', 'cl.ativo=1']
  const valoresClientes = []
  if (consultor) {
    condClientes.push('cl.consultor_id=?')
    valoresClientes.push(consultor)
  }
  if (uf) {
    condClientes.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?")
    valoresClientes.push(uf)
  }

  return {
    ...p,
    consultor,
    uf,
    where: cond.join(' AND '),
    valores,
    clientSaleWhere: condClientesVenda.join(' AND '),
    clientSaleValues: valoresClientesVenda,
    clientWhere: condClientes.join(' AND '),
    clientValues: valoresClientes,
    rotulo: p.inicio ? `${mostrar(p.inicio)} a ${mostrar(p.fim)}` : 'Todo o período extraído',
  }
}

const JOINS = 'FROM itens_pedido ip JOIN pedidos pe ON pe.id=ip.pedido_id LEFT JOIN clientes cl ON cl.id=pe.cliente_id LEFT JOIN produtos pr ON pr.id=ip.produto_id'

export async function onRequestGet({ request, env }) {
  try {
    const f = filtros(new URL(request.url).searchParams)
    const consultas = [
      stmt(env, `SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${f.where} AND ${MIX_SEM_COMBATE}`, f.valores),
      stmt(env, `SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${f.where} AND UPPER(COALESCE(pr.tipo_mix,''))='PRIORITARIO'`, f.valores),
      stmt(env, `SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${f.where} AND UPPER(COALESCE(pr.tipo_mix,''))='LANCAMENTO'`, f.valores),
      stmt(env, `SELECT COUNT(DISTINCT pe.cliente_id) total ${JOINS} WHERE ${f.clientSaleWhere}`, f.clientSaleValues),
      stmt(env, `SELECT COUNT(*) total FROM clientes cl WHERE ${f.clientWhere}`, f.clientValues),
      stmt(env, "SELECT COUNT(*) total FROM consultores WHERE ativo=1 AND origem='PAINEL_EQUIPE'"),
      stmt(env, `SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${f.where}`, f.valores),
      stmt(env, "SELECT COUNT(*) total FROM extracoes WHERE status='executando'"),
      stmt(env, "SELECT id,nome FROM consultores WHERE ativo=1 AND origem='PAINEL_EQUIPE' AND TRIM(nome)<>'' ORDER BY nome COLLATE NOCASE"),
      stmt(env, "SELECT DISTINCT UPPER(TRIM(uf)) uf FROM clientes WHERE carteira_importada=1 AND ativo=1 AND LENGTH(TRIM(COALESCE(uf,'')))=2 ORDER BY uf"),
      stmt(env, "SELECT (SELECT COUNT(*) FROM clientes WHERE carteira_importada=1) clientes_carteira,(SELECT COUNT(*) FROM produtos WHERE UPPER(COALESCE(tipo_mix,''))<>'SEM CLASSIFICACAO') produtos_mix,(SELECT COUNT(*) FROM produtos WHERE mercado_farma_ativo=1) produtos_mercado_farma,(SELECT COUNT(*) FROM metas WHERE escopo='consultor') metas"),
      stmt(env, `SELECT COUNT(DISTINCT pe.id) pedidos, COUNT(ip.id) itens, COALESCE(SUM(ip.valor_faturado),0) valor_total, MIN(COALESCE(pe.data_faturamento,pe.data_pedido)) data_min, MAX(COALESCE(pe.data_faturamento,pe.data_pedido)) data_max ${JOINS} WHERE ${ITEM_FATURADO}`),
      stmt(env, `SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${f.where} AND UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='COMBATE'`, f.valores),
    ]

    const r = await env.DB.batch(consultas)
    const ativos = Number(r[4]?.results?.[0]?.total || 0)
    const comVenda = Number(r[3]?.results?.[0]?.total || 0)
    const b = r[10]?.results?.[0] || {}
    const d = r[11]?.results?.[0] || {}

    return json({
      ol_sem_combate: Number(r[0]?.results?.[0]?.total || 0),
      ol_combate: Number(r[12]?.results?.[0]?.total || 0),
      ol_prioritarios: Number(r[1]?.results?.[0]?.total || 0),
      ol_lancamentos: Number(r[2]?.results?.[0]?.total || 0),
      clientes_com_venda: comVenda,
      clientes_sem_venda: Math.max(0, ativos - comVenda),
      clientes_ativos: ativos,
      consultores_ativos: Number(r[5]?.results?.[0]?.total || 0),
      ol_total_faturado: Number(r[6]?.results?.[0]?.total || 0),
      vendas_faturadas: Number(r[6]?.results?.[0]?.total || 0),
      automacoes_executando: Number(r[7]?.results?.[0]?.total || 0),
      bases: {
        painel_equipe_norte: Number(b.clientes_carteira || 0),
        produtos_mix: Number(b.produtos_mix || 0),
        produtos_mercado_farma: Number(b.produtos_mercado_farma || 0),
        metas: Number(b.metas || 0),
      },
      diagnostico: {
        pedidos_faturados: Number(d.pedidos || 0),
        itens_faturados: Number(d.itens || 0),
        valor_faturado_total: Number(d.valor_total || 0),
        primeira_data: d.data_min || null,
        ultima_data: d.data_max || null,
      },
      filtros: {
        consultores: (r[8]?.results || []).map((x) => ({ id: String(x.id || ''), nome: String(x.nome || '') })).filter((x) => x.id && x.nome),
        ufs: (r[9]?.results || []).map((x) => String(x.uf || '')).filter(Boolean),
        aplicado: { periodo: f.tipo, inicio: f.inicio, fim: f.fim, consultor: f.consultor, uf: f.uf, rotulo: f.rotulo },
      },
      regra_calculo: {
        valor: 'itens_pedido.valor_faturado (coluna AA do Bússola)',
        data: 'data_faturamento; data_pedido apenas como fallback',
        carteira: 'Painel Equipe Norte por CNPJ para filtros de consultor e UF',
      },
      atualizado_em: new Date().toISOString(),
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    return json({ erro: 'Não foi possível carregar os indicadores.', detalhe }, detalhe.includes('data inicial') || detalhe.includes('data final') ? 400 : 500)
  }
}
