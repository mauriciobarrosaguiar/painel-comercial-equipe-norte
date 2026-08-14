import { ITEM_FATURADO } from '../_lib/commercial.js'

const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const texto = (value) => String(value ?? '').trim()
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0

function mesAtual() {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((item) => [item.type, item.value]))
  return `${partes.year}-${partes.month}`
}

function faixaMes(anoMes) {
  const [ano, mes] = anoMes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return { inicio: `${anoMes}-01`, fim: `${anoMes}-${String(ultimo).padStart(2, '0')}` }
}

function baseSql() {
  return `
    WITH metas AS (
      SELECT
        m.sku,
        TRIM(COALESCE(m.ean,'')) ean,
        COALESCE(NULLIF(TRIM(m.produto_identificado),''),NULLIF(TRIM(m.produto_planilha),''),('SAP '||m.sku)) produto,
        COALESCE(m.meta_positivacao,0) meta_positivacao,
        COALESCE(m.meta_giro,0) meta_giro,
        CAST(COALESCE(m.meta_positivacao,0)*0.8 AS INTEGER)
          + CASE
              WHEN COALESCE(m.meta_positivacao,0)*0.8 > CAST(COALESCE(m.meta_positivacao,0)*0.8 AS INTEGER) THEN 1
              ELSE 0
            END alvo_positivacao_80
      FROM desafio_gigantes_metas m
      WHERE m.ano_mes=?
        AND m.escopo='consultor'
        AND m.consultor_id=?
        AND COALESCE(m.status_identificacao,'')='IDENTIFICADO'
        AND TRIM(COALESCE(m.ean,''))<>''
    ),
    carteira AS (
      SELECT
        cl.id cliente_id,
        cl.cnpj,
        COALESCE(NULLIF(TRIM(cl.nome_fantasia),''),NULLIF(TRIM(cl.razao_social),''),'Cliente sem nome') cliente,
        COALESCE(cl.cidade,'') cidade,
        COALESCE(cl.uf,'') uf
      FROM clientes cl
      WHERE cl.carteira_importada=1
        AND cl.ativo=1
        AND cl.consultor_id=?
    ),
    vendas AS (
      SELECT
        cl.id cliente_id,
        TRIM(COALESCE(ip.ean,'')) ean,
        SUM(COALESCE(ip.quantidade_faturada,0)) unidades,
        COUNT(DISTINCT pe.id) pedidos,
        MAX(DATE(COALESCE(pe.data_faturamento,pe.data_pedido))) ultima_compra
      FROM itens_pedido ip
      JOIN pedidos pe ON pe.id=ip.pedido_id
      JOIN clientes cl ON cl.id=pe.cliente_id
      WHERE ${ITEM_FATURADO}
        AND cl.carteira_importada=1
        AND cl.ativo=1
        AND cl.consultor_id=?
        AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)
        AND TRIM(COALESCE(ip.ean,''))<>''
      GROUP BY cl.id,TRIM(COALESCE(ip.ean,''))
    ),
    matriz AS (
      SELECT
        c.cliente_id,c.cnpj,c.cliente,c.cidade,c.uf,
        m.sku,m.ean,m.produto,m.meta_positivacao,m.meta_giro,m.alvo_positivacao_80,
        COALESCE(v.unidades,0) unidades,
        COALESCE(v.pedidos,0) pedidos,
        COALESCE(v.ultima_compra,'') ultima_compra,
        CASE WHEN COALESCE(v.unidades,0)>0 THEN 1 ELSE 0 END positivou
      FROM carteira c
      CROSS JOIN metas m
      LEFT JOIN vendas v ON v.cliente_id=c.cliente_id AND v.ean=m.ean
    ),
    sku_stats AS (
      SELECT
        sku,MAX(ean) ean,MAX(produto) produto,MAX(meta_positivacao) meta_positivacao,MAX(meta_giro) meta_giro,
        MAX(alvo_positivacao_80) alvo_positivacao_80,
        SUM(positivou) clientes_positivados,
        COUNT(*) total_clientes
      FROM matriz
      GROUP BY sku
    ),
    faltantes_ranqueados AS (
      SELECT
        b.cliente_id,b.sku,b.ean,b.produto,
        MAX(0,s.alvo_positivacao_80-s.clientes_positivados) falta_pdv_80,
        ROW_NUMBER() OVER (
          PARTITION BY b.cliente_id
          ORDER BY
            CASE WHEN s.clientes_positivados<s.alvo_positivacao_80 THEN 0 ELSE 1 END,
            CASE WHEN s.clientes_positivados<s.alvo_positivacao_80 THEN s.alvo_positivacao_80-s.clientes_positivados ELSE 999999 END,
            s.clientes_positivados DESC,
            b.sku
        ) prioridade
      FROM matriz b
      JOIN sku_stats s ON s.sku=b.sku
      WHERE b.positivou=0
    )
  `
}

