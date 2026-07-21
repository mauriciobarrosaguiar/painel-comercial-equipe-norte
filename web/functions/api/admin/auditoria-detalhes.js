import { ITEM_FATURADO, PEDIDO_FATURADO } from '../../_lib/commercial.js'
import { authorized, json } from '../../_lib/credentials.js'

const TIPOS_VALIDOS = "'LINHA','PRIORITARIO','LANCAMENTO','COMBATE'"
const DATA = 'DATE(COALESCE(pe.data_faturamento,pe.data_pedido))'
const texto = (valor) => String(valor ?? '').trim()

async function acesso(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) return json({ erro: 'Acesso administrativo indisponível.' }, 503)
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) return json({ erro: 'Acesso não autorizado.' }, 401)
  return null
}

function periodo(params) {
  const inicio = texto(params.get('inicio'))
  const fim = texto(params.get('fim'))
  if (!inicio && !fim) return { sql: '', valores: [] }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) throw new Error('Período inválido.')
  return { sql: ` AND ${DATA} BETWEEN DATE(?) AND DATE(?)`, valores: [inicio, fim] }
}

export async function onRequestGet({ request, env }) {
  const negado = await acesso(request, env)
  if (negado) return negado
  try {
    const params = new URL(request.url).searchParams
    const tipo = texto(params.get('tipo'))
    const faixa = periodo(params)
    let titulo = ''
    let sql = ''
    let valores = faixa.valores

    if (tipo === 'itens_sem_classificacao') {
      titulo = 'Produtos sem classificação'
      sql = `SELECT COALESCE(NULLIF(pr.ean,''),NULLIF(ip.ean,''),'SEM EAN') ean,
        COALESCE(NULLIF(pr.descricao,''),NULLIF(ip.descricao,''),'Produto não identificado') produto,
        COALESCE(NULLIF(pr.tipo_mix,''),'SEM CLASSIFICAÇÃO') classificacao,
        COUNT(*) ocorrencias,COALESCE(SUM(ip.valor_faturado),0) faturamento,
        GROUP_CONCAT(DISTINCT COALESCE(pe.pedido_origem,pe.id)) pedidos,
        'Classificação ausente ou diferente de LINHA, PRIORITARIO, LANCAMENTO ou COMBATE' motivo
        FROM itens_pedido ip JOIN pedidos pe ON pe.id=ip.pedido_id
        LEFT JOIN produtos pr ON pr.id=ip.produto_id
        WHERE ${ITEM_FATURADO}
          AND UPPER(TRIM(COALESCE(pr.tipo_mix,''))) NOT IN (${TIPOS_VALIDOS})${faixa.sql}
        GROUP BY COALESCE(pr.ean,ip.ean),COALESCE(pr.descricao,ip.descricao),pr.tipo_mix
        ORDER BY faturamento DESC,produto COLLATE NOCASE LIMIT 200`
    } else if (tipo === 'pedidos_fora_carteira') {
      titulo = 'Pedidos fora da carteira oficial'
      sql = `SELECT COALESCE(pe.pedido_origem,pe.id) pedido,COALESCE(pe.nota_fiscal,'') nota,
        COALESCE(cl.cnpj,'') cnpj,COALESCE(cl.nome_fantasia,cl.razao_social,'Cliente não identificado') cliente,
        COALESCE(co.nome,'Sem consultor') consultor,COALESCE(pe.valor_faturado,0) faturamento,
        'Cliente localizado, mas sem vínculo com a carteira oficial importada' motivo
        FROM pedidos pe LEFT JOIN clientes cl ON cl.id=pe.cliente_id LEFT JOIN consultores co ON co.id=pe.consultor_id
        WHERE ${PEDIDO_FATURADO} AND cl.id IS NOT NULL AND COALESCE(cl.carteira_importada,0)<>1${faixa.sql}
        ORDER BY faturamento DESC LIMIT 200`
    } else if (tipo === 'pedidos_sem_consultor') {
      titulo = 'Pedidos sem consultor vinculado'
      sql = `SELECT COALESCE(pe.pedido_origem,pe.id) pedido,COALESCE(pe.nota_fiscal,'') nota,
        COALESCE(cl.cnpj,'') cnpj,COALESCE(cl.nome_fantasia,cl.razao_social,'Cliente não identificado') cliente,
        COALESCE(pe.valor_faturado,0) faturamento,'Pedido sem consultor oficial associado' motivo
        FROM pedidos pe LEFT JOIN clientes cl ON cl.id=pe.cliente_id LEFT JOIN consultores co ON co.id=pe.consultor_id
        WHERE ${PEDIDO_FATURADO} AND (pe.consultor_id IS NULL OR co.id IS NULL)${faixa.sql}
        ORDER BY faturamento DESC LIMIT 200`
    } else if (tipo === 'itens_sem_ean') {
      titulo = 'Itens sem EAN'
      sql = `SELECT COALESCE(pe.pedido_origem,pe.id) pedido,COALESCE(ip.descricao,'Produto não identificado') produto,
        COALESCE(ip.valor_faturado,0) faturamento,'Item faturado sem EAN para cruzar com a base de produtos' motivo
        FROM itens_pedido ip JOIN pedidos pe ON pe.id=ip.pedido_id
        WHERE ${ITEM_FATURADO} AND TRIM(COALESCE(ip.ean,''))=''${faixa.sql}
        ORDER BY faturamento DESC LIMIT 200`
    } else if (tipo === 'itens_sem_produto') {
      titulo = 'Itens sem produto vinculado'
      sql = `SELECT COALESCE(pe.pedido_origem,pe.id) pedido,COALESCE(ip.ean,'SEM EAN') ean,
        COALESCE(ip.descricao,'Produto não identificado') produto,COALESCE(ip.valor_faturado,0) faturamento,
        'EAN ou descrição não encontrou produto correspondente na base oficial' motivo
        FROM itens_pedido ip JOIN pedidos pe ON pe.id=ip.pedido_id LEFT JOIN produtos pr ON pr.id=ip.produto_id
        WHERE ${ITEM_FATURADO} AND (ip.produto_id IS NULL OR pr.id IS NULL)${faixa.sql}
        ORDER BY faturamento DESC LIMIT 200`
    } else if (tipo === 'datas_futuras') {
      titulo = 'Pedidos com data futura'
      const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      sql = `SELECT COALESCE(pe.pedido_origem,pe.id) pedido,COALESCE(pe.nota_fiscal,'') nota,
        COALESCE(cl.cnpj,'') cnpj,COALESCE(cl.nome_fantasia,cl.razao_social,'Cliente não identificado') cliente,
        COALESCE(pe.data_faturamento,pe.data_pedido) data,'Data posterior ao dia atual' motivo
        FROM pedidos pe LEFT JOIN clientes cl ON cl.id=pe.cliente_id
        WHERE pe.ativo=1 AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido))>DATE(?)${faixa.sql}
        ORDER BY data DESC LIMIT 200`
      valores = [hoje, ...faixa.valores]
    } else {
      return json({ erro: 'Este indicador ainda não possui detalhamento.' }, 400)
    }

    const resultado = valores.length ? await env.DB.prepare(sql).bind(...valores).all() : await env.DB.prepare(sql).all()
    return json({ tipo, titulo, linhas: resultado.results || [] })
  } catch (error) {
    return json({ erro: 'Não foi possível abrir os detalhes.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
