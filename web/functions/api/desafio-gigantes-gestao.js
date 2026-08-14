import { authorized, json } from '../_lib/credentials.js'

const texto = (value) => String(value ?? '').trim()
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0

function mesAtual() {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map((item) => [item.type, item.value]))
  return `${partes.year}-${partes.month}`
}

function faixaMes(anoMes) {
  const [ano, mes] = anoMes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return { inicio: `${anoMes}-01`, fim: `${anoMes}-${String(ultimo).padStart(2, '0')}` }
}

export async function onRequestGet({ request, env }) {
  try {
    const valor = texto(new URL(request.url).searchParams.get('ano_mes'))
    const anoMes = /^\d{4}-\d{2}$/.test(valor) ? valor : mesAtual()
    const periodo = faixaMes(anoMes)
    const consultores = await env.DB.prepare("SELECT DISTINCT consultor_id,nome_colaborador,setor FROM desafio_gigantes_metas WHERE ano_mes=? AND escopo='consultor' AND TRIM(COALESCE(consultor_id,''))<>'' ORDER BY setor,nome_colaborador").bind(anoMes).all()
    const identificacao = await env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status='IDENTIFICADO' THEN 1 ELSE 0 END) identificados,SUM(CASE WHEN status='PENDENTE' THEN 1 ELSE 0 END) pendentes,SUM(CASE WHEN status='AMBIGUO' THEN 1 ELSE 0 END) ambiguos,SUM(CASE WHEN status='NAO_ENCONTRADO' THEN 1 ELSE 0 END) nao_encontrados,SUM(CASE WHEN status='ERRO' THEN 1 ELSE 0 END) erros,MAX(ultima_consulta_em) ultima_consulta_em FROM desafio_gigantes_produtos WHERE sku IN (SELECT DISTINCT sku FROM desafio_gigantes_metas WHERE ano_mes=?)").bind(anoMes).first()
    const duplicados = await env.DB.prepare("SELECT TRIM(ean) ean,GROUP_CONCAT(DISTINCT sku) saps,COUNT(DISTINCT sku) qtd_saps FROM desafio_gigantes_metas WHERE ano_mes=? AND TRIM(COALESCE(ean,''))<>'' GROUP BY TRIM(ean) HAVING COUNT(DISTINCT sku)>1 ORDER BY TRIM(ean)").bind(anoMes).all()
    const problemas = await env.DB.prepare(`
      WITH eans_duplicados AS (
        SELECT TRIM(ean) ean
        FROM desafio_gigantes_metas
        WHERE ano_mes=? AND TRIM(COALESCE(ean,''))<>''
        GROUP BY TRIM(ean)
        HAVING COUNT(DISTINCT sku)>1
      )
      SELECT
        p.sku,
        CASE WHEN d.ean IS NOT NULL THEN 'CONFLITO_EAN' ELSE COALESCE(p.status,'PENDENTE') END status,
        COALESCE(p.ean,'') ean,
        COALESCE(p.produto,'') produto,
        CASE WHEN d.ean IS NOT NULL THEN ('O EAN '||p.ean||' está vinculado a mais de um SAP nesta campanha. Confirme o EAN correto no Mercado Farma.') ELSE COALESCE(p.mensagem,'') END mensagem,
        COALESCE(p.tentativas,0) tentativas,
        COALESCE(p.ultima_consulta_em,'') ultima_consulta_em,
        COALESCE(MAX(NULLIF(TRIM(m.produto_planilha),'')),'') produto_planilha
      FROM desafio_gigantes_produtos p
      JOIN desafio_gigantes_metas m ON TRIM(m.sku)=TRIM(p.sku) AND m.ano_mes=?
      LEFT JOIN eans_duplicados d ON d.ean=TRIM(COALESCE(p.ean,''))
      WHERE COALESCE(p.status,'PENDENTE')<>'IDENTIFICADO' OR d.ean IS NOT NULL
      GROUP BY p.sku,p.status,p.ean,p.produto,p.mensagem,p.tentativas,p.ultima_consulta_em,d.ean
      ORDER BY CASE WHEN d.ean IS NOT NULL THEN 0 ELSE 1 END,p.sku
      LIMIT 150
    `).bind(anoMes, anoMes).all()
    const semGd = await env.DB.prepare(`
      SELECT COUNT(DISTINCT cl.id) total
      FROM clientes cl
      JOIN pedidos pe ON pe.cliente_id=cl.id
      WHERE cl.carteira_importada=1 AND cl.ativo=1
        AND TRIM(COALESCE(cl.nome_gd,''))=''
        AND pe.ativo=1
        AND UPPER(TRIM(COALESCE(pe.status,''))) IN ('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO')
        AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)
    `).bind(periodo.inicio, periodo.fim).first()

    const alertas = []
    for (const item of duplicados.results || []) {
      alertas.push({
        tipo: 'EAN_DUPLICADO',
        titulo: `EAN ${texto(item.ean)} ligado a mais de um SAP`,
        detalhe: 'Esse conflito pode duplicar vendas e alterar Positivação/Giro. Os SAPs envolvidos aparecem abaixo para correção.',
        itens: texto(item.saps).split(',').filter(Boolean).map((sap) => `SAP ${sap}`),
      })
    }
    if (numero(semGd?.total) > 0) {
      alertas.push({
        tipo: 'CLIENTE_SEM_GD',
        titulo: `${numero(semGd?.total)} cliente(s) com venda faturada estão sem GD`,
        detalhe: 'Esses clientes ficam fora do consolidado da GD até o vínculo da carteira ser corrigido.',
      })
    }

    return json({
      ano_mes: anoMes,
      consultores: consultores.results || [],
      identificacao: {
        total: numero(identificacao?.total),
        identificados: numero(identificacao?.identificados),
        pendentes: numero(identificacao?.pendentes),
        ambiguos: numero(identificacao?.ambiguos),
        nao_encontrados: numero(identificacao?.nao_encontrados),
        erros: numero(identificacao?.erros),
        conflitos_ean: (duplicados.results || []).length,
        ultima_consulta_em: texto(identificacao?.ultima_consulta_em),
      },
      saps_problema: problemas.results || [],
      alertas_qualidade: alertas,
    })
  } catch (error) {
    return json({ erro: 'Não foi possível carregar a gestão do Desafio de Gigantes.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || !(await authorized(request, env.PAINEL_ADMIN_KEY))) return json({ erro: 'Acesso não autorizado.' }, 401)
  const body = await request.json().catch(() => ({}))
  if (texto(body.acao) !== 'corrigir_sap') return json({ erro: 'Ação inválida.' }, 400)
  const sku = texto(body.sku).replace(/\D/g, '').slice(0, 20)
  const ean = texto(body.ean).replace(/\D/g, '').slice(0, 14)
  if (!sku || ean.length < 8 || ean.length > 14) return json({ erro: 'Informe SAP e EAN válidos.' }, 400)
  const existente = await env.DB.prepare('SELECT sku FROM desafio_gigantes_produtos WHERE sku=? LIMIT 1').bind(sku).first()
  if (!existente?.sku) return json({ erro: `SAP ${sku} não pertence à campanha importada.` }, 404)
  const conflito = await env.DB.prepare("SELECT sku FROM desafio_gigantes_produtos WHERE sku<>? AND TRIM(COALESCE(ean,''))=? AND status='IDENTIFICADO' LIMIT 1").bind(sku, ean).first()
  if (conflito?.sku) return json({ erro: `O EAN ${ean} já está vinculado ao SAP ${conflito.sku}. Confirme os dois códigos antes de salvar.` }, 409)
  let produto = texto(body.produto).slice(0, 300)
  if (!produto) {
    const meta = await env.DB.prepare("SELECT MAX(NULLIF(TRIM(produto_planilha),'')) produto FROM desafio_gigantes_metas WHERE sku=?").bind(sku).first()
    produto = texto(meta?.produto) || `SAP ${sku}`
  }
  const agora = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare("UPDATE desafio_gigantes_produtos SET ean=?,produto=?,status='IDENTIFICADO',tentativas=COALESCE(tentativas,0)+1,ultima_consulta_em=?,mensagem='Corrigido manualmente no painel.',atualizado_em=? WHERE sku=?").bind(ean, produto, agora, agora, sku),
    env.DB.prepare("UPDATE desafio_gigantes_metas SET ean=?,produto_identificado=?,status_identificacao='IDENTIFICADO',atualizado_em=? WHERE sku=?").bind(ean, produto, agora, sku),
  ])
  return json({ sucesso: true, sku, ean, produto })
}
