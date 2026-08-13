import { authorized, json } from '../_lib/credentials.js'

const texto = (value) => String(value ?? '').trim()
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0

function mesAtual() {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map((item) => [item.type, item.value]))
  return `${partes.year}-${partes.month}`
}

export async function onRequestGet({ request, env }) {
  try {
    const valor = texto(new URL(request.url).searchParams.get('ano_mes'))
    const anoMes = /^\d{4}-\d{2}$/.test(valor) ? valor : mesAtual()
    const consultores = await env.DB.prepare("SELECT DISTINCT consultor_id,nome_colaborador,setor FROM desafio_gigantes_metas WHERE ano_mes=? AND escopo='consultor' AND TRIM(COALESCE(consultor_id,''))<>'' ORDER BY setor,nome_colaborador").bind(anoMes).all()
    const identificacao = await env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status='IDENTIFICADO' THEN 1 ELSE 0 END) identificados,SUM(CASE WHEN status='PENDENTE' THEN 1 ELSE 0 END) pendentes,SUM(CASE WHEN status='AMBIGUO' THEN 1 ELSE 0 END) ambiguos,SUM(CASE WHEN status='NAO_ENCONTRADO' THEN 1 ELSE 0 END) nao_encontrados,SUM(CASE WHEN status='ERRO' THEN 1 ELSE 0 END) erros,MAX(ultima_consulta_em) ultima_consulta_em FROM desafio_gigantes_produtos WHERE sku IN (SELECT DISTINCT sku FROM desafio_gigantes_metas WHERE ano_mes=?)").bind(anoMes).first()
    const problemas = await env.DB.prepare("SELECT p.sku,COALESCE(p.status,'PENDENTE') status,COALESCE(p.ean,'') ean,COALESCE(p.produto,'') produto,COALESCE(p.mensagem,'') mensagem,COALESCE(p.tentativas,0) tentativas,COALESCE(p.ultima_consulta_em,'') ultima_consulta_em,COALESCE(MAX(NULLIF(TRIM(m.produto_planilha),'')),'') produto_planilha FROM desafio_gigantes_produtos p JOIN desafio_gigantes_metas m ON TRIM(m.sku)=TRIM(p.sku) AND m.ano_mes=? WHERE COALESCE(p.status,'PENDENTE')<>'IDENTIFICADO' GROUP BY p.sku,p.status,p.ean,p.produto,p.mensagem,p.tentativas,p.ultima_consulta_em ORDER BY p.sku LIMIT 150").bind(anoMes).all()
    return json({ ano_mes: anoMes, consultores: consultores.results || [], identificacao: { total: numero(identificacao?.total), identificados: numero(identificacao?.identificados), pendentes: numero(identificacao?.pendentes), ambiguos: numero(identificacao?.ambiguos), nao_encontrados: numero(identificacao?.nao_encontrados), erros: numero(identificacao?.erros), ultima_consulta_em: texto(identificacao?.ultima_consulta_em) }, saps_problema: problemas.results || [] })
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
