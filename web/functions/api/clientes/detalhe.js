import { ITEM_FATURADO } from '../../_lib/commercial.js'

const HEADERS = { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store, no-cache, must-revalidate' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const validarData = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''))

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const id = String(params.get('id') || '').trim()
    if (!id) return json({ erro: 'Informe o cliente.' }, 400)

    const inicio = validarData(params.get('inicio')) ? params.get('inicio') : null
    const fim = validarData(params.get('fim')) ? params.get('fim') : null
    if ((inicio && !fim) || (!inicio && fim) || (inicio && fim && inicio > fim)) return json({ erro: 'Período inválido.' }, 400)
    const condPeriodo = inicio ? 'AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)' : ''
    const bindsPeriodo = inicio ? [inicio, fim] : []

    const clienteStmt = env.DB.prepare(`
      SELECT cl.id,cl.cnpj,COALESCE(cl.nome_fantasia,cl.razao_social,'Cliente sem nome') nome,
        COALESCE(cl.cidade,'') cidade,COALESCE(cl.uf,'') uf,COALESCE(cl.nome_gd,'') gd,
        COALESCE(co.nome,'') consultor,COALESCE(cl.grupo_economico,'') grupo_economico,
        COALESCE(cl.rede_associacao,'') rede_associacao,COALESCE(cl.bandeira,'') bandeira,
        COALESCE(cl.situacao,'') situacao
      FROM clientes cl LEFT JOIN consultores co ON co.id=cl.consultor_id
      WHERE cl.id=? AND cl.carteira_importada=1 LIMIT 1
    `).bind(id)

    const resumoStmt = env.DB.prepare(`
      SELECT COUNT(DISTINCT pe.id) pedidos,COALESCE(SUM(ip.valor_faturado),0) faturamento,
        COUNT(DISTINCT ip.produto_id) produtos,MAX(DATE(COALESCE(pe.data_faturamento,pe.data_pedido))) ultima_compra,
        COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='PRIORITARIO' THEN ip.valor_faturado ELSE 0 END),0) prioritarios,
        COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='LANCAMENTO' THEN ip.valor_faturado ELSE 0 END),0) lancamentos
      FROM pedidos pe JOIN itens_pedido ip ON ip.pedido_id=pe.id LEFT JOIN produtos pr ON pr.id=ip.produto_id
      WHERE pe.cliente_id=? AND ${ITEM_FATURADO} ${condPeriodo}
    `).bind(id, ...bindsPeriodo)

    const historicoStmt = env.DB.prepare(`
      SELECT SUBSTR(DATE(COALESCE(pe.data_faturamento,pe.data_pedido)),1,7) ano_mes,
        COALESCE(SUM(ip.valor_faturado),0) faturamento,COUNT(DISTINCT pe.id) pedidos,
        COUNT(DISTINCT ip.produto_id) produtos
      FROM pedidos pe JOIN itens_pedido ip ON ip.pedido_id=pe.id
      WHERE pe.cliente_id=? AND ${ITEM_FATURADO}
      GROUP BY SUBSTR(DATE(COALESCE(pe.data_faturamento,pe.data_pedido)),1,7)
      ORDER BY ano_mes DESC LIMIT 18
    `).bind(id)

    const produtosStmt = env.DB.prepare(`
      SELECT COALESCE(pr.descricao,ip.descricao,'Produto sem descrição') produto,COALESCE(pr.ean,ip.ean,'') ean,
        COALESCE(pr.tipo_mix,'SEM CLASSIFICACAO') tipo_mix,COALESCE(SUM(ip.valor_faturado),0) faturamento,
        COALESCE(SUM(ip.quantidade_faturada),0) quantidade,COUNT(DISTINCT pe.id) pedidos
      FROM pedidos pe JOIN itens_pedido ip ON ip.pedido_id=pe.id LEFT JOIN produtos pr ON pr.id=ip.produto_id
      WHERE pe.cliente_id=? AND ${ITEM_FATURADO} ${condPeriodo}
      GROUP BY COALESCE(pr.id,ip.ean,ip.descricao)
      ORDER BY faturamento DESC LIMIT 30
    `).bind(id, ...bindsPeriodo)

    const pedidosStmt = env.DB.prepare(`
      SELECT pe.id,pe.pedido_origem,pe.nota_fiscal,pe.status,
        DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) data,
        COALESCE(SUM(ip.valor_faturado),0) valor,COUNT(ip.id) itens
      FROM pedidos pe JOIN itens_pedido ip ON ip.pedido_id=pe.id
      WHERE pe.cliente_id=? AND ${ITEM_FATURADO} ${condPeriodo}
      GROUP BY pe.id ORDER BY data DESC,pe.pedido_origem DESC LIMIT 50
    `).bind(id, ...bindsPeriodo)

    const ausentesStmt = env.DB.prepare(`
      SELECT pr.id,pr.ean,pr.descricao produto,pr.tipo_mix
      FROM produtos pr
      WHERE pr.ativo=1 AND UPPER(COALESCE(pr.tipo_mix,'')) IN ('PRIORITARIO','LANCAMENTO')
        AND NOT EXISTS (
          SELECT 1 FROM pedidos pe JOIN itens_pedido ip ON ip.pedido_id=pe.id
          WHERE pe.cliente_id=? AND ip.produto_id=pr.id AND ${ITEM_FATURADO} ${condPeriodo}
        )
      ORDER BY CASE UPPER(pr.tipo_mix) WHEN 'PRIORITARIO' THEN 1 ELSE 2 END,pr.descricao COLLATE NOCASE
      LIMIT 40
    `).bind(id, ...bindsPeriodo)

    const [clienteResult, resumoResult, historicoResult, produtosResult, pedidosResult, ausentesResult] = await env.DB.batch([
      clienteStmt, resumoStmt, historicoStmt, produtosStmt, pedidosStmt, ausentesStmt,
    ])
    const cliente = clienteResult.results?.[0]
    if (!cliente) return json({ erro: 'Cliente não encontrado na carteira oficial.' }, 404)
    const resumo = resumoResult.results?.[0] || {}

    return json({
      cliente,
      periodo: { inicio, fim },
      resumo: {
        faturamento: Number(resumo.faturamento || 0), pedidos: Number(resumo.pedidos || 0),
        produtos: Number(resumo.produtos || 0), ultima_compra: resumo.ultima_compra || null,
        prioritarios: Number(resumo.prioritarios || 0), lancamentos: Number(resumo.lancamentos || 0),
        ticket_medio: Number(resumo.pedidos || 0) > 0 ? Number(resumo.faturamento || 0) / Number(resumo.pedidos || 0) : 0,
      },
      historico: (historicoResult.results || []).reverse().map((item) => ({ ...item, faturamento: Number(item.faturamento || 0), pedidos: Number(item.pedidos || 0), produtos: Number(item.produtos || 0) })),
      produtos: (produtosResult.results || []).map((item) => ({ ...item, faturamento: Number(item.faturamento || 0), quantidade: Number(item.quantidade || 0), pedidos: Number(item.pedidos || 0) })),
      pedidos: (pedidosResult.results || []).map((item) => ({ ...item, valor: Number(item.valor || 0), itens: Number(item.itens || 0) })),
      oportunidades: ausentesResult.results || [],
    })
  } catch (error) {
    return json({ erro: 'Não foi possível carregar a ficha do cliente.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
