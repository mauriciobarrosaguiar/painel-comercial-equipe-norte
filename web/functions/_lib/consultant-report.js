import {
  ITEM_ATIVO,
  MIX_SEM_COMBATE,
  PEDIDO_FATURADO,
  PEDIDO_NAO_FATURADO,
  VALOR_ITEM_NAO_FATURADO,
} from './commercial.js'
import { authorized } from './credentials.js'

const PERIODOS = new Set(['mes-atual', 'mes-anterior', 'todo-periodo', 'personalizado'])
const MIX_PRIORITARIO = "UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='PRIORITARIO'"
const MIX_LANCAMENTO = "UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='LANCAMENTO'"
const MIX_COMBATE = "UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='COMBATE'"
const CONSULTOR_FATURAMENTO = 'COALESCE(pe.consultor_bussola_id,pe.consultor_id,cl.consultor_id)'
const SETORES = {
  'ALESSANDRA FREITAS SA': '18150300',
  'MAURICIO BARROS DE AGUIAR': '18150301',
  'RAIMUNDA MARTINS GOMES CARNEIRO': '18150302',
  'FRANCISCO CORTEZ FILHO': '18150303',
  'DENYSE CRISTINA VIANA VELOSO ARAUJO': '18150304',
  'JOAO DIEGO FERREIRA DE OLIVEIRA': '18150305',
}

export const text = (value) => String(value ?? '').trim()
export const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
export const percentage = (value, goal) => number(goal) > 0 ? number(value) / number(goal) * 100 : 0
export const xmlEscape = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;')
export const safeName = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'consultores'

const iso = (year, month, day) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
const normalizeName = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
const showDate = (value) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : ''

export function periodFrom(params) {
  const type = PERIODOS.has(params.get('periodo')) ? params.get('periodo') : 'mes-atual'
  if (type === 'todo-periodo') return { tipo: type, inicio: null, fim: null, rotulo: 'Todo o período extraído' }
  const start = text(params.get('inicio'))
  const end = text(params.get('fim'))
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    if (start > end) throw new Error('A data inicial não pode ser posterior à data final.')
    return { tipo: type, inicio: start, fim: end, rotulo: `${showDate(start)} a ${showDate(end)}` }
  }
  if (type === 'personalizado') throw new Error('Informe uma data inicial e uma data final válidas.')
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  let year = Number(parts.year)
  let month = Number(parts.month)
  if (type === 'mes-anterior') {
    month -= 1
    if (!month) { month = 12; year -= 1 }
  }
  const inicio = iso(year, month, 1)
  const fim = iso(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate())
  return { tipo: type, inicio, fim, rotulo: `${showDate(inicio)} a ${showDate(fim)}` }
}

function totalize(rows, managerGoal) {
  const sum = rows.reduce((acc, row) => ({
    ol_total_faturado: acc.ol_total_faturado + row.ol_total_faturado,
    ol_sem_combate: acc.ol_sem_combate + row.ol_sem_combate,
    ol_prioritarios: acc.ol_prioritarios + row.ol_prioritarios,
    ol_lancamentos: acc.ol_lancamentos + row.ol_lancamentos,
    meta_ol_sem_combate: acc.meta_ol_sem_combate + row.meta_ol_sem_combate,
    meta_ol_prioritarios: acc.meta_ol_prioritarios + row.meta_ol_prioritarios,
    meta_ol_lancamentos: acc.meta_ol_lancamentos + row.meta_ol_lancamentos,
    valor_nao_faturado: acc.valor_nao_faturado + row.valor_nao_faturado,
    valor_nao_faturado_sem_combate: acc.valor_nao_faturado_sem_combate + row.valor_nao_faturado_sem_combate,
    valor_nao_faturado_prioritarios: acc.valor_nao_faturado_prioritarios + row.valor_nao_faturado_prioritarios,
    valor_nao_faturado_lancamentos: acc.valor_nao_faturado_lancamentos + row.valor_nao_faturado_lancamentos,
    valor_nao_faturado_combate: acc.valor_nao_faturado_combate + row.valor_nao_faturado_combate,
  }), {
    ol_total_faturado: 0, ol_sem_combate: 0, ol_prioritarios: 0, ol_lancamentos: 0,
    meta_ol_sem_combate: 0, meta_ol_prioritarios: 0, meta_ol_lancamentos: 0,
    valor_nao_faturado: 0, valor_nao_faturado_sem_combate: 0,
    valor_nao_faturado_prioritarios: 0, valor_nao_faturado_lancamentos: 0, valor_nao_faturado_combate: 0,
  })
  return {
    id: 'total-equipe',
    nome: 'TOTAL EQUIPE NORTE',
    setor: '',
    ...sum,
    meta_ol_sem_combate: number(managerGoal.ol_sem_combate) || sum.meta_ol_sem_combate,
    meta_ol_prioritarios: number(managerGoal.ol_prioritarios) || sum.meta_ol_prioritarios,
    meta_ol_lancamentos: number(managerGoal.ol_lancamentos) || sum.meta_ol_lancamentos,
  }
}

