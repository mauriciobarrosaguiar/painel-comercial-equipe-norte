import { ITEM_FATURADO, MIX_SEM_COMBATE, PEDIDO_FATURADO } from '../../_lib/commercial.js'
import { authorized, json } from '../../_lib/credentials.js'

const DATA = 'DATE(COALESCE(pe.data_faturamento,pe.data_pedido))'
const STATUS_FATURADO = "UPPER(TRIM(COALESCE(pe.status,''))) IN ('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO')"
const TIPOS_VALIDOS = "'LINHA','PRIORITARIO','LANCAMENTO','COMBATE'"

function parametrosPeriodo(request) {
  const params = new URL(request.url).searchParams
  const inicio = params.get('inicio') || ''
  const fim = params.get('fim') || ''
  if (!inicio && !fim) return { inicio: null, fim: null, sql: '', valores: [] }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    throw new Error('Informe data inicial e final válidas.')
  }
  if (inicio > fim) throw new Error('A data inicial não pode ser posterior à data final.')
  return {
    inicio,
    fim,
    sql: ` AND ${DATA} BETWEEN DATE(?) AND DATE(?)`,
    valores: [inicio, fim],
  }
}

function stmt(env, sql, values = []) {
  return values.length ? env.DB.prepare(sql).bind(...values) : env.DB.prepare(sql)
}

function row(result, index) {
  return result[index]?.results?.[0] || {}
}

