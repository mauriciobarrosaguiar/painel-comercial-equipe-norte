import { readSession, json } from '../_lib/credentials.js'
import { ITEM_FATURADO } from '../_lib/commercial.js'
import { analisarSkus } from '../_lib/sku-coverage.js'

const validDate = value => {
  const date = new Date(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export async function onRequestGet({ request, env }) {
  try {
    const session = await readSession(request, env.PAINEL_ADMIN_KEY)
    if (!session?.consultor_id) return json({ erro: 'Entre com seu acesso para consultar a carteira.' }, 401)
    const params = new URL(request.url).searchParams
    const id = params.get('id') || '', inicio = params.get('inicio') || '', fim = params.get('fim') || ''
    if ((inicio || fim) && (!validDate(inicio) || !validDate(fim) || inicio > fim)) return json({ erro: 'Período inválido.' }, 400)
    const conditions = ['cl.consultor_id=?', 'cl.ativo=1', 'cl.carteira_importada=1']
    const binds = [session.consultor_id]
    if (id) { conditions.push('cl.id=?'); binds.push(id) }
    if (params.get('uf')) { conditions.push('UPPER(TRIM(cl.uf))=?'); binds.push(params.get('uf').toUpperCase()) }
    const where = conditions.join(' AND ')
    const result = await env.DB.batch([
      // Include the complete imported SAP mix, even SKUs not yet matched to an EAN.
      env.DB.prepare(`SELECT p.id,p.ean,TRIM(COALESCE(p.sku,'')) codigo_sap,p.descricao,
        COALESCE(m.tipo_mix,p.tipo_mix) tipo_mix,
        CASE WHEN TRIM(COALESCE(p.sku,''))<>'' THEN 'sap:'||TRIM(p.sku)
          WHEN TRIM(COALESCE(p.ean,''))<>'' THEN 'ean:'||TRIM(p.ean) ELSE 'id:'||p.id END chave
        FROM produtos p LEFT JOIN produtos_mix_sap m ON m.ativo=1 AND TRIM(m.sku)=TRIM(p.sku)
        WHERE p.ativo=1
        UNION ALL
        SELECT 'sap:'||m.sku,'',TRIM(m.sku),m.descricao,m.tipo_mix,'sap:'||TRIM(m.sku)
        FROM produtos_mix_sap m WHERE m.ativo=1 AND NOT EXISTS(
          SELECT 1 FROM produtos p WHERE p.ativo=1 AND TRIM(p.sku)=TRIM(m.sku))
        ORDER BY descricao`),
      env.DB.prepare(`SELECT cl.id,cl.cnpj,COALESCE(NULLIF(cl.nome_fantasia,''),cl.razao_social,cl.cnpj) nome FROM clientes cl WHERE ${where} ORDER BY nome`).bind(...binds),
      env.DB.prepare(`SELECT cl.id cliente_id,
        CASE WHEN TRIM(COALESCE(pr.sku,''))<>'' THEN 'sap:'||TRIM(pr.sku)
          WHEN TRIM(COALESCE(pr.ean,ip.ean,''))<>'' THEN 'ean:'||TRIM(COALESCE(pr.ean,ip.ean))
          WHEN COALESCE(pr.id,ip.produto_id) IS NOT NULL THEN 'id:'||COALESCE(pr.id,ip.produto_id) END sku,
        SUBSTR(DATE(COALESCE(pe.data_faturamento,pe.data_pedido)),1,7) mes,
        SUM(ip.quantidade_faturada) quantidade,COUNT(DISTINCT pe.id) pedidos,
        MAX(DATE(COALESCE(pe.data_faturamento,pe.data_pedido))) ultima_compra
        FROM pedidos pe JOIN clientes cl ON cl.id=pe.cliente_id
        JOIN itens_pedido ip ON ip.pedido_id=pe.id
        LEFT JOIN produtos pr ON pr.id=ip.produto_id OR
          (ip.produto_id IS NULL AND TRIM(COALESCE(ip.ean,''))<>'' AND pr.ean=TRIM(ip.ean))
        WHERE ${where} AND pe.consultor_id=? AND ${ITEM_FATURADO}
          AND ip.quantidade_faturada>0
          AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) IS NOT NULL
          ${inicio ? 'AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)' : ''}
        GROUP BY 1,2,3`).bind(...binds, session.consultor_id, ...(inicio ? [inicio, fim] : [])),
    ])
    if (id && !result[1].results?.length) return json({ erro: 'Cliente não encontrado na sua carteira.' }, 404)
    return json({ ...analisarSkus(result[0].results || [], result[2].results || [], result[1].results || [], inicio, fim),
      periodo: { inicio, fim },
      criterio: 'Unidades faturadas no Bússola. Catálogo ativo e MIX SAP completo; identificação por SKU SAP, ou EAN quando não há SAP. Cada apresentação é contada separadamente. Recompra: mesmo SKU em pelo menos dois pedidos do cliente no período. Histórico mensal agregado sem produtos não permite identificar SKUs. Compra da farmácia não mede saída ao consumidor.' })
  } catch (error) {
    return json({ erro: 'Não foi possível calcular a cobertura de SKUs.' }, 500)
  }
}
