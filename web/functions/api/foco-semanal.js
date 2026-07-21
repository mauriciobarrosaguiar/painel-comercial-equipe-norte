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
      WITH focos AS (
        SELECT
          f.id foco_id,
          f.semana_inicio,
          f.semana_fim,
          COALESCE(NULLIF(TRIM(f.produto_id), ''), pr.id, '') produto_id,
          COALESCE(NULLIF(TRIM(f.ean), ''), pr.ean, '') ean,
          COALESCE(NULLIF(TRIM(f.descricao), ''), pr.descricao, 'Produto foco') descricao,
          COALESCE(f.observacoes, '') observacoes
        FROM foco_semanal f
        LEFT JOIN produtos pr
          ON pr.id = NULLIF(TRIM(f.produto_id), '')
          OR (NULLIF(TRIM(f.produto_id), '') IS NULL AND pr.ean = f.ean)
        WHERE f.ativo = 1
          AND DATE(f.semana_inicio) = DATE(?)
          AND DATE(f.semana_fim) = DATE(?)
      ),
      metas AS (
        SELECT
          f.*,
          co.id consultor_id,
          co.nome consultor,
          COALESCE((
            SELECT MIN(NULLIF(TRIM(clx.setor_rep), ''))
            FROM clientes clx
            WHERE clx.consultor_id = co.id
              AND clx.carteira_importada = 1
              AND clx.ativo = 1
          ), '') setor,
          COALESCE(fx.meta_quantidade, 0) meta_quantidade
        FROM focos f
        JOIN foco_consultores fx
          ON fx.foco_id = f.foco_id
         AND fx.ativo = 1
         AND COALESCE(fx.meta_quantidade, 0) > 0
        JOIN consultores co
          ON co.id = fx.consultor_id
         AND co.ativo = 1
         AND co.origem = 'PAINEL_EQUIPE'
        WHERE (? = '' OR co.id = ?)
          AND (? = '' OR EXISTS (
            SELECT 1
            FROM clientes cu
            WHERE cu.consultor_id = co.id
              AND cu.carteira_importada = 1
              AND cu.ativo = 1
              AND UPPER(TRIM(COALESCE(cu.uf, ''))) = ?
          ))
      ),
      vendas AS (
        SELECT
          COALESCE(NULLIF(TRIM(pe.consultor_id), ''), cl.consultor_id) consultor_id,
          cl.id cliente_id,
          COALESCE(NULLIF(TRIM(ip.produto_id), ''), pr.id, '') produto_id,
          COALESCE(NULLIF(TRIM(ip.ean), ''), pr.ean, '') ean,
          pe.id pedido_id,
          COALESCE(ip.quantidade_faturada, 0) quantidade_faturada,
          COALESCE(ip.valor_faturado, 0) faturamento
        FROM itens_pedido ip
        JOIN pedidos pe ON pe.id = ip.pedido_id
        LEFT JOIN produtos pr ON pr.id = ip.produto_id
        JOIN clientes cl
          ON cl.id = pe.cliente_id
         AND cl.carteira_importada = 1
         AND cl.ativo = 1
        WHERE ${ITEM_FATURADO}
          AND DATE(COALESCE(NULLIF(TRIM(pe.data_faturamento), ''), NULLIF(TRIM(pe.data_pedido), ''))) BETWEEN DATE(?) AND DATE(?)
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
        COUNT(DISTINCT CASE WHEN v.quantidade_faturada > 0 THEN v.cliente_id END) cnpj_positivados,
        COUNT(DISTINCT CASE WHEN v.quantidade_faturada > 0 THEN v.pedido_id END) pedidos,
        COALESCE(SUM(v.quantidade_faturada), 0) realizado_quantidade,
        COALESCE(SUM(v.faturamento), 0) faturamento
      FROM metas m
      LEFT JOIN vendas v
        ON v.consultor_id = m.consultor_id
       AND (
         (m.produto_id <> '' AND v.produto_id = m.produto_id)
         OR (
           m.ean <> ''
           AND REPLACE(REPLACE(REPLACE(TRIM(v.ean), '.0', ''), ' ', ''), '-', '') =
               REPLACE(REPLACE(REPLACE(TRIM(m.ean), '.0', ''), ' ', ''), '-', '')
         )
       )
      GROUP BY m.foco_id, m.consultor_id
      ORDER BY m.descricao COLLATE NOCASE, m.setor, m.consultor COLLATE NOCASE
    `

    const consultoresSql = `
      SELECT
        co.id,
        co.nome,
        COALESCE((
          SELECT MIN(NULLIF(TRIM(cl.setor_rep), ''))
          FROM clientes cl
          WHERE cl.consultor_id = co.id
            AND cl.carteira_importada = 1
            AND cl.ativo = 1
        ), '') setor
      FROM consultores co
      WHERE co.ativo = 1 AND co.origem = 'PAINEL_EQUIPE'
      ORDER BY setor, co.nome COLLATE NOCASE
    `

    const produtosSql = `
      SELECT id, ean, descricao, COALESCE(laboratorio, '') laboratorio
      FROM produtos
      WHERE ativo = 1
        AND TRIM(COALESCE(ean, '')) <> ''
        AND TRIM(COALESCE(descricao, '')) <> ''
      ORDER BY descricao COLLATE NOCASE, ean
      LIMIT 2000
    `

    const [resultado, consultores, ufs, produtos] = await env.DB.batch([
      env.DB.prepare(sql).bind(inicio, fim, consultor, consultor, uf, uf, inicio, fim, uf, uf),
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
      return json({ periodo: semanaAtual(), linhas: [], filtros: { consultores: [], ufs: [], produtos: [] }, aviso: 'A atualização do Foco Semanal ainda não foi aplicada no banco.' })
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
    const metas = (Array.isArray(body.consultores) ? body.consultores : [])
      .map(item => ({ id: texto(item?.id), meta_quantidade: Math.max(0, numero(item?.meta_quantidade)) }))
      .filter(item => item.id && item.meta_quantidade > 0)

    if (!dataValida(inicio) || !dataValida(fim) || inicio > fim || (!produtoIdInformado && !eanInformado) || !metas.length) {
      return json({ erro: 'Informe o período, selecione um produto e cadastre a meta de ao menos um consultor.' }, 400)
    }

    let produto = null
    if (produtoIdInformado) produto = await env.DB.prepare('SELECT id,ean,descricao FROM produtos WHERE id=? AND ativo=1 LIMIT 1').bind(produtoIdInformado).first()
    if (!produto && eanInformado) produto = await env.DB.prepare('SELECT id,ean,descricao FROM produtos WHERE ean=? AND ativo=1 LIMIT 1').bind(eanInformado).first()
    if (!produto) return json({ erro: 'Selecione um produto válido da lista.' }, 400)

    const produtoId = texto(produto.id)
    const ean = digitos(produto.ean)
    const descricao = texto(produto.descricao)
    let id = texto(body.id)

    if (!id) {
      const existente = await env.DB.prepare(`
        SELECT id FROM foco_semanal
        WHERE semana_inicio=? AND semana_fim=? AND ativo=1
          AND (produto_id=? OR ean=?)
        LIMIT 1
      `).bind(inicio, fim, produtoId, ean).first()
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
    `).bind(id, inicio, fim, produtoId, ean, descricao, 0, 0, texto(body.observacoes), agora, agora).run()

    const comandos = [env.DB.prepare('UPDATE foco_consultores SET ativo=0 WHERE foco_id=?').bind(id)]
    for (const meta of metas) {
      comandos.push(env.DB.prepare(`
        INSERT INTO foco_consultores(foco_id,consultor_id,ativo,meta_quantidade,meta_valor)
        VALUES(?,?,1,?,0)
        ON CONFLICT(foco_id,consultor_id) DO UPDATE SET
          ativo=1,
          meta_quantidade=excluded.meta_quantidade,
          meta_valor=0
      `).bind(id, meta.id, meta.meta_quantidade))
    }
    await env.DB.batch(comandos)

    return json({ sucesso: true, id, consultores: metas.length, produto: { id: produtoId, ean, descricao }, periodo: { inicio, fim } })
  } catch (error) {
    return json({ erro: 'Não foi possível salvar o foco.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
