import { readSession } from '../_lib/credentials.js'
import { categoriaFarmaceutica } from '../_lib/classificacao-farmaceutica.js'
import { MIX_POR_EAN, validarMix, validarRanking, mesAtualBrasilia, sqlVendasMes, aplicarRankingVendas, resumoDasOfertas } from '../_lib/mercado-farma-comercial.js'

const HEADERS = { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store,no-cache,must-revalidate' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const text = value => String(value ?? '').trim()
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const cleanCnpj = value => text(value).replace(/\D/g, '')
const normalize = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
const discountFromBase = item => {
  const saved = number(item.desconto)
  if (saved) return saved
  const pf = number(item.pf_distribuidora)
  const final = number(item.preco_com_imposto)
  return pf > 0 && final > 0 && final <= pf ? 1 - final / pf : 0
}

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
    const session = await readSession(request, env.PAINEL_ADMIN_KEY)
    const requestedClient = cleanCnpj(params.get('cliente_cnpj'))
    let selectedClient = null

    if (requestedClient) {
      if (!session?.consultor_id) return json({ erro: 'Consultor não identificado na sessão.' }, 401)
      selectedClient = await env.DB.prepare(`
        SELECT REPLACE(REPLACE(REPLACE(REPLACE(cl.cnpj,'.',''),'/',''),'-',''),' ','') cnpj,
               COALESCE(NULLIF(TRIM(cl.nome_fantasia),''),NULLIF(TRIM(cl.razao_social),''),cl.cnpj) nome,
               COALESCE(cl.cidade,'') cidade,UPPER(TRIM(COALESCE(cl.uf,''))) uf,
               COALESCE(co.nome,?) consultor
        FROM clientes cl
        LEFT JOIN consultores co ON co.id=cl.consultor_id
        WHERE cl.carteira_importada=1 AND cl.ativo=1 AND cl.consultor_id=?
          AND REPLACE(REPLACE(REPLACE(REPLACE(cl.cnpj,'.',''),'/',''),'-',''),' ','')=?
        LIMIT 1
      `).bind(session.nome || '', session.consultor_id, requestedClient).first()
      if (!selectedClient) return json({ erro: 'O CNPJ selecionado não pertence à carteira deste consultor.' }, 403)
    }

    const manualUf = text(params.get('uf')).toUpperCase().slice(0, 2)
    const effectiveUf = text(selectedClient?.uf || manualUf).toUpperCase().slice(0, 2)
    const distributor = text(params.get('distribuidora')).slice(0, 120)
    const search = text(params.get('busca')).slice(0, 160)
    const withStock = params.get('estoque') === '1'
    const categoriaParam = text(params.get('categoria'))
    const categoria = categoriaParam ? categoriaFarmaceutica(categoriaParam) : null
    if (categoriaParam && !categoria) return json({ erro: 'Categoria farmacêutica inválida.' }, 400)
    const mixParam = text(params.get('mix'))
    const mix = mixParam ? validarMix(mixParam) : null
    if (mixParam && !mix) return json({ erro: 'Filtro de MIX inválido.' }, 400)
    const vendasParam = text(params.get('mais_vendidos'))
    const maisVendidos = vendasParam ? validarRanking(vendasParam) : null
    if (vendasParam && !maisVendidos) return json({ erro: 'Filtro Mais vendidos inválido.' }, 400)
    if (maisVendidos && !session?.consultor_id) return json({ erro: 'Faça login para consultar seus produtos mais vendidos.' }, 401)
    const mesVendas = mesAtualBrasilia()
    const limit = Math.min(5000, Math.max(20, Number(params.get('limite') || 1000)))
    const conditions = ['1=1']
    const binds = []
    if (effectiveUf) { conditions.push('UPPER(TRIM(uf))=?'); binds.push(effectiveUf) }
    if (distributor) { conditions.push('distribuidora=?'); binds.push(distributor) }
    if (search) addSearchConditions(conditions, binds, search)
    if (withStock) conditions.push('COALESCE(estoque,0)>0')
    if (categoria) {
      conditions.push("COALESCE((SELECT cf.categoria FROM produto_classificacao_farmaceutica cf WHERE cf.ean=mercado_farma_precos.ean),'NAO_CLASSIFICADO')=?")
      binds.push(categoria)
    }
    if (mix) { conditions.push(`${MIX_POR_EAN}=?`); binds.push(mix) }
    const where = conditions.join(' AND ')

    const clientCondition = session?.consultor_id ? 'AND cl.consultor_id=?' : 'AND 1=0'
    const clientBinds = session?.consultor_id ? [session.consultor_id] : []
    const distributorWhere = effectiveUf ? 'WHERE UPPER(TRIM(uf))=?' : ''
    const distributorBinds = effectiveUf ? [effectiveUf] : []

    const statements = [
      env.DB.prepare(`SELECT COUNT(*) registros,COUNT(DISTINCT ean) produtos,COUNT(DISTINCT uf) ufs,COUNT(DISTINCT distribuidora) distribuidoras,MAX(atualizado_em) atualizado_em,COALESCE(SUM(CASE WHEN estoque>0 THEN 1 ELSE 0 END),0) com_estoque FROM mercado_farma_precos WHERE ${where}`).bind(...binds),
      env.DB.prepare(`SELECT uf,ean,produto,distribuidora,estoque,desconto,pf_distribuidora,pf_fabrica,preco_com_imposto,preco_sem_imposto,status,erro,atualizado_em,${MIX_POR_EAN} tipo_mix,COALESCE((SELECT cf.categoria FROM produto_classificacao_farmaceutica cf WHERE cf.ean=mercado_farma_precos.ean),'NAO_CLASSIFICADO') categoria_farmaceutica,MIN(CASE WHEN estoque>0 AND UPPER(TRIM(COALESCE(status,'OK')))='OK' THEN CASE WHEN preco_sem_imposto>0 THEN preco_sem_imposto WHEN preco_com_imposto>0 THEN preco_com_imposto END END) OVER(PARTITION BY uf,ean) melhor_preco FROM mercado_farma_precos WHERE ${where} ORDER BY produto COLLATE NOCASE,CASE WHEN estoque>0 AND preco_sem_imposto>0 THEN preco_sem_imposto ELSE 999999999 END,distribuidora COLLATE NOCASE LIMIT ?`).bind(...binds, limit),
      env.DB.prepare("SELECT DISTINCT UPPER(TRIM(uf)) uf FROM mercado_farma_precos WHERE TRIM(COALESCE(uf,''))<>'' ORDER BY uf"),
      env.DB.prepare(`SELECT DISTINCT distribuidora FROM mercado_farma_precos ${distributorWhere} ${distributorWhere ? 'AND' : 'WHERE'} TRIM(COALESCE(distribuidora,''))<>'' ORDER BY distribuidora COLLATE NOCASE`).bind(...distributorBinds),
      env.DB.prepare("SELECT status,total_registros,mensagem,erro,iniciado_em,finalizado_em,criado_em FROM extracoes WHERE tipo='MERCADO_FARMA' ORDER BY criado_em DESC LIMIT 1"),
      env.DB.prepare(`
        SELECT cl.cnpj,
               COALESCE(NULLIF(TRIM(cl.nome_fantasia),''),NULLIF(TRIM(cl.razao_social),''),cl.cnpj) nome,
               COALESCE(cl.cidade,'') cidade,UPPER(TRIM(COALESCE(cl.uf,''))) uf,
               COALESCE(co.nome,?) consultor
        FROM clientes cl
        LEFT JOIN consultores co ON co.id=cl.consultor_id
        WHERE cl.carteira_importada=1 AND cl.ativo=1 ${clientCondition}
          AND LENGTH(REPLACE(REPLACE(REPLACE(REPLACE(cl.cnpj,'.',''),'/',''),'-',''),' ',''))=14
        ORDER BY nome COLLATE NOCASE,cl.cnpj
        LIMIT 2000
      `).bind(session?.nome || '', ...clientBinds),
    ]
    if (maisVendidos) {
      statements.push(env.DB.prepare(sqlVendasMes(effectiveUf)).bind(
        session.consultor_id, session.consultor_id, mesVendas.inicio, mesVendas.proximo,
        ...(effectiveUf ? [effectiveUf] : []),
      ))
    }
    const [summaryResult, rowsResult, ufsResult, distributorsResult, extractionResult, clientsResult, vendasResult] = await env.DB.batch(statements)
    const rowsOriginais = rowsResult.results || []
    const rows = maisVendidos ? aplicarRankingVendas(rowsOriginais, vendasResult?.results || [], maisVendidos) : rowsOriginais
    const resumoRanking = maisVendidos ? resumoDasOfertas(rows) : null

    const summary = summaryResult.results?.[0] || {}
    return json({
      resumo: {
        registros: resumoRanking?.registros ?? number(summary.registros),
        produtos: resumoRanking?.produtos ?? number(summary.produtos),
        ufs: resumoRanking?.ufs ?? number(summary.ufs),
        distribuidoras: resumoRanking?.distribuidoras ?? number(summary.distribuidoras),
        com_estoque: resumoRanking?.com_estoque ?? number(summary.com_estoque),
        atualizado_em: summary.atualizado_em || null,
      },
      resultados: rows.map(item => ({
        ...item,
        estoque: number(item.estoque), desconto: discountFromBase(item), pf_distribuidora: number(item.pf_distribuidora),
        pf_fabrica: number(item.pf_fabrica), preco_com_imposto: number(item.preco_com_imposto),
        preco_sem_imposto: number(item.preco_sem_imposto), melhor_preco: item.melhor_preco === null ? null : number(item.melhor_preco),
      })),
      ranking: { filtro: maisVendidos || '', mes: mesVendas.mes, criterio: 'Unidades ou valor líquido faturado na Bússola do mês atual, na carteira do consultor e UF selecionada. Não é sell-out do varejo.' },
      filtros: {
        ufs: (ufsResult.results || []).map(item => String(item.uf || '')).filter(Boolean),
        distribuidoras: (distributorsResult.results || []).map(item => String(item.distribuidora || '')).filter(Boolean),
      },
      clientes: (clientsResult.results || []).map(item => ({
        cnpj: cleanCnpj(item.cnpj), nome: text(item.nome), cidade: text(item.cidade), uf: text(item.uf), consultor: text(item.consultor || session?.nome),
      })),
      cliente_selecionado: selectedClient ? {
        cnpj: cleanCnpj(selectedClient.cnpj), nome: text(selectedClient.nome), cidade: text(selectedClient.cidade),
        uf: text(selectedClient.uf), consultor: text(selectedClient.consultor || session?.nome),
      } : null,
      uf_aplicada: effectiveUf,
      usuario: session ? { nome: text(session.nome), consultor_id: text(session.consultor_id), login: text(session.login) } : null,
      ultima_extracao: extractionResult.results?.[0] || null,
    })
  } catch (error) {
    return json({ erro: 'Não foi possível carregar o Mercado Farma.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}