function binds(anoMes, consultor, inicio, fim) {
  return [anoMes, consultor, consultor, consultor, inicio, fim]
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const anoMesRaw = texto(params.get('ano_mes'))
    const anoMes = /^\d{4}-\d{2}$/.test(anoMesRaw) ? anoMesRaw : mesAtual()
    const consultor = texto(params.get('consultor')).slice(0, 180)
    const clienteId = texto(params.get('cliente')).slice(0, 180)
    const sku = texto(params.get('sku')).replace(/\D/g, '').slice(0, 20)
    if (!consultor) return json({ erro: 'Selecione um consultor para abrir o mapa cliente × produto.' }, 400)
    const { inicio, fim } = faixaMes(anoMes)
    const sqlBase = baseSql()
    const parametros = binds(anoMes, consultor, inicio, fim)

    if (clienteId) {
      const detalhe = await env.DB.prepare(`${sqlBase}
        SELECT
          b.cliente_id,b.cnpj,b.cliente,b.cidade,b.uf,b.sku,b.ean,b.produto,b.unidades,b.pedidos,b.ultima_compra,b.positivou,
          s.clientes_positivados,s.total_clientes,s.alvo_positivacao_80,
          MAX(0,s.alvo_positivacao_80-s.clientes_positivados) falta_pdv_80
        FROM matriz b
        JOIN sku_stats s ON s.sku=b.sku
        WHERE b.cliente_id=?
        ORDER BY b.positivou ASC,
          CASE WHEN s.clientes_positivados<s.alvo_positivacao_80 THEN 0 ELSE 1 END,
          MAX(0,s.alvo_positivacao_80-s.clientes_positivados),
          b.produto COLLATE NOCASE
      `).bind(...parametros, clienteId).all()
      const linhas = detalhe.results || []
      return json({
        ano_mes: anoMes,
        consultor,
        cliente: linhas[0] ? { id: linhas[0].cliente_id, cnpj: linhas[0].cnpj, nome: linhas[0].cliente, cidade: linhas[0].cidade, uf: linhas[0].uf } : null,
        produtos: linhas.map((item) => ({ ...item, unidades: numero(item.unidades), pedidos: numero(item.pedidos), positivou: numero(item.positivou) === 1, clientes_positivados: numero(item.clientes_positivados), total_clientes: numero(item.total_clientes), alvo_positivacao_80: numero(item.alvo_positivacao_80), falta_pdv_80: numero(item.falta_pdv_80) })),
      })
    }

    if (sku) {
      const detalhe = await env.DB.prepare(`${sqlBase}
        SELECT
          b.cliente_id,b.cnpj,b.cliente,b.cidade,b.uf,b.sku,b.ean,b.produto,b.unidades,b.pedidos,b.ultima_compra,b.positivou,
          s.clientes_positivados,s.total_clientes,s.alvo_positivacao_80,
          MAX(0,s.alvo_positivacao_80-s.clientes_positivados) falta_pdv_80
        FROM matriz b
        JOIN sku_stats s ON s.sku=b.sku
        WHERE b.sku=?
        ORDER BY b.positivou ASC,b.cliente COLLATE NOCASE
      `).bind(...parametros, sku).all()
      const linhas = detalhe.results || []
      return json({
        ano_mes: anoMes,
        consultor,
        produto: linhas[0] ? { sku: linhas[0].sku, ean: linhas[0].ean, nome: linhas[0].produto, clientes_positivados: numero(linhas[0].clientes_positivados), total_clientes: numero(linhas[0].total_clientes), alvo_positivacao_80: numero(linhas[0].alvo_positivacao_80), falta_pdv_80: numero(linhas[0].falta_pdv_80) } : null,
        clientes: linhas.map((item) => ({ ...item, unidades: numero(item.unidades), pedidos: numero(item.pedidos), positivou: numero(item.positivou) === 1 })),
      })
    }

    const [clientesResult, produtosResult] = await env.DB.batch([
      env.DB.prepare(`${sqlBase}
        SELECT
          b.cliente_id,b.cnpj,b.cliente,b.cidade,b.uf,
          COUNT(*) total_skus,
          SUM(b.positivou) positivados,
          COUNT(*)-SUM(b.positivou) faltantes,
          COALESCE(MAX(CASE WHEN f.prioridade=1 THEN f.sku END),'') recomendacao_sku,
          COALESCE(MAX(CASE WHEN f.prioridade=1 THEN f.ean END),'') recomendacao_ean,
          COALESCE(MAX(CASE WHEN f.prioridade=1 THEN f.produto END),'') recomendacao_produto,
          COALESCE(MAX(CASE WHEN f.prioridade=1 THEN f.falta_pdv_80 END),0) recomendacao_falta_pdv_80
        FROM matriz b
        LEFT JOIN faltantes_ranqueados f ON f.cliente_id=b.cliente_id AND f.prioridade=1
        GROUP BY b.cliente_id,b.cnpj,b.cliente,b.cidade,b.uf
        ORDER BY faltantes DESC,b.cliente COLLATE NOCASE
      `).bind(...parametros),
      env.DB.prepare(`${sqlBase}
        SELECT
          s.sku,s.ean,s.produto,s.meta_positivacao,s.meta_giro,s.alvo_positivacao_80,
          s.clientes_positivados,s.total_clientes,
          s.total_clientes-s.clientes_positivados clientes_sem_compra,
          MAX(0,s.alvo_positivacao_80-s.clientes_positivados) falta_pdv_80
        FROM sku_stats s
        ORDER BY
          CASE WHEN s.clientes_positivados<s.alvo_positivacao_80 THEN 0 ELSE 1 END,
          MAX(0,s.alvo_positivacao_80-s.clientes_positivados),
          clientes_sem_compra DESC,
          s.produto COLLATE NOCASE
      `).bind(...parametros),
    ])

    const clientes = (clientesResult.results || []).map((item) => ({
      ...item,
      total_skus: numero(item.total_skus),
      positivados: numero(item.positivados),
      faltantes: numero(item.faltantes),
      recomendacao_falta_pdv_80: numero(item.recomendacao_falta_pdv_80),
    }))
    const produtos = (produtosResult.results || []).map((item) => ({
      ...item,
      meta_positivacao: numero(item.meta_positivacao),
      meta_giro: numero(item.meta_giro),
      alvo_positivacao_80: numero(item.alvo_positivacao_80),
      clientes_positivados: numero(item.clientes_positivados),
      total_clientes: numero(item.total_clientes),
      clientes_sem_compra: numero(item.clientes_sem_compra),
      falta_pdv_80: numero(item.falta_pdv_80),
    }))

    return json({
      ano_mes: anoMes,
      consultor,
      resumo: {
        clientes: clientes.length,
        skus: produtos.length,
        oportunidades: clientes.reduce((total, item) => total + item.faltantes, 0),
      },
      clientes,
      produtos,
      atualizado_em: new Date().toISOString(),
      aviso: 'Positivação gerencial: o cliente é considerado positivado no produto quando há quantidade faturada líquida positiva no mês selecionado.',
    })
  } catch (error) {
    return json({ erro: 'Não foi possível montar o mapa cliente × produto do Desafio de Gigantes.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
