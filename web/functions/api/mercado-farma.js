import { readSession } from '../_lib/credentials.js'

const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store,no-cache,must-revalidate',
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const text = value => String(value ?? '').trim()
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const normalize = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

function addSearchConditions(conditions, binds, search) {
  const tokens = normalize(search).split(' ').filter(Boolean).slice(0, 8)
  for (const token of tokens) {
    const digits = token.replace(/\D/g, '')
    if (digits && digits.length >= 2) {
      conditions.push("(UPPER(COALESCE(produto,'')) LIKE ? OR REPLACE(REPLACE(REPLACE(COALESCE(ean,''),'.0',''),' ',''),'-','') LIKE ?)")
      binds.push(`%${token}%`, `%${digits}%`)
    } else {
      conditions.push("UPPER(COALESCE(produto,'')) LIKE ?")
      binds.push(`%${token}%`)
    }
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const uf = text(params.get('uf')).toUpperCase().slice(0, 2)
    const distributor = text(params.get('distribuidora')).slice(0, 120)
    const search = text(params.get('busca')).slice(0, 160)
    const withStock = params.get('estoque') === '1'
    const limit = Math.min(5000, Math.max(20, Number(params.get('limite') || 1000)))
    const conditions = ['1=1']
    const binds = []
    if (uf) { conditions.push('UPPER(TRIM(uf))=?'); binds.push(uf) }
    if (distributor) { conditions.push('distribuidora=?'); binds.push(distributor) }
    if (search) addSearchConditions(conditions, binds, search)
    if (withStock) conditions.push('COALESCE(estoque,0)>0')
    const where = conditions.join(' AND ')

    const session = await readSession(request, env.PAINEL_ADMIN_KEY)
    const clientCondition = session?.consultor_id ? 'AND cl.consultor_id=?' : 'AND 1=0'
    const clientBinds = session?.consultor_id ? [session.consultor_id] : []

    const [summaryResult, rowsResult, ufsResult, distributorsResult, extractionResult, clientsResult] = await env.DB.batch([
      env.DB.prepare(`SELECT COUNT(*) registros,COUNT(DISTINCT ean) produtos,COUNT(DISTINCT uf) ufs,COUNT(DISTINCT distribuidora) distribuidoras,MAX(atualizado_em) atualizado_em,COALESCE(SUM(CASE WHEN estoque>0 THEN 1 ELSE 0 END),0) com_estoque FROM mercado_farma_precos WHERE ${where}`).bind(...binds),
      env.DB.prepare(`SELECT uf,ean,produto,distribuidora,estoque,desconto,pf_distribuidora,pf_fabrica,preco_com_imposto,preco_sem_imposto,status,erro,atualizado_em,MIN(CASE WHEN estoque>0 THEN preco_sem_imposto END) OVER(PARTITION BY uf,ean) melhor_preco FROM mercado_farma_precos WHERE ${where} ORDER BY produto COLLATE NOCASE,uf,CASE WHEN estoque>0 AND preco_sem_imposto>0 THEN preco_sem_imposto ELSE 999999999 END,distribuidora COLLATE NOCASE LIMIT ?`).bind(...binds, limit),
      env.DB.prepare("SELECT DISTINCT UPPER(TRIM(uf)) uf FROM mercado_farma_precos WHERE TRIM(COALESCE(uf,''))<>'' ORDER BY uf"),
      env.DB.prepare("SELECT DISTINCT distribuidora FROM mercado_farma_precos WHERE TRIM(COALESCE(distribuidora,''))<>'' ORDER BY distribuidora COLLATE NOCASE"),
      env.DB.prepare("SELECT status,total_registros,mensagem,erro,iniciado_em,finalizado_em,criado_em FROM extracoes WHERE tipo='MERCADO_FARMA' ORDER BY criado_em DESC LIMIT 1"),
      env.DB.prepare(`
        SELECT cl.cnpj,
               COALESCE(NULLIF(TRIM(cl.nome_fantasia),''),NULLIF(TRIM(cl.razao_social),''),cl.cnpj) nome,
               COALESCE(cl.cidade,'') cidade,COALESCE(cl.uf,'') uf,
               COALESCE(co.nome,?) consultor
        FROM clientes cl
        LEFT JOIN consultores co ON co.id=cl.consultor_id
        WHERE cl.carteira_importada=1 AND cl.ativo=1 ${clientCondition}
          AND LENGTH(REPLACE(REPLACE(REPLACE(REPLACE(cl.cnpj,'.',''),'/',''),'-',''),' ',''))=14
        ORDER BY nome COLLATE NOCASE,cl.cnpj
        LIMIT 2000
      `).bind(session?.nome || '', ...clientBinds),
    ])
    const summary = summaryResult.results?.[0] || {}
    return json({
      resumo: {
        registros: number(summary.registros),
        produtos: number(summary.produtos),
        ufs: number(summary.ufs),
        distribuidoras: number(summary.distribuidoras),
        com_estoque: number(summary.com_estoque),
        atualizado_em: summary.atualizado_em || null,
      },
      resultados: (rowsResult.results || []).map(item => ({
        ...item,
        estoque: number(item.estoque),
        desconto: number(item.desconto),
        pf_distribuidora: number(item.pf_distribuidora),
        pf_fabrica: number(item.pf_fabrica),
        preco_com_imposto: number(item.preco_com_imposto),
        preco_sem_imposto: number(item.preco_sem_imposto),
        melhor_preco: item.melhor_preco === null ? null : number(item.melhor_preco),
      })),
      filtros: {
        ufs: (ufsResult.results || []).map(item => String(item.uf || '')).filter(Boolean),
        distribuidoras: (distributorsResult.results || []).map(item => String(item.distribuidora || '')).filter(Boolean),
      },
      clientes: (clientsResult.results || []).map(item => ({
        cnpj: text(item.cnpj).replace(/\D/g, ''),
        nome: text(item.nome),
        cidade: text(item.cidade),
        uf: text(item.uf),
        consultor: text(item.consultor || session?.nome),
      })),
      usuario: session ? { nome: text(session.nome), consultor_id: text(session.consultor_id), login: text(session.login) } : null,
      ultima_extracao: extractionResult.results?.[0] || null,
    })
  } catch (error) {
    return json({ erro: 'Não foi possível carregar o Mercado Farma.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