function number(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function hojeSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

async function executarAuditoria(request, env) {
  const periodo = parametrosPeriodo(request)
  const periodoSql = periodo.sql
  const valores = periodo.valores
  const consultas = [
    stmt(env, `
      SELECT COUNT(DISTINCT pe.id) pedidos, COUNT(ip.id) itens,
             COALESCE(SUM(ip.valor_faturado),0) valor_total,
             MIN(COALESCE(pe.data_faturamento,pe.data_pedido)) primeira_data,
             MAX(COALESCE(pe.data_faturamento,pe.data_pedido)) ultima_data
        FROM itens_pedido ip JOIN pedidos pe ON pe.id=ip.pedido_id
       WHERE ${ITEM_FATURADO}${periodoSql}`, valores),
    stmt(env, `
      SELECT
        COALESCE(SUM(ip.valor_faturado),0) ol_total,
        COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) ol_sem_combate,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='COMBATE' THEN ip.valor_faturado ELSE 0 END),0) ol_combate,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='PRIORITARIO' THEN ip.valor_faturado ELSE 0 END),0) ol_prioritarios,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='LANCAMENTO' THEN ip.valor_faturado ELSE 0 END),0) ol_lancamentos,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(COALESCE(pr.tipo_mix,''))) NOT IN (${TIPOS_VALIDOS}) THEN ip.valor_faturado ELSE 0 END),0) ol_sem_classificacao,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(pr.tipo_mix,''))) NOT IN (${TIPOS_VALIDOS}) THEN 1 ELSE 0 END) itens_sem_classificacao
        FROM itens_pedido ip JOIN pedidos pe ON pe.id=ip.pedido_id
        LEFT JOIN produtos pr ON pr.id=ip.produto_id
       WHERE ${ITEM_FATURADO}${periodoSql}`, valores),
    stmt(env, `
      SELECT
        COUNT(DISTINCT CASE WHEN pe.cliente_id IS NULL OR cl.id IS NULL THEN pe.id END) pedidos_sem_cnpj_vinculado,
        COUNT(DISTINCT CASE WHEN cl.id IS NOT NULL AND COALESCE(cl.carteira_importada,0)<>1 THEN pe.id END) pedidos_fora_carteira,
        COUNT(DISTINCT CASE WHEN pe.consultor_id IS NULL OR co.id IS NULL THEN pe.id END) pedidos_sem_consultor
        FROM pedidos pe
        LEFT JOIN clientes cl ON cl.id=pe.cliente_id
        LEFT JOIN consultores co ON co.id=pe.consultor_id
       WHERE ${PEDIDO_FATURADO}${periodoSql}`, valores),
    stmt(env, `
      SELECT
        SUM(CASE WHEN TRIM(COALESCE(ip.ean,''))='' THEN 1 ELSE 0 END) itens_sem_ean,
        SUM(CASE WHEN ip.produto_id IS NULL OR pr.id IS NULL THEN 1 ELSE 0 END) itens_sem_produto,
        SUM(CASE WHEN COALESCE(ip.valor_faturado,0)<0 THEN 1 ELSE 0 END) itens_valor_negativo,
        COALESCE(SUM(CASE WHEN COALESCE(ip.valor_faturado,0)<0 THEN ip.valor_faturado ELSE 0 END),0) valor_negativo
        FROM itens_pedido ip JOIN pedidos pe ON pe.id=ip.pedido_id
        LEFT JOIN produtos pr ON pr.id=ip.produto_id
       WHERE ${ITEM_FATURADO}${periodoSql}`, valores),
    stmt(env, `
      SELECT
        SUM(CASE WHEN TRIM(COALESCE(cnpj,''))='' THEN 1 ELSE 0 END) clientes_sem_cnpj,
        SUM(CASE WHEN consultor_id IS NULL OR TRIM(COALESCE(consultor_id,''))='' THEN 1 ELSE 0 END) clientes_sem_consultor,
        SUM(CASE WHEN LENGTH(TRIM(COALESCE(uf,'')))<>2 THEN 1 ELSE 0 END) clientes_sem_uf
        FROM clientes WHERE carteira_importada=1 AND ativo=1`),
    stmt(env, `
      SELECT
        SUM(CASE WHEN COALESCE(pe.data_faturamento,pe.data_pedido) IS NULL
                       OR julianday(COALESCE(pe.data_faturamento,pe.data_pedido)) IS NULL THEN 1 ELSE 0 END) datas_invalidas,
        SUM(CASE WHEN DATE(COALESCE(pe.data_faturamento,pe.data_pedido))>DATE(?) THEN 1 ELSE 0 END) datas_futuras
        FROM pedidos pe WHERE pe.ativo=1 AND ${STATUS_FATURADO}${periodoSql}`,
      [hojeSaoPaulo(), ...valores]),
    stmt(env, `
      SELECT COALESCE(SUM(repeticoes-1),0) duplicatas
        FROM (
          SELECT COUNT(*) repeticoes FROM pedidos pe
           WHERE pe.ativo=1 AND ${STATUS_FATURADO}${periodoSql}
           GROUP BY pe.origem,pe.pedido_origem,COALESCE(pe.nota_fiscal,'')
          HAVING COUNT(*)>1
        )`, valores),
    stmt(env, `
      SELECT COALESCE(SUM(repeticoes-1),0) duplicatas
        FROM (
          SELECT COUNT(*) repeticoes
            FROM itens_pedido ip JOIN pedidos pe ON pe.id=ip.pedido_id
           WHERE ${ITEM_FATURADO}${periodoSql}
           GROUP BY ip.pedido_id,COALESCE(ip.ean,''),COALESCE(ip.descricao,''),
                    COALESCE(ip.quantidade_faturada,0),COALESCE(ip.valor_faturado,0)
          HAVING COUNT(*)>1
        )`, valores),
    stmt(env, `
      SELECT COUNT(*) pedidos_divergentes
        FROM (
          SELECT pe.id,pe.valor_faturado,COALESCE(SUM(ip.valor_faturado),0) soma_itens
            FROM pedidos pe LEFT JOIN itens_pedido ip ON ip.pedido_id=pe.id AND ip.ativo=1
           WHERE ${PEDIDO_FATURADO}${periodoSql}
           GROUP BY pe.id,pe.valor_faturado
          HAVING ABS(COALESCE(pe.valor_faturado,0)-COALESCE(SUM(ip.valor_faturado),0))>0.01
        )`, valores),
    stmt(env, `
      SELECT COUNT(*) pedidos,COALESCE(SUM(pe.valor_faturado),0) valor
        FROM pedidos pe
       WHERE pe.ativo=1 AND UPPER(TRIM(COALESCE(pe.status,''))) LIKE '%FATURAD%'
         AND NOT (${STATUS_FATURADO})
         AND UPPER(TRIM(COALESCE(pe.status,''))) NOT LIKE '%NAO FATURAD%'
         AND UPPER(TRIM(COALESCE(pe.status,''))) NOT LIKE '%NÃO FATURAD%'
         AND UPPER(TRIM(COALESCE(pe.status,''))) NOT LIKE '%CANCEL%'`),
  ]

  const results = await env.DB.batch(consultas)
  const volume = row(results, 0)
  const mix = row(results, 1)
  const vinculos = row(results, 2)
  const itens = row(results, 3)
  const clientes = row(results, 4)
  const datas = row(results, 5)
  const duplicatasPedidos = number(row(results, 6).duplicatas)
  const duplicatasItens = number(row(results, 7).duplicatas)
  const pedidosDivergentes = number(row(results, 8).pedidos_divergentes)
  const statusExcluidos = row(results, 9)

  const olTotal = number(mix.ol_total)
  const olSemCombate = number(mix.ol_sem_combate)
  const olCombate = number(mix.ol_combate)
  const olSemClassificacao = number(mix.ol_sem_classificacao)
  const diferencaConciliacao = olTotal - olSemCombate - olCombate - olSemClassificacao
  const alertasCriticos = number(vinculos.pedidos_sem_cnpj_vinculado)
    + number(vinculos.pedidos_fora_carteira)
    + number(vinculos.pedidos_sem_consultor)
    + number(datas.datas_invalidas)
    + number(datas.datas_futuras)
  const totalAlertas = alertasCriticos
    + number(itens.itens_sem_ean)
    + number(itens.itens_sem_produto)
    + number(mix.itens_sem_classificacao)
    + number(clientes.clientes_sem_cnpj)
    + number(clientes.clientes_sem_consultor)
    + number(clientes.clientes_sem_uf)
    + duplicatasPedidos + duplicatasItens + pedidosDivergentes
    + number(statusExcluidos.pedidos)

  return {
    periodo: { inicio: periodo.inicio, fim: periodo.fim },
    status: alertasCriticos > 0 ? 'critico' : totalAlertas > 0 ? 'atencao' : 'ok',
    total_alertas: totalAlertas,
    executado_em: new Date().toISOString(),
    volume: {
      pedidos_faturados: number(volume.pedidos),
      itens_faturados: number(volume.itens),
      valor_total: number(volume.valor_total),
      primeira_data: volume.primeira_data || null,
      ultima_data: volume.ultima_data || null,
    },
    conciliacao: {
      ol_total: olTotal,
      ol_sem_combate: olSemCombate,
      ol_combate: olCombate,
      ol_prioritarios: number(mix.ol_prioritarios),
      ol_lancamentos: number(mix.ol_lancamentos),
      ol_sem_classificacao: olSemClassificacao,
      diferenca: diferencaConciliacao,
    },
    vinculos: {
      pedidos_sem_cnpj_vinculado: number(vinculos.pedidos_sem_cnpj_vinculado),
      pedidos_fora_carteira: number(vinculos.pedidos_fora_carteira),
      pedidos_sem_consultor: number(vinculos.pedidos_sem_consultor),
      itens_sem_ean: number(itens.itens_sem_ean),
      itens_sem_produto: number(itens.itens_sem_produto),
      itens_sem_classificacao: number(mix.itens_sem_classificacao),
    },
    qualidade: {
      clientes_sem_cnpj: number(clientes.clientes_sem_cnpj),
      clientes_sem_consultor: number(clientes.clientes_sem_consultor),
      clientes_sem_uf: number(clientes.clientes_sem_uf),
      datas_invalidas: number(datas.datas_invalidas),
      datas_futuras: number(datas.datas_futuras),
      duplicatas_pedidos: duplicatasPedidos,
      duplicatas_itens: duplicatasItens,
      pedidos_valor_divergente: pedidosDivergentes,
      itens_valor_negativo: number(itens.itens_valor_negativo),
      valor_negativo: number(itens.valor_negativo),
      status_faturado_excluido: number(statusExcluidos.pedidos),
      valor_status_excluido: number(statusExcluidos.valor),
    },
  }
}

async function validarAcesso(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return json({ erro: 'Chave administrativa não configurada.' }, 503)
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Chave administrativa inválida.' }, 401)
  }
  return null
}

