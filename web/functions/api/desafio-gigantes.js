import { ITEM_FATURADO } from '../_lib/commercial.js'

const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const texto = (value) => String(value ?? '').trim()
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const percentual = (real, meta) => numero(meta) > 0 ? (numero(real) / numero(meta)) * 100 : 0
const pontos = (atingimento, peso = 1, gatilho = 80) => atingimento >= gatilho ? Math.min(120, atingimento) * peso : 0

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

function parametros(request) {
  const search = new URL(request.url).searchParams
  const anoMes = /^\d{4}-\d{2}$/.test(texto(search.get('ano_mes'))) ? texto(search.get('ano_mes')) : mesAtual()
  return {
    anoMes,
    consultor: texto(search.get('consultor')).slice(0, 180),
    uf: texto(search.get('uf')).toUpperCase().slice(0, 2),
    ...faixaMes(anoMes),
  }
}

function filtroMetas(filtro) {
  const condicoes = ['m.ano_mes=?']
  const binds = [filtro.anoMes]
  if (filtro.consultor) {
    condicoes.push("m.escopo='consultor'", 'm.consultor_id=?')
    binds.push(filtro.consultor)
  } else if (filtro.uf) {
    condicoes.push("m.escopo='consultor'")
    condicoes.push("m.consultor_id IN (SELECT DISTINCT consultor_id FROM clientes WHERE carteira_importada=1 AND ativo=1 AND UPPER(TRIM(COALESCE(uf,'')))=?)")
    binds.push(filtro.uf)
  } else {
    condicoes.push("m.escopo='gerente'")
  }
  return { where: condicoes.join(' AND '), binds }
}

