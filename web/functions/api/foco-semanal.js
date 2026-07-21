import { authorized, json } from '../_lib/credentials.js'
import { ITEM_FATURADO } from '../_lib/commercial.js'

const texto = value => String(value ?? '').trim()
const numero = value => (Number.isFinite(Number(value)) ? Number(value) : 0)
const digitos = value => texto(value).replace(/\D/g, '')
const dataValida = value => /^\d{4}-\d{2}-\d{2}$/.test(texto(value))

async function exigirAcesso(request, env) {
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Sessão inválida. Entre novamente no painel.' }, 401)
  }
  return null
}

function semanaAtual() {
  const agora = new Date()
  const segunda = new Date(agora)
  segunda.setDate(agora.getDate() - ((agora.getDay() + 6) % 7))
  const domingo = new Date(segunda)
  domingo.setDate(segunda.getDate() + 6)
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { inicio: iso(segunda), fim: iso(domingo) }
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const padrao = semanaAtual()
    const inicio = dataValida(params.get('inicio')) ? params.get('inicio') : padrao.inicio
    const fim = dataValida(params.get('fim')) ? params.get('fim') : padrao.fim
    const consultor = texto(params.get('consultor'))
    const uf = texto(params.get('uf')).toUpperCase().slice(0, 2)

    const sql = `
      WITH consultores_escopo AS (
        SELECT
          co.id,
          co.nome,
          COALESCE(MIN(NULLIF(TRIM(cl.setor_rep), '')), '') setor
        FROM consultores co
        LEFT JOIN clientes cl
          ON cl.consultor_id = co.id
         AND cl.carteira_importada = 1
         AND cl.ativo = 1
        WHERE co.ativo = 1
          AND co.origem = 'PAINEL_EQUIPE'
          AND (? = '' OR co.id = ?)
          AND (? = '' OR EXISTS (
            SELECT 1
            FROM clientes cu
            WHERE cu.consultor_id = co.id
              AND cu.carteira_importada = 1
              AND cu.ativo = 1
              AND UPPER(TRIM(COALESCE(cu.uf, ''))) = ?
          ))
        GROUP BY co.id, co.nome
      ),
      focos_escopo AS (
        SELECT
          f.id foco_id,
          f.semana_inicio,
          f.semana_fim,
          COALESCE(NULLIF(TRIM(f.produto_id), ''), pr.id, '') produto_id,
          COALESCE(NULLIF(TRIM(f.ean), ''), pr.ean, '') ean,
          COALESCE(NULLIF(TRIM(f.descricao), ''), pr.descricao, 'Produto foco') descricao,
          COALESCE(f.observacoes, '') observacoes,
          f.meta_clientes meta_legada_quantidade,
          f.meta_valor meta_legada_valor
        FROM foco_semanal f
        LEFT JOIN produtos pr
          ON pr.id = NULLIF(TRIM(f.produto_id), '')
          OR (NULLIF(TRIM(f.produto_id), '') IS NULL AND pr.ean = f.ean)
        WHERE f.ativo = 1
          AND DATE(f.semana_inicio) <= DATE(?)
          AND DATE(f.semana_fim) >= DATE(?)
      ),
      metas AS (
        SELECT
          f.*,
          co.id consultor_id,
          co.nome consultor,
          co.setor,
          COALESCE(
            fx.meta_quantidade,
            CASE WHEN NOT EXISTS (
              SELECT 1 FROM foco_consultores fa
              WHERE fa.foco_id = f.foco_id AND fa.ativo = 1
            ) THEN f.meta_legada_quantidade ELSE 0 END,
            0
          ) meta_quantidade,
          COALESCE(
            fx.meta_valor,
            CASE WHEN NOT EXISTS (
              SELECT 1 FROM foco_consultores fa
              WHERE fa.foco_id = f.foco_id AND fa.ativo = 1
            ) THEN f.meta_legada_valor ELSE 0 END,
            0
          ) meta_valor
        FROM focos_escopo f
        CROSS JOIN consultores_escopo co
        LEFT JOIN foco_consultores fx
          ON fx.foco_id = f.foco_id
         AND fx.consultor_id = co.id
         AND fx.ativo = 1
        WHERE NOT EXISTS (
          SELECT 1 FROM foco_consultores fa
          WHERE fa.foco_id = f.foco_id AND fa.ativo = 1
        ) OR fx.consultor_id IS NOT NULL
      ),
      vendas AS (
        SELECT
          cl.consultor_id,
          cl.id cliente_id,
          COALESCE(NULLIF(TRIM(ip.produto_id), ''), pr.id, '') produto_id,
          COALESCE(NULLIF(TRIM(ip.ean), ''), pr.ean, '') ean,
          pe.id pedido_id,
          DATE(COALESCE(NULLIF(TRIM(pe.data_faturamento), ''), NULLIF(TRIM(pe.data_pedido), ''))) data_venda,
          CASE
            WHEN COALESCE(ip.valor_faturado, 0) <= 0 THEN 0
            WHEN COALESCE(ip.quantidade_faturada, 0) > 0 THEN ip.quantidade_faturada
            WHEN COALESCE(ip.quantidade_atendida, 0) > 0 THEN ip.quantidade_atendida
            WHEN COALESCE(ip.quantidade_solicitada, 0) > 0 THEN ip.quantidade_solicitada
            ELSE 0
          END quantidade,
          COALESCE(ip.valor_faturado, 0) valor
        FROM itens_pedido ip
        JOIN pedidos pe ON pe.id = ip.pedido_id
        LEFT JOIN produtos pr ON pr.id = ip.produto_id
        JOIN clientes cl
          ON cl.id = pe.cliente_id
         AND cl.carteira_importada = 1
         AND cl.ativo = 1
        WHERE ${ITEM_FATURADO}
          AND (? = '' OR UPPER(TRIM(COALESCE(cl.uf, ''))) = ?)
      )
      SELECT
        m.foco_id,
        m.semana_inicio,
        m.semana_fim,
        m.produto_id,
        m.ean,
        m.descricao,
        m.observacoes,
        m.consultor_id,
        m.consultor,
        m.setor,
        m.meta_quantidade,
        m.meta_valor,
        COUNT(DISTINCT CASE WHEN v.valor > 0 THEN v.cliente_id END) cnpj_positivados,
        COUNT(DISTINCT v.pedido_id) pedidos,
        COALESCE(SUM(v.quantidade), 0) realizado_quantidade,
        COALESCE(SUM(v.valor), 0) faturamento
      FROM metas m
      LEFT JOIN vendas v
        ON v.consultor_id = m.consultor_id
       AND v.data_venda BETWEEN DATE(m.semana_inicio) AND DATE(m.semana_fim)
       AND (
         (m.produto_id <> '' AND v.produto_id = m.produto_id)
         OR (
           m.ean <> ''
           AND REPLACE(REPLACE(REPLACE(TRIM(v.ean), '.0', ''), ' ', ''), '-', '') =
               REPLACE(REPLACE(REPLACE(TRIM(m.ean), '.0', ''), ' ', ''), '-', '')
         )
       )
      GROUP BY m.foco_id, m.consultor_id
      ORDER BY m.descricao COLLATE NOCASE, m.consultor COLLATE NOCASE
    `

    const consultoresSql = `
      SELECT
        co.id,
        co.nome,
        COALESCE(MIN(NULLIF(TRIM(cl.setor_rep), '')), '') setor
      FROM consultores co
      LEFT JOIN clientes cl
        ON cl.consultor_id = co.id
       AND cl.carteira_importada = 1
       AND cl.ativo = 1
      WHERE co.ativo = 1 AND co.origem = 'PAINEL_EQUIPE'
      GROUP BY co.id, co.nome
      ORDER BY co.nome COLLATE NOCASE
    `

    const produtosSql = `
      SELECT id, ean, descricao, COALESCE(laboratorio, '') laboratorio
      FROM produtos
      WHERE ativo = 1
        AND TRIM(COALESCE(ean, '')) <> ''
        AND TRIM(COALESCE(descricao, '')) <> ''
      ORDER BY descricao COLLATE NOCASE, ean
      LIMIT 1500
    `

    const [resultado, consultores, ufs, produtos] = await env.DB.batch([
      env.DB.prepare(sql).bind(consultor, consultor, uf, uf, fim, inicio, uf, uf),
      env.DB.prepare(consultoresSql),
      env.DB.prepare("SELECT DISTINCT UPPER(TRIM(uf)) uf FROM clientes WHERE carteira_importada=1 AND ativo=1 AND LENGTH(TRIM(COALESCE(uf,'')))=2 ORDER BY uf"),
      env.DB.prepare(produtosSql),
    ])

    const linhas = (resultado.results || []).map(item => {
      const meta = numero(item.meta_quantidade)
      const realizado = numero(item.realizado_quantidade)
      return {
        ...item,
        id: `${item.foco_id}:${item.consultor_id}`,
        meta_quantidade: meta,
        meta_valor: numero(item.meta_valor),
        realizado_quantidade: realizado,
        cobertura_percentual: meta > 0 ? (realizado / meta) * 100 : 0,
        cnpj_positivados: numero(item.cnpj_positivados),
        pedidos: numero(item.pedidos),
        faturamento: numero(item.faturamento),
      }
    })

    return json({
      periodo: { inicio, fim },
      linhas,
      filtros: {
        consultores: consultores.results || [],
        ufs: (ufs.results || []).map(item => String(item.uf || '')).filter(Boolean),
        produtos: produtos.results || [],
      },
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table') || detalhe.includes('no such column')) {
      return json({
        periodo: semanaAtual(),
        linhas: [],
        filtros: { consultores: [], ufs: [], produtos: [] },
        aviso: 'A atualização do Foco Semanal ainda não foi aplicada no banco.',
      })
    }
    return json({ erro: 'Não foi possível carregar o Foco Semanal.', detalhe }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  const negado = await exigirAcesso(request, env)
  if (negado) return negado

  try {
    const body = await request.json()
    const acao = texto(body.acao || 'salvar')
    const agora = new Date().toISOString()

    if (acao === 'excluir') {
      const id = texto(body.id)
      await env.DB.batch([
        env.DB.prepare('UPDATE foco_semanal SET ativo=0,atualizado_em=? WHERE id=?').bind(agora, id),
        env.DB.prepare('UPDATE foco_consultores SET ativo=0 WHERE foco_id=?').bind(id),
      ])
      return json({ sucesso: true, id })
    }

    const inicio = texto(body.semana_inicio)
    const fim = texto(body.semana_fim)
    const produtoIdInformado = texto(body.produto_id)
    const eanInformado = digitos(body.ean)
    const metas = Array.isArray(body.consultores)
      ? body.consultores.filter(item => texto(item?.id))
      : []

    if (!dataValida(inicio) || !dataValida(fim) || inicio > fim || (!produtoIdInformado && !eanInformado) || !metas.length) {
      return json({ erro: 'Informe período, produto e ao menos uma meta de consultor.' }, 400)
    }

    let produto = null
    if (produtoIdInformado) {
      produto = await env.DB.prepare('SELECT id,ean,descricao FROM produtos WHERE id=? AND ativo=1 LIMIT 1').bind(produtoIdInformado).first()
    }
    if (!produto && eanInformado) {
      produto = await env.DB.prepare('SELECT id,ean,descricao FROM produtos WHERE ean=? AND ativo=1 LIMIT 1').bind(eanInformado).first()
    }

    const produtoId = texto(produto?.id || produtoIdInformado)
    const ean = digitos(produto?.ean || eanInformado)
    const descricao = texto(produto?.descricao || body.descricao || `Produto ${ean}`)

    if (!ean) return json({ erro: 'O produto selecionado não possui EAN válido.' }, 400)

    let id = texto(body.id)
    if (!id) {
      const existente = await env.DB.prepare(`
        SELECT id
        FROM foco_semanal
        WHERE semana_inicio=?
          AND semana_fim=?
          AND (
            (?<>'' AND produto_id=?)
            OR (?<>'' AND ean=?)
          )
        LIMIT 1
      `).bind(inicio, fim, produtoId, produtoId, ean, ean).first()
      id = existente?.id || `foco-${crypto.randomUUID()}`
    }

    await env.DB.prepare(`
      INSERT INTO foco_semanal(
        id,semana_inicio,semana_fim,produto_id,ean,descricao,
        meta_clientes,meta_valor,observacoes,criado_por,ativo,criado_em,atualizado_em
      ) VALUES(?,?,?,?,?,?,?,?,?,'Painel',1,?,?)
      ON CONFLICT(id) DO UPDATE SET
        semana_inicio=excluded.semana_inicio,
        semana_fim=excluded.semana_fim,
        produto_id=excluded.produto_id,
        ean=excluded.ean,
        descricao=excluded.descricao,
        observacoes=excluded.observacoes,
        ativo=1,
        atualizado_em=excluded.atualizado_em
    `).bind(
      id,
      inicio,
      fim,
      produtoId || null,
      ean,
      descricao,
      0,
      0,
      texto(body.observacoes),
      agora,
      agora,
    ).run()

    const comandos = [env.DB.prepare('UPDATE foco_consultores SET ativo=0 WHERE foco_id=?').bind(id)]
    for (const meta of metas) {
      comandos.push(env.DB.prepare(`
        INSERT INTO foco_consultores(foco_id,consultor_id,ativo,meta_quantidade,meta_valor)
        VALUES(?,?,1,?,?)
        ON CONFLICT(foco_id,consultor_id) DO UPDATE SET
          ativo=1,
          meta_quantidade=excluded.meta_quantidade,
          meta_valor=excluded.meta_valor
      `).bind(id, texto(meta.id), numero(meta.meta_quantidade), numero(meta.meta_valor)))
    }
    await env.DB.batch(comandos)

    return json({ sucesso: true, id, consultores: metas.length, produto: { id: produtoId, ean, descricao } })
  } catch (error) {
    return json({ erro: 'Não foi possível salvar o foco.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
