import { authorized, json } from '../../_lib/credentials.js'
import { classificarMix } from '../../_lib/commercial.js'

const TIPOS = new Set(['painel', 'metas', 'produtos_mix', 'produtos_mercado_farma', 'metas_mix'])
const texto = (value) => String(value ?? '').trim()
const digitos = (value) => texto(value).replace(/\D/g, '')
const alto = (value) => texto(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase()
const numero = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  let normalized = texto(value).replace(/R\$/g, '').replace(/%/g, '').replace(/\s/g, '')
  if (normalized.includes(',') && normalized.includes('.')) normalized = normalized.replace(/\./g, '').replace(',', '.')
  else if (normalized.includes(',')) normalized = normalized.replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}
const ativo = (value) => !/(INATIV|CANCEL|ENCERR|BLOQUE)/.test(alto(value))

async function idEstavel(prefixo, ...partes) {
  const bytes = new TextEncoder().encode(partes.map(texto).join('|'))
  const hash = await crypto.subtle.digest('SHA-1', bytes)
  const hex = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${prefixo}-${hex.slice(0, 28)}`
}

async function admin(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) return json({ erro: 'Chave administrativa não configurada.' }, 503)
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) return json({ erro: 'Chave administrativa inválida.' }, 401)
  return null
}

async function executarJson(env, sql, rows, tamanho = 400, antes = [], depois = []) {
  for (let index = 0; index < rows.length; index += tamanho) {
    const bloco = JSON.stringify(rows.slice(index, index + tamanho))
    await env.DB.prepare(sql).bind(...antes, bloco, ...depois).run()
  }
}

async function registrar(env, tipo, nome, total) {
  const agora = new Date().toISOString()
  await env.DB.prepare('INSERT INTO importacoes(id,tipo,nome_arquivo,total_registros,status,criado_em) VALUES(?,?,?,?,?,?)')
    .bind(`imp-${crypto.randomUUID()}`, tipo, nome, total, 'concluido', agora).run()
}

async function obterStatus(env) {
  const results = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) total FROM clientes WHERE carteira_importada=1'),
    env.DB.prepare("SELECT COUNT(*) total FROM produtos WHERE UPPER(COALESCE(tipo_mix,''))<>'SEM CLASSIFICACAO'"),
    env.DB.prepare('SELECT COUNT(*) total FROM produtos WHERE mercado_farma_ativo=1'),
    env.DB.prepare('SELECT COUNT(*) total FROM metas'),
    env.DB.prepare('SELECT tipo,nome_arquivo,total_registros,status,criado_em FROM importacoes ORDER BY criado_em DESC LIMIT 8'),
  ])
  return {
    painel: Number(results[0]?.results?.[0]?.total || 0),
    produtos_mix: Number(results[1]?.results?.[0]?.total || 0),
    produtos_mercado_farma: Number(results[2]?.results?.[0]?.total || 0),
    metas: Number(results[3]?.results?.[0]?.total || 0),
    historico: results[4]?.results || [],
  }
}

async function importarPainel(env, rows, nome) {
  const token = crypto.randomUUID()
  const consultores = new Map()
  const clientes = []
  for (const row of rows) {
    const bruto = digitos(row.cnpj)
    if (!bruto) continue
    const cnpj = bruto.slice(-14).padStart(14, '0')
    if (/^0+$/.test(cnpj)) continue
    const nomeRep = texto(row.nome_rep || row.consultor || row.representante)
    const consultorId = nomeRep ? await idEstavel('cons', nomeRep) : null
    if (consultorId) consultores.set(consultorId, { id: consultorId, nome: nomeRep })
    clientes.push({
      id: await idEstavel('cli', cnpj),
      cnpj,
      nome_fantasia: texto(row.nome_pdv || row.nome_fantasia || row.razao_social),
      cidade: texto(row.cidade),
      uf: alto(row.uf).slice(0, 2),
      situacao: texto(row.situacao),
      grupo_economico: texto(row.grupo_economico),
      rede_associacao: texto(row.rede_associacao),
      bandeira: texto(row.bandeira),
      nome_gd: texto(row.nome_gd),
      consultor_id: consultorId,
      setor_rep: texto(row.setor_rep),
      foco_pex: texto(row.foco_pex),
      positivacao: texto(row.positivacao),
      grupo_sip: texto(row.grupo_economico || row.rede_associacao || row.bandeira || row.nome_pdv),
      ativo: ativo(row.situacao) ? 1 : 0,
      token,
    })
  }
  if (!clientes.length) throw new Error('O Painel Equipe Norte não possui clientes válidos.')
  const agora = new Date().toISOString()
  for (const consultor of consultores.values()) {
    await env.DB.prepare("INSERT INTO consultores(id,nome,origem,ativo,atualizado_em) VALUES(?,?,'PAINEL_EQUIPE',1,?) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome,origem='PAINEL_EQUIPE',ativo=1,atualizado_em=excluded.atualizado_em")
      .bind(consultor.id, consultor.nome, agora).run()
  }
  await executarJson(env, `
    INSERT INTO clientes(id,cnpj,nome_fantasia,cidade,uf,situacao,grupo_economico,rede_associacao,bandeira,nome_gd,consultor_id,setor_rep,foco_pex,positivacao,grupo_sip,ativo,carteira_importada,carteira_importacao_id,atualizado_em)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.cnpj'),json_extract(value,'$.nome_fantasia'),json_extract(value,'$.cidade'),json_extract(value,'$.uf'),json_extract(value,'$.situacao'),json_extract(value,'$.grupo_economico'),json_extract(value,'$.rede_associacao'),json_extract(value,'$.bandeira'),json_extract(value,'$.nome_gd'),json_extract(value,'$.consultor_id'),json_extract(value,'$.setor_rep'),json_extract(value,'$.foco_pex'),json_extract(value,'$.positivacao'),json_extract(value,'$.grupo_sip'),json_extract(value,'$.ativo'),1,json_extract(value,'$.token'),?
      FROM json_each(?) WHERE 1
    ON CONFLICT(cnpj) DO UPDATE SET nome_fantasia=excluded.nome_fantasia,cidade=excluded.cidade,uf=excluded.uf,situacao=excluded.situacao,grupo_economico=excluded.grupo_economico,rede_associacao=excluded.rede_associacao,bandeira=excluded.bandeira,nome_gd=excluded.nome_gd,consultor_id=excluded.consultor_id,setor_rep=excluded.setor_rep,foco_pex=excluded.foco_pex,positivacao=excluded.positivacao,grupo_sip=excluded.grupo_sip,ativo=excluded.ativo,carteira_importada=1,carteira_importacao_id=excluded.carteira_importacao_id,atualizado_em=excluded.atualizado_em
  `, clientes, 250, [agora])
  await env.DB.batch([
    env.DB.prepare("UPDATE clientes SET carteira_importada=0,consultor_id=NULL WHERE carteira_importada=1 AND COALESCE(carteira_importacao_id,'')<>?").bind(token),
    env.DB.prepare("UPDATE consultores SET ativo=CASE WHEN EXISTS(SELECT 1 FROM clientes c WHERE c.consultor_id=consultores.id AND c.carteira_importada=1) THEN 1 ELSE 0 END WHERE origem='PAINEL_EQUIPE'"),
    env.DB.prepare("UPDATE pedidos SET consultor_id=(SELECT c.consultor_id FROM clientes c WHERE c.id=pedidos.cliente_id AND c.carteira_importada=1) WHERE origem='BUSSOLA'"),
  ])
  await registrar(env, 'PAINEL_EQUIPE_NORTE', nome, clientes.length)
  return { total: clientes.length, consultores: consultores.size }
}

function normalizarProduto(row, token) {
  const ean = digitos(row.ean)
  const sku = digitos(row.sku || row.cod_sap || row.codigo_sap || row.cod_sku)
  const tipoMix = classificarMix(row.tipo_mix || row.classificacao || row.categoria || row.tipo)
  const descricao = texto(row.produto || row.descricao || row.descricao_do_sku || row.sku_descricao || row.molecula)
  return {
    ean,
    sku,
    descricao: descricao || (ean ? `Produto ${ean}` : `Produto SAP ${sku}`),
    molecula: texto(row.molecula),
    tipo_mix: tipoMix,
    token,
  }
}

async function importarProdutos(env, rows, nome, tipo) {
  const token = `imp-${crypto.randomUUID()}`
  const porEan = new Map()
  const porSku = new Map()
  for (const row of rows) {
    const produto = normalizarProduto(row, token)
    if (tipo === 'produtos_mercado_farma') {
      if (!produto.ean) continue
      porEan.set(produto.ean, { ...produto, id: await idEstavel('prod', produto.ean) })
      continue
    }
    if (produto.tipo_mix === 'SEM CLASSIFICACAO') continue
    if (produto.sku) porSku.set(produto.sku, produto)
    if (produto.ean) porEan.set(produto.ean, { ...produto, id: await idEstavel('prod', produto.ean) })
  }
  const dadosEan = [...porEan.values()]
  const dadosSku = [...porSku.values()]
  if (tipo === 'produtos_mercado_farma' && !dadosEan.length) throw new Error('A planilha não possui EANs válidos.')
  if (tipo === 'produtos_mix' && !dadosEan.length && !dadosSku.length) throw new Error('A planilha não possui EAN ou COD SAP com classificação MIX válida.')
  const agora = new Date().toISOString()

  if (tipo === 'produtos_mix') {
    if (dadosSku.length) {
      await executarJson(env, `
        INSERT INTO produtos_mix_sap(sku,molecula,descricao,tipo_mix,ativo,importacao_id,atualizado_em)
        SELECT json_extract(value,'$.sku'),json_extract(value,'$.molecula'),json_extract(value,'$.descricao'),json_extract(value,'$.tipo_mix'),1,json_extract(value,'$.token'),?
          FROM json_each(?) WHERE 1
        ON CONFLICT(sku) DO UPDATE SET molecula=excluded.molecula,descricao=excluded.descricao,tipo_mix=excluded.tipo_mix,ativo=1,importacao_id=excluded.importacao_id,atualizado_em=excluded.atualizado_em
      `, dadosSku, 400, [agora])
      await env.DB.prepare("UPDATE produtos_mix_sap SET ativo=0 WHERE COALESCE(importacao_id,'')<>?").bind(token).run()
    }
    if (dadosEan.length) {
      await executarJson(env, `
        INSERT INTO produtos(id,ean,sku,descricao,tipo_mix,ativo,mix_importacao_id,atualizado_em)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.ean'),NULLIF(json_extract(value,'$.sku'),''),json_extract(value,'$.descricao'),json_extract(value,'$.tipo_mix'),1,json_extract(value,'$.token'),?
          FROM json_each(?) WHERE 1
        ON CONFLICT(ean) DO UPDATE SET sku=COALESCE(NULLIF(excluded.sku,''),produtos.sku),descricao=excluded.descricao,tipo_mix=excluded.tipo_mix,ativo=1,mix_importacao_id=excluded.mix_importacao_id,atualizado_em=excluded.atualizado_em
      `, dadosEan, 400, [agora])
    }
    if (dadosSku.length) {
      await env.DB.prepare(`
        UPDATE produtos
           SET tipo_mix=(SELECT m.tipo_mix FROM produtos_mix_sap m WHERE m.ativo=1 AND TRIM(m.sku)=TRIM(COALESCE(produtos.sku,'')) LIMIT 1),
               descricao=CASE WHEN TRIM(COALESCE(produtos.descricao,''))='' OR produtos.descricao LIKE 'Produto %'
                 THEN COALESCE((SELECT m.descricao FROM produtos_mix_sap m WHERE m.ativo=1 AND TRIM(m.sku)=TRIM(COALESCE(produtos.sku,'')) LIMIT 1),produtos.descricao)
                 ELSE produtos.descricao END,
               mix_importacao_id=?,
               atualizado_em=?
         WHERE EXISTS(SELECT 1 FROM produtos_mix_sap m WHERE m.ativo=1 AND TRIM(m.sku)=TRIM(COALESCE(produtos.sku,'')))
      `).bind(token, agora).run()
    }
    await env.DB.prepare("UPDATE produtos SET tipo_mix='SEM CLASSIFICACAO',mix_importacao_id=NULL WHERE COALESCE(mix_importacao_id,'')<>?").bind(token).run()
    const classificados = await env.DB.prepare('SELECT COUNT(*) total FROM produtos WHERE mix_importacao_id=?').bind(token).first()
    const naoEncontrados = dadosSku.length
      ? await env.DB.prepare(`
          SELECT COUNT(*) total
            FROM produtos_mix_sap m
           WHERE m.importacao_id=? AND m.ativo=1
             AND NOT EXISTS(SELECT 1 FROM produtos p WHERE TRIM(COALESCE(p.sku,''))=TRIM(m.sku))
        `).bind(token).first()
      : { total: 0 }
    const total = new Set([...dadosSku.map((item) => `sku:${item.sku}`), ...dadosEan.map((item) => `ean:${item.ean}`)]).size
    await registrar(env, 'PRODUTOS_MIX', nome, total)
    return {
      total,
      classificados: Number(classificados?.total || 0),
      nao_encontrados: Number(naoEncontrados?.total || 0),
      por_sku: dadosSku.length,
      por_ean: dadosEan.length,
    }
  }

  await executarJson(env, `
    INSERT INTO produtos(id,ean,descricao,ativo,mercado_farma_ativo,mercado_farma_importacao_id,atualizado_em)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.ean'),json_extract(value,'$.descricao'),1,1,json_extract(value,'$.token'),?
      FROM json_each(?) WHERE 1
    ON CONFLICT(ean) DO UPDATE SET descricao=excluded.descricao,ativo=1,mercado_farma_ativo=1,mercado_farma_importacao_id=excluded.mercado_farma_importacao_id,atualizado_em=excluded.atualizado_em
  `, dadosEan, 400, [agora])
  await env.DB.prepare("UPDATE produtos SET mercado_farma_ativo=0 WHERE mercado_farma_ativo=1 AND COALESCE(mercado_farma_importacao_id,'')<>?").bind(token).run()
  await registrar(env, 'PRODUTOS_MERCADO_FARMA', nome, dadosEan.length)
  return { total: dadosEan.length }
}

function somarMetas(rows) {
  return rows.reduce((total, row) => ({
    ol_sem_combate: total.ol_sem_combate + row.ol_sem_combate,
    ol_prioritarios: total.ol_prioritarios + row.ol_prioritarios,
    ol_lancamentos: total.ol_lancamentos + row.ol_lancamentos,
    clientes_positivados: total.clientes_positivados + row.clientes_positivados,
    demanda_sem_combate: total.demanda_sem_combate + row.demanda_sem_combate,
  }), { ol_sem_combate: 0, ol_prioritarios: 0, ol_lancamentos: 0, clientes_positivados: 0, demanda_sem_combate: 0 })
}

async function importarMetas(env, rows, nome, anoMes) {
  if (!/^\d{4}-\d{2}$/.test(anoMes)) throw new Error('Informe o mês das metas no formato AAAA-MM.')
  const consultores = []
  const gerentes = []
  for (const row of rows) {
    const nomeColaborador = texto(row.consultor || row.colaborador)
    if (!nomeColaborador) continue
    const escopoInformado = alto(row.escopo || row.cargo)
    const meta = {
      nome: nomeColaborador,
      ol_sem_combate: numero(row.ol_sem_combate),
      ol_prioritarios: numero(row.ol_prioritarios),
      ol_lancamentos: numero(row.ol_lancamentos),
      clientes_positivados: numero(row.clientes_positivados),
      demanda_sem_combate: numero(row.demanda_sem_combate),
    }
    if (escopoInformado.includes('GERENTE') || escopoInformado.includes('DISTRITAL') || escopoInformado === 'GD') {
      gerentes.push(meta)
      continue
    }
    const consultorId = await idEstavel('cons', nomeColaborador)
    consultores.push({
      ...meta,
      id: await idEstavel('meta', anoMes, 'consultor', consultorId),
      consultor_id: consultorId,
    })
  }
  if (!consultores.length && !gerentes.length) throw new Error('A planilha não possui metas válidas.')
  const gerente = gerentes.length ? somarMetas(gerentes) : somarMetas(consultores)
  const agora = new Date().toISOString()
  const token = `imp-${crypto.randomUUID()}`
  for (const consultor of consultores) {
    await env.DB.prepare("INSERT INTO consultores(id,nome,origem,ativo,atualizado_em) VALUES(?,?,'METAS',1,?) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome,atualizado_em=excluded.atualizado_em")
      .bind(consultor.consultor_id, consultor.nome, agora).run()
  }
  const gerenteId = await idEstavel('meta', anoMes, 'gerente')
  await env.DB.batch([
    env.DB.prepare("INSERT INTO importacoes(id,tipo,nome_arquivo,total_registros,status,criado_em) VALUES(?,'METAS_COMERCIAIS',?,?,?,?)")
      .bind(token, nome, consultores.length + 1, 'concluido', agora),
    env.DB.prepare(`
      INSERT INTO metas_historico(meta_id,ano_mes,escopo,consultor_id,ol_sem_combate,ol_prioritarios,ol_lancamentos,clientes_positivados,demanda_sem_combate,importacao_anterior_id,nova_importacao_id,substituida_em)
      SELECT id,ano_mes,escopo,consultor_id,ol_sem_combate,ol_prioritarios,ol_lancamentos,clientes_positivados,COALESCE(demanda_sem_combate,0),importacao_id,?,?
        FROM metas WHERE ano_mes=?
    `).bind(token, agora, anoMes),
    env.DB.prepare(`
      INSERT INTO metas(id,ano_mes,escopo,consultor_id,ol_sem_combate,ol_prioritarios,ol_lancamentos,clientes_positivados,demanda_sem_combate,importacao_id,atualizado_em)
      SELECT json_extract(value,'$.id'),?,'consultor',json_extract(value,'$.consultor_id'),json_extract(value,'$.ol_sem_combate'),json_extract(value,'$.ol_prioritarios'),json_extract(value,'$.ol_lancamentos'),json_extract(value,'$.clientes_positivados'),json_extract(value,'$.demanda_sem_combate'),?,?
        FROM json_each(?) WHERE 1
      ON CONFLICT(id) DO UPDATE SET ol_sem_combate=excluded.ol_sem_combate,ol_prioritarios=excluded.ol_prioritarios,ol_lancamentos=excluded.ol_lancamentos,clientes_positivados=excluded.clientes_positivados,demanda_sem_combate=excluded.demanda_sem_combate,importacao_id=excluded.importacao_id,atualizado_em=excluded.atualizado_em
    `).bind(anoMes, token, agora, JSON.stringify(consultores)),
    env.DB.prepare(`
      INSERT INTO metas(id,ano_mes,escopo,consultor_id,ol_sem_combate,ol_prioritarios,ol_lancamentos,clientes_positivados,demanda_sem_combate,importacao_id,atualizado_em)
      VALUES(?,?,'gerente',NULL,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET ol_sem_combate=excluded.ol_sem_combate,ol_prioritarios=excluded.ol_prioritarios,ol_lancamentos=excluded.ol_lancamentos,clientes_positivados=excluded.clientes_positivados,demanda_sem_combate=excluded.demanda_sem_combate,importacao_id=excluded.importacao_id,atualizado_em=excluded.atualizado_em
    `).bind(gerenteId, anoMes, gerente.ol_sem_combate, gerente.ol_prioritarios, gerente.ol_lancamentos, gerente.clientes_positivados, gerente.demanda_sem_combate, token, agora),
    env.DB.prepare("DELETE FROM metas WHERE ano_mes=? AND COALESCE(importacao_id,'')<>?").bind(anoMes, token),
  ])
  return { total: consultores.length + 1, consultores: consultores.length, linhas_gd: gerentes.length, ano_mes: anoMes }
}

function validarTamanho(rows, nome) {
  if (!rows.length || rows.length > 30000) throw new Error(`${nome} está vazia ou excede 30.000 linhas.`)
}

export async function onRequestGet({ request, env }) {
  const negado = await admin(request, env)
  if (negado) return negado
  return json(await obterStatus(env))
}

export async function onRequestPost({ request, env }) {
  const negado = await admin(request, env)
  if (negado) return negado
  try {
    const body = await request.json()
    const tipo = texto(body.tipo)
    const rows = Array.isArray(body.rows) ? body.rows : []
    const nome = texto(body.nome_arquivo) || 'arquivo.xlsx'
    if (!TIPOS.has(tipo)) return json({ erro: 'Tipo de base inválido.' }, 400)

    if (tipo === 'metas_mix') {
      const mixRows = Array.isArray(body.mix_rows) ? body.mix_rows : []
      validarTamanho(rows, 'A aba METAS')
      validarTamanho(mixRows, 'As abas de produtos MIX')
      const possuiIdentificador = mixRows.some((row) => digitos(row.ean || row.sku || row.cod_sap || row.codigo_sap))
      const possuiClassificacao = mixRows.some((row) => classificarMix(row.tipo_mix || row.tipo || row.classificacao || row.categoria) !== 'SEM CLASSIFICACAO')
      if (!possuiIdentificador || !possuiClassificacao) throw new Error('As abas de MIX não possuem COD SAP/EAN e classificação válidos.')
      const metas = await importarMetas(env, rows, nome, texto(body.ano_mes))
      const produtosMix = await importarProdutos(env, mixRows, nome, 'produtos_mix')
      return json({
        sucesso: true,
        tipo,
        total: metas.total + produtosMix.total,
        metas,
        produtos_mix: produtosMix,
        bases: await obterStatus(env),
      })
    }

    validarTamanho(rows, 'A base')
    const resultado = tipo === 'painel'
      ? await importarPainel(env, rows, nome)
      : tipo === 'metas'
        ? await importarMetas(env, rows, nome, texto(body.ano_mes))
        : await importarProdutos(env, rows, nome, tipo)
    return json({ sucesso: true, tipo, ...resultado, bases: await obterStatus(env) })
  } catch (error) {
    return json({ erro: error instanceof Error ? error.message : String(error) }, 400)
  }
}
