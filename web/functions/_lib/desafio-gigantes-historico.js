import { onRequestGet as calcularDesafio } from '../api/desafio-gigantes.js'

const texto = (value) => String(value ?? '').trim()

async function resumoDesafio(env, anoMes, consultorId = '') {
  const params = new URLSearchParams({ ano_mes: anoMes })
  if (consultorId) params.set('consultor', consultorId)
  const response = await calcularDesafio({
    request: new Request(`https://painel.local/api/desafio-gigantes?${params.toString()}`),
    env,
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body?.detalhe || body?.erro || 'Falha ao calcular o Desafio de Gigantes.')
  return body
}

async function produtosDaMeta(env, anoMes, escopo, referenciaId) {
  const condicao = escopo === 'consultor'
    ? "ano_mes=? AND escopo='consultor' AND consultor_id=?"
    : "ano_mes=? AND escopo='gerente'"
  const binds = escopo === 'consultor' ? [anoMes, referenciaId] : [anoMes]
  const result = await env.DB.prepare(`
    SELECT sku,
           COALESCE(ean,'') ean,
           COALESCE(NULLIF(TRIM(produto_identificado),''),NULLIF(TRIM(produto_planilha),''),('SAP '||sku)) produto,
           COALESCE(meta_positivacao,0) meta_positivacao,
           COALESCE(meta_giro,0) meta_giro,
           COALESCE(status_identificacao,'PENDENTE') status_identificacao
      FROM desafio_gigantes_metas
     WHERE ${condicao}
     ORDER BY sku
  `).bind(...binds).all()
  return result.results || []
}

export async function fecharDesafioGigantes(env, anoMes, fechadoEm = new Date().toISOString()) {
  const metas = await env.DB.prepare(`
    SELECT escopo,
           COALESCE(consultor_id,'') referencia_id,
           MIN(nome_colaborador) referencia_nome,
           COUNT(*) produtos
      FROM desafio_gigantes_metas
     WHERE ano_mes=?
     GROUP BY escopo,COALESCE(consultor_id,'')
     ORDER BY CASE escopo WHEN 'gerente' THEN 0 ELSE 1 END,referencia_nome
  `).bind(anoMes).all()

  const referencias = metas.results || []
  if (!referencias.length) {
    return { ignorado: true, motivo: 'Não há metas do Desafio de Gigantes para este mês.', registros: 0 }
  }

  let criados = 0
  let preservados = 0
  for (const referencia of referencias) {
    const escopo = texto(referencia.escopo)
    const referenciaId = escopo === 'consultor' ? texto(referencia.referencia_id) : ''
    const existente = await env.DB.prepare(`
      SELECT id,fechado_em
        FROM desafio_gigantes_fechamentos
       WHERE ano_mes=? AND escopo=? AND referencia_id=?
       LIMIT 1
    `).bind(anoMes, escopo, referenciaId).first()
    if (existente) {
      preservados += 1
      continue
    }

    const resumo = await resumoDesafio(env, anoMes, referenciaId)
    const produtos = await produtosDaMeta(env, anoMes, escopo, referenciaId)
    const snapshot = {
      tipo: 'DESAFIO_GIGANTES',
      ano_mes: anoMes,
      escopo,
      referencia_id: referenciaId,
      referencia_nome: texto(referencia.referencia_nome) || texto(resumo.colaborador) || (escopo === 'gerente' ? 'GD' : referenciaId),
      regras: resumo.regras || {},
      resumo: {
        skus: Number(resumo.skus || 0),
        identificados: Number(resumo.identificados || 0),
        pos_80: Number(resumo.pos_80 || 0),
        giro_bruto_100: Number(resumo.giro_bruto_100 || 0),
        giro_bruto_120: Number(resumo.giro_bruto_120 || 0),
        giro_100: Number(resumo.giro_100 || 0),
        pontuacao_estimada: Number(resumo.pontuacao_estimada || 0),
        maximo_estimado: Number(resumo.maximo_estimado || 0),
      },
      produtos_meta: produtos,
      fechado_em: fechadoEm,
      aviso: resumo.aviso || '',
    }

    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO desafio_gigantes_fechamentos(
        id,ano_mes,escopo,referencia_id,referencia_nome,snapshot_json,fechado_em
      ) VALUES(?,?,?,?,?,?,?)
    `).bind(
      `dgh-${crypto.randomUUID()}`,
      anoMes,
      escopo,
      referenciaId,
      snapshot.referencia_nome,
      JSON.stringify(snapshot),
      fechadoEm,
    ).run()
    if (Number(result?.meta?.changes || 0) > 0) criados += 1
    else preservados += 1
  }

  return {
    ignorado: false,
    registros: referencias.length,
    criados,
    preservados,
    imutavel: true,
    mensagem: preservados
      ? 'O fechamento do Desafio já existente foi preservado sem alterações.'
      : 'Resultado final do Desafio arquivado no Histórico mensal.',
  }
}