export async function onRequestGet({ request, env }) {
  const acesso = await validarAcesso(request, env)
  if (acesso) return acesso
  try {
    const result = await env.DB.prepare(`
      SELECT id,periodo_inicio,periodo_fim,status,total_alertas,resultado_json,criado_em
        FROM auditorias_calculos ORDER BY criado_em DESC LIMIT 10`).all()
    return json({ auditorias: (result.results || []).map((item) => ({
      id: item.id,
      periodo_inicio: item.periodo_inicio,
      periodo_fim: item.periodo_fim,
      status: item.status,
      total_alertas: number(item.total_alertas),
      criado_em: item.criado_em,
      resultado: JSON.parse(String(item.resultado_json || '{}')),
    })) })
  } catch (error) {
    return json({ erro: 'Não foi possível consultar as auditorias.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  const acesso = await validarAcesso(request, env)
  if (acesso) return acesso
  try {
    const resultado = await executarAuditoria(request, env)
    const id = crypto.randomUUID()
    await env.DB.prepare(`
      INSERT INTO auditorias_calculos
        (id,periodo_inicio,periodo_fim,status,total_alertas,resultado_json,criado_em)
      VALUES (?,?,?,?,?,?,?)`).bind(
      id,
      resultado.periodo.inicio,
      resultado.periodo.fim,
      resultado.status,
      resultado.total_alertas,
      JSON.stringify(resultado),
      resultado.executado_em,
    ).run()
    return json({ id, ...resultado })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    return json({ erro: 'Não foi possível executar a auditoria.', detalhe }, detalhe.includes('data inicial') || detalhe.includes('data final') ? 400 : 500)
  }
}