export async function loadConsultantReport(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return { error: new Response('Chave administrativa não configurada.', { status: 503 }) }
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return { error: new Response('Acesso não autorizado.', { status: 401 }) }
  }

  const params = new URL(request.url).searchParams
  const period = periodFrom(params)
  const uf = text(params.get('uf')).toUpperCase().slice(0, 2)

  const sectorWhere = ['cl.carteira_importada=1', 'cl.ativo=1']
  const sectorParams = []
  if (uf) { sectorWhere.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?"); sectorParams.push(uf) }

  const revenueWhere = [PEDIDO_FATURADO, ITEM_ATIVO]
  const revenueParams = []
  if (period.inicio && period.fim) {
    revenueWhere.push('DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)')
    revenueParams.push(period.inicio, period.fim)
  }
  if (uf) {
    revenueWhere.push('cl.carteira_importada=1')
    revenueWhere.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?")
    revenueParams.push(uf)
  }

  const pendingWhere = [PEDIDO_NAO_FATURADO, ITEM_ATIVO, 'cl.carteira_importada=1', 'cl.ativo=1']
  const pendingParams = []
  if (period.inicio && period.fim) {
    pendingWhere.push('DATE(pe.data_pedido) BETWEEN DATE(?) AND DATE(?)')
    pendingParams.push(period.inicio, period.fim)
  }
  if (uf) { pendingWhere.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?"); pendingParams.push(uf) }

  const metaCondition = period.inicio ? 'ano_mes BETWEEN ? AND ?' : '1=1'
  const metaParams = period.inicio ? [period.inicio.slice(0, 7), period.fim.slice(0, 7)] : []

  const reportSql = `
    WITH metas_periodo AS (
      SELECT consultor_id,
        SUM(ol_sem_combate) ol_sem_combate,
        SUM(ol_prioritarios) ol_prioritarios,
        SUM(ol_lancamentos) ol_lancamentos
      FROM metas WHERE escopo='consultor' AND ${metaCondition}
      GROUP BY consultor_id
    ), setores_carteira AS (
      SELECT cl.consultor_id,MIN(NULLIF(TRIM(cl.setor_rep),'')) setor_carteira
        FROM clientes cl
       WHERE ${sectorWhere.join(' AND ')}
       GROUP BY cl.consultor_id
    ), faturamento_periodo AS (
      SELECT ${CONSULTOR_FATURAMENTO} consultor_id,
        COALESCE(SUM(ip.valor_faturado),0) ol_total_faturado,
        COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) ol_sem_combate,
        COALESCE(SUM(CASE WHEN ${MIX_PRIORITARIO} THEN ip.valor_faturado ELSE 0 END),0) ol_prioritarios,
        COALESCE(SUM(CASE WHEN ${MIX_LANCAMENTO} THEN ip.valor_faturado ELSE 0 END),0) ol_lancamentos
      FROM itens_pedido ip
      JOIN pedidos pe ON pe.id=ip.pedido_id
      LEFT JOIN clientes cl ON cl.id=pe.cliente_id
      LEFT JOIN produtos pr ON pr.id=ip.produto_id
      WHERE ${revenueWhere.join(' AND ')}
      GROUP BY ${CONSULTOR_FATURAMENTO}
    ), pendentes_periodo AS (
      SELECT cl.consultor_id,
        COALESCE(SUM(${VALOR_ITEM_NAO_FATURADO}),0) valor_nao_faturado,
        COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ${VALOR_ITEM_NAO_FATURADO} ELSE 0 END),0) valor_nao_faturado_sem_combate,
        COALESCE(SUM(CASE WHEN ${MIX_PRIORITARIO} THEN ${VALOR_ITEM_NAO_FATURADO} ELSE 0 END),0) valor_nao_faturado_prioritarios,
        COALESCE(SUM(CASE WHEN ${MIX_LANCAMENTO} THEN ${VALOR_ITEM_NAO_FATURADO} ELSE 0 END),0) valor_nao_faturado_lancamentos,
        COALESCE(SUM(CASE WHEN ${MIX_COMBATE} THEN ${VALOR_ITEM_NAO_FATURADO} ELSE 0 END),0) valor_nao_faturado_combate
      FROM itens_pedido ip
      JOIN pedidos pe ON pe.id=ip.pedido_id
      JOIN clientes cl ON cl.id=pe.cliente_id
      LEFT JOIN produtos pr ON pr.id=ip.produto_id
      WHERE ${pendingWhere.join(' AND ')}
      GROUP BY cl.consultor_id
    )
    SELECT c.id,c.nome,sc.setor_carteira,
      COALESCE(fp.ol_total_faturado,0) ol_total_faturado,
      COALESCE(fp.ol_sem_combate,0) ol_sem_combate,
      COALESCE(fp.ol_prioritarios,0) ol_prioritarios,
      COALESCE(fp.ol_lancamentos,0) ol_lancamentos,
      COALESCE(m.ol_sem_combate,0) meta_ol_sem_combate,
      COALESCE(m.ol_prioritarios,0) meta_ol_prioritarios,
      COALESCE(m.ol_lancamentos,0) meta_ol_lancamentos,
      COALESCE(pd.valor_nao_faturado,0) valor_nao_faturado,
      COALESCE(pd.valor_nao_faturado_sem_combate,0) valor_nao_faturado_sem_combate,
      COALESCE(pd.valor_nao_faturado_prioritarios,0) valor_nao_faturado_prioritarios,
      COALESCE(pd.valor_nao_faturado_lancamentos,0) valor_nao_faturado_lancamentos,
      COALESCE(pd.valor_nao_faturado_combate,0) valor_nao_faturado_combate
    FROM consultores c
    LEFT JOIN setores_carteira sc ON sc.consultor_id=c.id
    LEFT JOIN faturamento_periodo fp ON fp.consultor_id=c.id
    LEFT JOIN metas_periodo m ON m.consultor_id=c.id
    LEFT JOIN pendentes_periodo pd ON pd.consultor_id=c.id
    WHERE c.ativo=1 AND c.origem='PAINEL_EQUIPE'
    ORDER BY ol_sem_combate DESC,c.nome COLLATE NOCASE
  `
  const managerSql = `
    SELECT COALESCE(SUM(ol_sem_combate),0) ol_sem_combate,
      COALESCE(SUM(ol_prioritarios),0) ol_prioritarios,
      COALESCE(SUM(ol_lancamentos),0) ol_lancamentos
    FROM metas WHERE escopo='gerente' AND ${metaCondition}
  `

  const [reportResult, managerResult] = await env.DB.batch([
    env.DB.prepare(reportSql).bind(...metaParams, ...sectorParams, ...revenueParams, ...pendingParams),
    env.DB.prepare(managerSql).bind(...metaParams),
  ])

  const rows = (reportResult.results || []).map((item) => {
    const name = text(item.nome)
    return {
      id: text(item.id),
      nome: name,
      setor: text(item.setor_carteira || SETORES[normalizeName(name)] || ''),
      ol_total_faturado: number(item.ol_total_faturado),
      ol_sem_combate: number(item.ol_sem_combate),
      ol_prioritarios: number(item.ol_prioritarios),
      ol_lancamentos: number(item.ol_lancamentos),
      meta_ol_sem_combate: number(item.meta_ol_sem_combate),
      meta_ol_prioritarios: number(item.meta_ol_prioritarios),
      meta_ol_lancamentos: number(item.meta_ol_lancamentos),
      valor_nao_faturado: number(item.valor_nao_faturado),
      valor_nao_faturado_sem_combate: number(item.valor_nao_faturado_sem_combate),
      valor_nao_faturado_prioritarios: number(item.valor_nao_faturado_prioritarios),
      valor_nao_faturado_lancamentos: number(item.valor_nao_faturado_lancamentos),
      valor_nao_faturado_combate: number(item.valor_nao_faturado_combate),
    }
  }).filter((item) => item.id && item.nome)

  const managerGoal = managerResult.results?.[0] || {}
  return { period, uf, rows, total: totalize(rows, managerGoal), regra_faturamento: 'Representante de origem do Bússola.' }
}
