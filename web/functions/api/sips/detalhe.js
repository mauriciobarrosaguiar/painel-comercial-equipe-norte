import {
  ITEM_FATURADO,
  MIX_SEM_COMBATE,
  PEDIDO_NAO_FATURADO,
  VALOR_ITEM_NAO_FATURADO,
} from '../../_lib/commercial.js'
import { json } from '../../_lib/credentials.js'

const texto = (valor) => String(valor ?? '').trim()
const numero = (valor) => Number.isFinite(Number(valor)) ? Number(valor) : 0
const iso = (ano, mes, dia) => `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
const hoje = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

function diasUteis(inicio, fim) {
  if (!inicio || !fim || inicio > fim) return 0
  const atual = new Date(`${inicio}T12:00:00Z`)
  const final = new Date(`${fim}T12:00:00Z`)
  let total = 0
  while (atual <= final) {
    const dia = atual.getUTCDay()
    if (dia !== 0 && dia !== 6) total += 1
    atual.setUTCDate(atual.getUTCDate() + 1)
  }
  return total
}

function projetar(valor, inicio, fim) {
  const dataHoje = hoje()
  const total = diasUteis(inicio, fim)
  if (!total) return valor
  if (dataHoje < inicio) return 0
  const decorridos = diasUteis(inicio, dataHoje > fim ? fim : dataHoje)
  return decorridos > 0 ? valor / decorridos * total : valor
}

function faixa(params) {
  const inicio = texto(params.get('inicio'))
  const fim = texto(params.get('fim'))
  if (/^\d{4}-\d{2}-\d{2}$/.test(inicio) && /^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    return { inicio, fim }
  }
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map((item) => [item.type, item.value]))
  const ano = Number(partes.year)
  const mes = Number(partes.month)
  return {
    inicio: iso(ano, mes, 1),
    fim: iso(ano, mes, new Date(Date.UTC(ano, mes, 0)).getUTCDate()),
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const id = texto(params.get('id'))
    const publico = params.get('publico') === '1'
    if (!id) return json({ erro: 'SIP não informada.' }, 400)

    const sip = await env.DB.prepare(
      'SELECT id,nome,meta_mes,pagamento_percentual,acesso_publico_ativo,ativo FROM sips WHERE id=? AND ativo=1',
    ).bind(id).first()
    if (!sip) return json({ erro: 'SIP não encontrada.' }, 404)
    if (publico && !Number(sip.acesso_publico_ativo || 0)) {
      return json({ erro: 'Este acesso individual está desativado.' }, 403)
    }

    const { inicio, fim } = faixa(params)
    const clientesSql = `
      WITH vendas AS (
        SELECT pe.cliente_id,
               COUNT(DISTINCT pe.id) pedidos,
               COALESCE(SUM(ip.valor_faturado),0) ol_total,
               COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) ol_sem_combate,
               COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='PRIORITARIO' THEN ip.valor_faturado ELSE 0 END),0) prioritarios,
               COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='LANCAMENTO' THEN ip.valor_faturado ELSE 0 END),0) lancamentos,
               MAX(DATE(COALESCE(pe.data_faturamento,pe.data_pedido))) ultima_compra
          FROM pedidos pe
          JOIN itens_pedido ip ON ip.pedido_id=pe.id
          LEFT JOIN produtos pr ON pr.id=ip.produto_id
         WHERE ${ITEM_FATURADO}
           AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)
         GROUP BY pe.cliente_id
      ),
      status_notas AS (
        SELECT pe.cliente_id,
               COUNT(DISTINCT CASE
                 WHEN UPPER(TRIM(COALESCE(pe.status,''))) IN('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO')
                 THEN pe.id END) notas_faturadas,
               COUNT(DISTINCT CASE
                 WHEN UPPER(TRIM(COALESCE(pe.status,''))) LIKE '%CANCEL%'
                   OR UPPER(TRIM(COALESCE(pe.status,''))) LIKE '%NAO FATUR%'
                   OR UPPER(TRIM(COALESCE(pe.status,''))) LIKE '%NÃO FATUR%'
                 THEN pe.id END) notas_canceladas
          FROM pedidos pe
         WHERE pe.ativo=1
           AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)
         GROUP BY pe.cliente_id
      ),
      pendentes AS (
        SELECT pe.cliente_id,
               COUNT(DISTINCT pe.id) notas_a_faturar,
               COALESCE(SUM(${VALOR_ITEM_NAO_FATURADO}),0) valor_a_faturar
          FROM pedidos pe
          JOIN itens_pedido ip ON ip.pedido_id=pe.id AND ip.ativo=1
         WHERE ${PEDIDO_NAO_FATURADO}
           AND DATE(pe.data_pedido) BETWEEN DATE(?) AND DATE(?)
         GROUP BY pe.cliente_id
      )
      SELECT cl.id,cl.cnpj,
             COALESCE(cl.nome_fantasia,cl.razao_social,cl.cnpj) nome,
             cl.cidade,cl.uf,co.nome consultor,cl.nome_gd gd,
             COALESCE(v.pedidos,0) pedidos,
             COALESCE(v.ol_total,0) ol_total,
             COALESCE(v.ol_sem_combate,0) ol_sem_combate,
             COALESCE(v.prioritarios,0) prioritarios,
             COALESCE(v.lancamentos,0) lancamentos,
             v.ultima_compra,
             COALESCE(sn.notas_faturadas,0) notas_faturadas,
             COALESCE(sn.notas_canceladas,0) notas_canceladas,
             COALESCE(pn.notas_a_faturar,0) notas_a_faturar,
             COALESCE(pn.valor_a_faturar,0) valor_a_faturar
        FROM sip_clientes sc
        JOIN clientes cl
          ON cl.cnpj=sc.cnpj AND cl.carteira_importada=1 AND cl.ativo=1
        LEFT JOIN consultores co ON co.id=cl.consultor_id
        LEFT JOIN vendas v ON v.cliente_id=cl.id
        LEFT JOIN status_notas sn ON sn.cliente_id=cl.id
        LEFT JOIN pendentes pn ON pn.cliente_id=cl.id
       WHERE sc.sip_id=? AND sc.ativo=1
       ORDER BY ol_sem_combate DESC,nome COLLATE NOCASE
    `
    const produtosSql = `
      SELECT COALESCE(pr.ean,ip.ean,'') ean,
             COALESCE(pr.descricao,ip.descricao,'Produto sem descrição') produto,
             COALESCE(pr.tipo_mix,'SEM CLASSIFICACAO') tipo_mix,
             COALESCE(SUM(ip.quantidade_faturada),0) quantidade,
             COALESCE(SUM(ip.valor_faturado),0) faturamento,
             COUNT(DISTINCT pe.id) pedidos
        FROM sip_clientes sc
        JOIN clientes cl
          ON cl.cnpj=sc.cnpj AND cl.carteira_importada=1 AND cl.ativo=1
        JOIN pedidos pe ON pe.cliente_id=cl.id
        JOIN itens_pedido ip ON ip.pedido_id=pe.id
        LEFT JOIN produtos pr ON pr.id=ip.produto_id
       WHERE sc.sip_id=? AND sc.ativo=1
         AND ${ITEM_FATURADO}
         AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)
       GROUP BY COALESCE(pr.id,ip.ean,ip.descricao)
       ORDER BY faturamento DESC,produto COLLATE NOCASE
    `
    const consultoresPendentesSql = `
      SELECT co.id,co.nome,MIN(NULLIF(TRIM(cl.setor_rep),'')) setor,
             COUNT(DISTINCT pe.id) pedidos_nao_faturados,
             COALESCE(SUM(${VALOR_ITEM_NAO_FATURADO}),0) valor_nao_faturado
        FROM sip_clientes sc
        JOIN clientes cl
          ON cl.cnpj=sc.cnpj AND cl.carteira_importada=1 AND cl.ativo=1
        JOIN consultores co ON co.id=cl.consultor_id
        JOIN pedidos pe ON pe.cliente_id=cl.id
        JOIN itens_pedido ip ON ip.pedido_id=pe.id AND ip.ativo=1
       WHERE sc.sip_id=? AND sc.ativo=1
         AND ${PEDIDO_NAO_FATURADO}
         AND DATE(pe.data_pedido) BETWEEN DATE(?) AND DATE(?)
       GROUP BY co.id,co.nome
       ORDER BY valor_nao_faturado DESC,co.nome COLLATE NOCASE
    `

    const [clientesResult, produtosResult, consultoresPendentesResult] = await env.DB.batch([
      env.DB.prepare(clientesSql).bind(inicio, fim, inicio, fim, inicio, fim, id),
      env.DB.prepare(produtosSql).bind(id, inicio, fim),
      env.DB.prepare(consultoresPendentesSql).bind(id, inicio, fim),
    ])

    const clientes = (clientesResult.results || []).map((item) => ({
      ...item,
      pedidos: numero(item.pedidos),
      ol_total: numero(item.ol_total),
      ol_sem_combate: numero(item.ol_sem_combate),
      prioritarios: numero(item.prioritarios),
      lancamentos: numero(item.lancamentos),
      notas_faturadas: numero(item.notas_faturadas),
      notas_canceladas: numero(item.notas_canceladas),
      notas_a_faturar: numero(item.notas_a_faturar),
      valor_a_faturar: numero(item.valor_a_faturar),
    }))
    const produtos = (produtosResult.results || []).map((item) => ({
      ...item,
      quantidade: numero(item.quantidade),
      faturamento: numero(item.faturamento),
      pedidos: numero(item.pedidos),
    }))
    const pendentesPorConsultor = (consultoresPendentesResult.results || []).map((item) => ({
      id: String(item.id || ''),
      nome: String(item.nome || ''),
      setor: String(item.setor || ''),
      pedidos_nao_faturados: numero(item.pedidos_nao_faturados),
      valor_nao_faturado: numero(item.valor_nao_faturado),
    }))
    const totais = clientes.reduce((acumulado, item) => ({
      clientes_ativos: acumulado.clientes_ativos + 1,
      clientes_com_venda: acumulado.clientes_com_venda + (item.ol_total > 0 ? 1 : 0),
      pedidos: acumulado.pedidos + item.pedidos,
      ol_total: acumulado.ol_total + item.ol_total,
      ol_sem_combate: acumulado.ol_sem_combate + item.ol_sem_combate,
      prioritarios: acumulado.prioritarios + item.prioritarios,
      lancamentos: acumulado.lancamentos + item.lancamentos,
      notas_faturadas: acumulado.notas_faturadas + item.notas_faturadas,
      notas_canceladas: acumulado.notas_canceladas + item.notas_canceladas,
      notas_a_faturar: acumulado.notas_a_faturar + item.notas_a_faturar,
      valor_a_faturar: acumulado.valor_a_faturar + item.valor_a_faturar,
    }), {
      clientes_ativos: 0,
      clientes_com_venda: 0,
      pedidos: 0,
      ol_total: 0,
      ol_sem_combate: 0,
      prioritarios: 0,
      lancamentos: 0,
      notas_faturadas: 0,
      notas_canceladas: 0,
      notas_a_faturar: 0,
      valor_a_faturar: 0,
    })
    const meta = numero(sip.meta_mes)
    const projetado = projetar(totais.ol_sem_combate, inicio, fim)
    const origin = new URL(request.url).origin

    return json({
      sip: {
        ...sip,
        meta_mes: meta,
        pagamento_percentual: numero(sip.pagamento_percentual),
      },
      periodo: { inicio, fim },
      totais: {
        ...totais,
        clientes_sem_venda: Math.max(0, totais.clientes_ativos - totais.clientes_com_venda),
        resultado_meta: meta > 0 ? totais.ol_sem_combate / meta * 100 : 0,
        projecao_ol_sem_combate: projetado,
        projecao_meta: meta > 0 ? projetado / meta * 100 : 0,
      },
      clientes,
      produtos,
      pendentes_por_consultor: pendentesPorConsultor,
      link_publico: `${origin}/?sip=${encodeURIComponent(id)}`,
      link_exportacao: `${origin}/api/exportar?tipo=sip_detalhado&formato=csv&publico=1&sip_id=${encodeURIComponent(id)}&inicio=${inicio}&fim=${fim}`,
    })
  } catch (error) {
    return json({
      erro: 'Não foi possível abrir a SIP.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