export async function onRequestGet({ request, env }) {
  try {
    const filtro = parametros(request)
    const metasFiltro = filtroMetas(filtro)
    const ufJoin = filtro.uf ? "AND UPPER(TRIM(COALESCE(cl.uf,'')))=?" : ''

    const resultado = await env.DB.prepare(`
      SELECT
        m.id,m.ano_mes,m.escopo,m.consultor_id,m.nome_colaborador,m.setor,m.sku,
        COALESCE(NULLIF(TRIM(m.produto_identificado),''),NULLIF(TRIM(m.produto_planilha),''),('SAP '||m.sku)) produto,
        COALESCE(m.ean,'') ean,COALESCE(m.status_identificacao,'PENDENTE') status_identificacao,
        COALESCE(m.meta_positivacao,0) meta_positivacao,COALESCE(m.meta_giro,0) meta_giro,
        COUNT(DISTINCT CASE WHEN cl.id IS NOT NULL THEN cl.id END) positivacao_real,
        COALESCE(SUM(CASE WHEN cl.id IS NOT NULL THEN COALESCE(NULLIF(ip.quantidade_faturada,0),NULLIF(ip.quantidade_atendida,0),0) ELSE 0 END),0) unidades
      FROM desafio_gigantes_metas m
      LEFT JOIN itens_pedido ip
        ON TRIM(COALESCE(ip.ean,''))=TRIM(COALESCE(m.ean,''))
       AND ip.ativo=1
       AND TRIM(COALESCE(m.ean,''))<>''
      LEFT JOIN pedidos pe
        ON pe.id=ip.pedido_id
       AND ${ITEM_FATURADO}
       AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)
      LEFT JOIN clientes cl
        ON cl.id=pe.cliente_id
       AND cl.carteira_importada=1
       AND cl.ativo=1
       AND (m.escopo='gerente' OR cl.consultor_id=m.consultor_id)
       ${ufJoin}
      WHERE ${metasFiltro.where}
      GROUP BY m.id,m.ano_mes,m.escopo,m.consultor_id,m.nome_colaborador,m.setor,m.sku,m.produto_identificado,m.produto_planilha,m.ean,m.status_identificacao,m.meta_positivacao,m.meta_giro
      ORDER BY m.sku
    `).bind(...[filtro.inicio, filtro.fim, ...(filtro.uf ? [filtro.uf] : []), ...metasFiltro.binds]).all()

    const linhas = (resultado.results || []).map((item) => {
      const positivacao = numero(item.positivacao_real)
      const unidades = numero(item.unidades)
      const giro = positivacao > 0 ? unidades / positivacao : 0
      const atingPos = percentual(positivacao, item.meta_positivacao)
      const atingGiro = percentual(giro, item.meta_giro)
      const skuDestravado = atingPos >= 80
      const pontosPos = pontos(atingPos, 1, 80)
      const pontosGiro = skuDestravado ? pontos(atingGiro, 0.4, 100) : 0
      const alvo80 = Math.ceil(numero(item.meta_positivacao) * 0.8)
      return {
        ...item,
        positivacao_real: positivacao,
        giro_real: giro,
        unidades,
        atingimento_positivacao: atingPos,
        atingimento_giro: atingGiro,
        sku_destravado: skuDestravado,
        giro_pontuando: skuDestravado && atingGiro >= 100,
        pontos_estimados: pontosPos + pontosGiro,
        alvo_positivacao_80: alvo80,
        falta_pdv_80: Math.max(0, alvo80 - positivacao),
      }
    })

    const skus = new Set(linhas.map((item) => texto(item.sku)).filter(Boolean))
    const identificados = linhas.filter((item) => item.status_identificacao === 'IDENTIFICADO' && texto(item.ean)).length
    const pos80 = linhas.filter((item) => item.atingimento_positivacao >= 80).length
    const giro100 = linhas.filter((item) => item.giro_pontuando).length
    const pontuacao = linhas.reduce((total, item) => total + numero(item.pontos_estimados), 0)
    const oportunidades = linhas
      .filter((item) => item.status_identificacao === 'IDENTIFICADO' && item.atingimento_positivacao < 80 && item.falta_pdv_80 > 0)
      .sort((a, b) => a.falta_pdv_80 - b.falta_pdv_80 || b.atingimento_positivacao - a.atingimento_positivacao || texto(a.sku).localeCompare(texto(b.sku)))
      .slice(0, 10)

    const identificacao = await env.DB.prepare(`
      SELECT
        COUNT(*) total,
        SUM(CASE WHEN status='IDENTIFICADO' THEN 1 ELSE 0 END) identificados,
        SUM(CASE WHEN status='PENDENTE' THEN 1 ELSE 0 END) pendentes,
        SUM(CASE WHEN status='AMBIGUO' THEN 1 ELSE 0 END) ambiguos,
        SUM(CASE WHEN status='NAO_ENCONTRADO' THEN 1 ELSE 0 END) nao_encontrados,
        SUM(CASE WHEN status='ERRO' THEN 1 ELSE 0 END) erros,
        MAX(ultima_consulta_em) ultima_consulta_em
      FROM desafio_gigantes_produtos
      WHERE sku IN (SELECT DISTINCT sku FROM desafio_gigantes_metas WHERE ano_mes=?)
    `).bind(filtro.anoMes).first()

    return json({
      ano_mes: filtro.anoMes,
      escopo: filtro.consultor ? 'consultor' : filtro.uf ? 'uf' : 'gerente',
      colaborador: linhas[0]?.nome_colaborador || '',
      metas: linhas.length,
      skus: skus.size,
      identificados,
      pos_80: pos80,
      giro_100: giro100,
      giro_80: giro100,
      pontuacao_estimada: pontuacao,
      maximo_estimado: linhas.length * 168,
      identificacao: {
        total: numero(identificacao?.total),
        identificados: numero(identificacao?.identificados),
        pendentes: numero(identificacao?.pendentes),
        ambiguos: numero(identificacao?.ambiguos),
        nao_encontrados: numero(identificacao?.nao_encontrados),
        erros: numero(identificacao?.erros),
        ultima_consulta_em: texto(identificacao?.ultima_consulta_em),
      },
      oportunidades,
      atualizado_em: new Date().toISOString(),
      aviso: 'Parcial gerencial com dados do painel. A apuração oficial da campanha continua sendo CDD/Close-Up.',
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table')) {
      return json({ ano_mes: mesAtual(), metas: 0, skus: 0, identificados: 0, pos_80: 0, giro_100: 0, giro_80: 0, pontuacao_estimada: 0, oportunidades: [], aviso: 'A base do Desafio de Gigantes ainda não foi importada.' })
    }
    return json({ erro: 'Não foi possível calcular o Desafio de Gigantes.', detalhe }, 500)
  }
}
