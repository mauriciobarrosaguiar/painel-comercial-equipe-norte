import { readSession, json } from '../../_lib/credentials.js'
import { ITEM_FATURADO } from '../../_lib/commercial.js'
import { mesesReferencia, gerarInteligencia } from '../../_lib/client-insights.js'

const numero = valor => Number.isFinite(Number(valor)) ? Number(valor) : 0
const limparCnpj = valor => String(valor || '').replace(/\D/g, '')

export async function onRequestGet({ request, env }) {
  try {
    const session = await readSession(request, env.PAINEL_ADMIN_KEY)
    if (!session?.consultor_id) return json({ erro: 'Acesse o painel com seu usuário para visualizar sugestões.' }, 401)

    const id = String(new URL(request.url).searchParams.get('id') || '').trim()
    if (!id || id.length > 128) return json({ erro: 'Cliente inválido.' }, 400)

    const cliente = await env.DB.prepare(`
      SELECT cl.id, cl.cnpj, UPPER(TRIM(COALESCE(cl.uf,''))) uf,
             COALESCE(NULLIF(TRIM(cl.nome_fantasia),''),cl.razao_social,cl.cnpj) nome
        FROM clientes cl
       WHERE cl.id=? AND cl.consultor_id=? AND cl.carteira_importada=1 AND cl.ativo=1
       LIMIT 1
    `).bind(id, session.consultor_id).first()
    if (!cliente) return json({ erro: 'Cliente não encontrado na sua carteira ativa.' }, 404)

    const periodo = mesesReferencia()
    const [catalogoResult, comprasResult] = await env.DB.batch([
      env.DB.prepare(`
        SELECT id,ean,descricao,tipo_mix FROM produtos
         WHERE ativo=1 AND TRIM(COALESCE(ean,''))<>''
         ORDER BY descricao COLLATE NOCASE
      `),
      env.DB.prepare(`
        SELECT pr.id,
          SUM(CASE WHEN DATE(COALESCE(pe.data_faturamento,pe.data_pedido))>=DATE(?)
               THEN COALESCE(ip.quantidade_faturada,0) ELSE 0 END) quantidade_3m,
          SUM(COALESCE(ip.quantidade_faturada,0)) quantidade_6m,
          SUM(CASE WHEN DATE(COALESCE(pe.data_faturamento,pe.data_pedido))>=DATE(?)
               THEN 1 ELSE 0 END) linhas_3m,
          COUNT(DISTINCT CASE WHEN DATE(COALESCE(pe.data_faturamento,pe.data_pedido))>=DATE(?)
               THEN pe.id END) pedidos_3m,
          MAX(DATE(COALESCE(pe.data_faturamento,pe.data_pedido))) ultima_compra
        FROM pedidos pe
        JOIN itens_pedido ip ON ip.pedido_id=pe.id
        JOIN produtos pr ON pr.ativo=1 AND (
          pr.id=ip.produto_id OR
          (ip.produto_id IS NULL AND TRIM(COALESCE(ip.ean,''))<>'' AND pr.ean=ip.ean)
        )
        WHERE pe.cliente_id=? AND ${ITEM_FATURADO}
          AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)
        GROUP BY pr.id
      `).bind(periodo.inicio_3m, periodo.inicio_3m, periodo.inicio_3m, id, periodo.inicio_6m, periodo.fim),
    ])

    const catalogo = catalogoResult.results || []
    const compras = comprasResult.results || []
    const analise = gerarInteligencia(catalogo, compras, periodo)
    const ufs = String(cliente.uf || '').toUpperCase()
    const eans = [...new Set(analise.sugestoes.map(item => item.ean).filter(Boolean))]
    let ofertas = []
    if (/^[A-Z]{2}$/.test(ufs) && eans.length) {
      const placeholders = eans.map(() => '?').join(',')
      const response = await env.DB.prepare(`
        SELECT ean,uf,produto,distribuidora,estoque,preco_sem_imposto,preco_com_imposto,atualizado_em
        FROM mercado_farma_precos
        WHERE UPPER(TRIM(uf))=? AND ean IN (${placeholders})
          AND COALESCE(estoque,0)>0
          AND (COALESCE(preco_com_imposto,0)>0 OR COALESCE(preco_sem_imposto,0)>0)
          AND UPPER(TRIM(COALESCE(status,'OK')))='OK'
        ORDER BY ean, distribuidora COLLATE NOCASE
        LIMIT 3000
      `).bind(ufs, ...eans).all()
      ofertas = response.results || []
    }

    const porEan = new Map()
    for (const oferta of ofertas) {
      const ean = String(oferta.ean || '')
      const preco = numero(oferta.preco_com_imposto) > 0 ? numero(oferta.preco_com_imposto) : numero(oferta.preco_sem_imposto)
      if (numero(oferta.estoque) <= 0 || preco <= 0 || String(oferta.uf).toUpperCase() !== ufs) continue
      if (!porEan.has(ean)) porEan.set(ean, [])
      porEan.get(ean).push({
        distribuidora: String(oferta.distribuidora || ''),
        uf: ufs, estoque: Math.floor(numero(oferta.estoque)), preco,
        preco_com_imposto: numero(oferta.preco_com_imposto),
        preco_sem_imposto: numero(oferta.preco_sem_imposto),
        atualizado_em: oferta.atualizado_em || null,
      })
    }

    const sugestoes = analise.sugestoes.map(item => ({
      ...item,
      ofertas: (porEan.get(item.ean) || []).sort((a, b) => a.preco - b.preco || b.estoque - a.estoque),
    }))

    return json({
      cliente: { id: cliente.id, cnpj: limparCnpj(cliente.cnpj), uf: ufs, nome: cliente.nome },
      cobertura: analise.cobertura,
      sugestoes,
      avisos: [
        'Sugestões baseadas apenas em itens faturados identificados; não equivalem a pedido confirmado.',
        'Valores e estoque são consultados no último registro do Mercado Farma para a UF do cliente e precisam ser revisados antes de comprar.',
      ],
    })
  } catch (error) {
    return json({ erro: 'Não foi possível calcular a análise da ficha.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
