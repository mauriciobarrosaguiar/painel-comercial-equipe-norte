const texto = (value) => String(value ?? '').trim()
const digitos = (value) => texto(value).replace(/\D/g, '')
const alto = (value) => texto(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim().toUpperCase()
const numero = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  let normalized = texto(value).replace(/%/g, '').replace(/\s/g, '')
  if (normalized.includes(',') && normalized.includes('.')) normalized = normalized.replace(/\./g, '').replace(',', '.')
  else if (normalized.includes(',')) normalized = normalized.replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

async function executarJson(env, sql, rows, tamanho = 300, antes = []) {
  for (let index = 0; index < rows.length; index += tamanho) {
    await env.DB.prepare(sql).bind(...antes, JSON.stringify(rows.slice(index, index + tamanho))).run()
  }
}

async function referenciasPainel(env) {
  const [consultoresResult, gerentesResult] = await env.DB.batch([
    env.DB.prepare(`SELECT c.id,c.nome,MIN(NULLIF(TRIM(cl.setor_rep),'')) setor FROM consultores c LEFT JOIN clientes cl ON cl.consultor_id=c.id AND cl.carteira_importada=1 AND cl.ativo=1 WHERE c.ativo=1 AND c.origem='PAINEL_EQUIPE' GROUP BY c.id,c.nome`),
    env.DB.prepare(`SELECT DISTINCT TRIM(nome_gd) nome FROM clientes WHERE carteira_importada=1 AND ativo=1 AND TRIM(COALESCE(nome_gd,''))<>''`),
  ])
  const consultores = consultoresResult.results || []
  const gerentes = gerentesResult.results || []
  return {
    porSetor: new Map(consultores.filter((item) => digitos(item.setor)).map((item) => [digitos(item.setor), item])),
    porNome: new Map(consultores.filter((item) => alto(item.nome)).map((item) => [alto(item.nome), item])),
    gdPorNome: new Map(gerentes.filter((item) => alto(item.nome)).map((item) => [alto(item.nome), item])),
  }
}

function normalizarLinha(row) {
  const cargo = alto(row.escopo || row.cargo || row.tipo)
  return {
    escopo: cargo.includes('GERENTE') || cargo.includes('DISTRITAL') || cargo === 'GD' ? 'gerente' : 'consultor',
    setor: digitos(row.setor || row.setor_consultor || row.setor_gd || row.reg),
    nome_colaborador: texto(row.nome_colaborador || row.nome_consultor || row.nome_gd || row.consultor || row.colaborador || row.nome),
    sku: digitos(row.sap || row.sku || row.cod_sap || row.codigo_sap),
    produto_planilha: texto(row.produto || row.descricao || row.produto_planilha),
    meta_positivacao: numero(row.meta_positivacao || row.positivacao),
    meta_giro: numero(row.meta_giro || row.giro),
  }
}

export async function importarDesafioGigantes(env, rows, nomeArquivo, anoMes) {
  if (!/^\d{4}-\d{2}$/.test(anoMes)) throw new Error('Informe o mês do Desafio de Gigantes no formato AAAA-MM.')
  const refs = await referenciasPainel(env)
  if (!refs.porNome.size) throw new Error('Importe primeiro o Painel Equipe Norte.')

  const aceitas = new Map()
  const consultores = new Set()
  const gerentes = new Set()
  let ignoradas = 0
  for (const row of rows) {
    const linha = normalizarLinha(row)
    if (!linha.sku || !linha.nome_colaborador) { ignoradas += 1; continue }
    let consultorId = ''
    if (linha.escopo === 'consultor') {
      const ref = refs.porSetor.get(linha.setor) || refs.porNome.get(alto(linha.nome_colaborador))
      if (!ref) { ignoradas += 1; continue }
      consultorId = texto(ref.id)
      linha.setor = linha.setor || digitos(ref.setor)
      linha.nome_colaborador = texto(ref.nome) || linha.nome_colaborador
      consultores.add(consultorId)
    } else {
      const ref = refs.gdPorNome.get(alto(linha.nome_colaborador))
      if (!ref) { ignoradas += 1; continue }
      linha.nome_colaborador = texto(ref.nome) || linha.nome_colaborador
      gerentes.add(alto(linha.nome_colaborador))
    }
    const chave = `${linha.escopo}|${linha.setor}|${linha.sku}`
    aceitas.set(chave, { ...linha, consultor_id: consultorId, id: `dg:${anoMes}:${chave}` })
  }
  const metas = [...aceitas.values()]
  if (!metas.length) throw new Error('Nenhuma meta corresponde aos consultores ou GDs ativos do painel.')
  const skus = [...new Set(metas.map((item) => item.sku))]
  const agora = new Date().toISOString()
  const token = `imp-${crypto.randomUUID()}`

  await executarJson(env, `INSERT INTO desafio_gigantes_produtos(sku,status,tentativas,atualizado_em) SELECT json_extract(value,'$.sku'),'PENDENTE',0,? FROM json_each(?) WHERE 1 ON CONFLICT(sku) DO NOTHING`, skus.map((sku) => ({ sku })), 300, [agora])
  await env.DB.prepare('DELETE FROM desafio_gigantes_metas WHERE ano_mes=?').bind(anoMes).run()
  await executarJson(env, `INSERT INTO desafio_gigantes_metas(id,ano_mes,escopo,consultor_id,nome_colaborador,setor,sku,produto_planilha,meta_positivacao,meta_giro,ean,produto_identificado,status_identificacao,importacao_id,atualizado_em) SELECT json_extract(j.value,'$.id'),?,json_extract(j.value,'$.escopo'),NULLIF(json_extract(j.value,'$.consultor_id'),''),json_extract(j.value,'$.nome_colaborador'),json_extract(j.value,'$.setor'),json_extract(j.value,'$.sku'),json_extract(j.value,'$.produto_planilha'),json_extract(j.value,'$.meta_positivacao'),json_extract(j.value,'$.meta_giro'),p.ean,p.produto,COALESCE(p.status,'PENDENTE'),?,? FROM json_each(?) j LEFT JOIN desafio_gigantes_produtos p ON p.sku=json_extract(j.value,'$.sku')`, metas, 250, [anoMes, token, agora])
  await env.DB.prepare("INSERT INTO importacoes(id,tipo,nome_arquivo,total_registros,status,criado_em) VALUES(?,'DESAFIO_GIGANTES_METAS',?,?,?,?)").bind(token, nomeArquivo, metas.length, 'concluido', agora).run()

  const status = await env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='IDENTIFICADO' THEN 1 ELSE 0 END) identificados,SUM(CASE WHEN status='PENDENTE' THEN 1 ELSE 0 END) pendentes,SUM(CASE WHEN status='AMBIGUO' THEN 1 ELSE 0 END) ambiguos,SUM(CASE WHEN status='NAO_ENCONTRADO' THEN 1 ELSE 0 END) nao_encontrados,SUM(CASE WHEN status='ERRO' THEN 1 ELSE 0 END) erros FROM desafio_gigantes_produtos WHERE sku IN (SELECT DISTINCT sku FROM desafio_gigantes_metas WHERE ano_mes=?)`).bind(anoMes).first()
  return {
    total: metas.length,
    consultores: consultores.size,
    gerentes: gerentes.size,
    ignoradas,
    skus: skus.length,
    ano_mes: anoMes,
    identificacao: {
      total: Number(status?.total || 0), identificados: Number(status?.identificados || 0),
      pendentes: Number(status?.pendentes || 0), ambiguos: Number(status?.ambiguos || 0),
      nao_encontrados: Number(status?.nao_encontrados || 0), erros: Number(status?.erros || 0),
    },
  }
}

export async function obterStatusDesafioGigantes(env) {
  const [metas, produtos, ultima] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) total FROM desafio_gigantes_metas'),
    env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='IDENTIFICADO' THEN 1 ELSE 0 END) identificados,SUM(CASE WHEN status='PENDENTE' THEN 1 ELSE 0 END) pendentes,SUM(CASE WHEN status='AMBIGUO' THEN 1 ELSE 0 END) ambiguos,SUM(CASE WHEN status='NAO_ENCONTRADO' THEN 1 ELSE 0 END) nao_encontrados,SUM(CASE WHEN status='ERRO' THEN 1 ELSE 0 END) erros FROM desafio_gigantes_produtos WHERE sku IN (SELECT DISTINCT sku FROM desafio_gigantes_metas)`),
    env.DB.prepare('SELECT MAX(ano_mes) ano_mes FROM desafio_gigantes_metas'),
  ])
  const status = produtos.results?.[0] || {}
  return {
    metas: Number(metas.results?.[0]?.total || 0), produtos: Number(status.total || 0),
    identificados: Number(status.identificados || 0), pendentes: Number(status.pendentes || 0),
    ambiguos: Number(status.ambiguos || 0), nao_encontrados: Number(status.nao_encontrados || 0),
    erros: Number(status.erros || 0), ano_mes: texto(ultima.results?.[0]?.ano_mes),
  }
}
