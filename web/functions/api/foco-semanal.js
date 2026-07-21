import { authorized, json } from '../_lib/credentials.js'

const texto = (valor) => String(valor ?? '').trim()
const numero = (valor) => Number.isFinite(Number(valor)) ? Number(valor) : 0
const dataValida = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(texto(valor))

async function exigirAdmin(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return json({ erro: 'Chave administrativa não configurada.' }, 503)
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Chave administrativa inválida.' }, 401)
  }
  return null
}

function semanaAtual() {
  const agora = new Date()
  const dia = agora.getDay()
  const segunda = new Date(agora)
  segunda.setDate(agora.getDate() - ((dia + 6) % 7))
  const domingo = new Date(segunda)
  domingo.setDate(segunda.getDate() + 6)
  const iso = (data) => `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
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

    const condicoesFoco = [
      'f.ativo=1',
      'DATE(f.semana_inicio)<=DATE(?)',
      'DATE(f.semana_fim)>=DATE(?)',
    ]
    const binds = [
      consultor, consultor, uf, uf,
      consultor, consultor, uf, uf,
      fim, inicio,
    ]

    if (consultor) {
      condicoesFoco.push(`(
        NOT EXISTS(SELECT 1 FROM foco_consultores fx WHERE fx.foco_id=f.id AND fx.ativo=1)
        OR EXISTS(SELECT 1 FROM foco_consultores fx WHERE fx.foco_id=f.id AND fx.consultor_id=? AND fx.ativo=1)
      )`)
      binds.push(consultor)
    }

    const sql = `
      WITH vendas AS (
        SELECT
          COALESCE(NULLIF(ip.ean,''),pr.ean,'') ean,
          pe.cliente_id,
          pe.id pedido_id,
          COALESCE(ip.quantidade_faturada,0) quantidade_faturada,
          COALESCE(ip.valor_faturado,0) valor_faturado,
          DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) data_venda
        FROM itens_pedido ip
        JOIN pedidos pe ON pe.id=ip.pedido_id
        LEFT JOIN produtos pr ON pr.id=ip.produto_id
        JOIN clientes cl ON cl.id=pe.cliente_id AND cl.carteira_importada=1 AND cl.ativo=1
        WHERE ip.ativo=1
          AND pe.ativo=1
          AND UPPER(TRIM(COALESCE(pe.status,''))) IN ('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO')
          AND (?='' OR cl.consultor_id=?)
          AND (?='' OR UPPER(TRIM(COALESCE(cl.uf,'')))=?)
      ), carteira AS (
        SELECT cl.id
        FROM clientes cl
        WHERE cl.carteira_importada=1 AND cl.ativo=1
          AND (?='' OR cl.consultor_id=?)
          AND (?='' OR UPPER(TRIM(COALESCE(cl.uf,'')))=?)
      )
      SELECT
        f.id,f.semana_inicio,f.semana_fim,
        COALESCE(NULLIF(f.ean,''),pr.ean,'') ean,
        COALESCE(NULLIF(f.descricao,''),pr.descricao,'Produto foco') descricao,
        f.meta_clientes,f.meta_valor,COALESCE(f.observacoes,'') observacoes,
        COUNT(DISTINCT CASE WHEN v.valor_faturado>0 THEN v.cliente_id END) clientes_compraram,
        COUNT(DISTINCT v.pedido_id) pedidos,
        COALESCE(SUM(v.quantidade_faturada),0) quantidade,
        COALESCE(SUM(v.valor_faturado),0) valor_faturado,
        (
          SELECT COUNT(*) FROM carteira c
          WHERE
            NOT EXISTS(SELECT 1 FROM foco_clientes fc WHERE fc.foco_id=f.id AND fc.ativo=1)
            OR EXISTS(SELECT 1 FROM foco_clientes fc WHERE fc.foco_id=f.id AND fc.cliente_id=c.id AND fc.ativo=1)
        ) clientes_alvo
      FROM foco_semanal f
      LEFT JOIN produtos pr ON pr.id=f.produto_id
      LEFT JOIN vendas v
        ON v.ean=COALESCE(NULLIF(f.ean,''),pr.ean,'')
       AND v.data_venda BETWEEN DATE(f.semana_inicio) AND DATE(f.semana_fim)
      WHERE ${condicoesFoco.join(' AND ')}
      GROUP BY f.id
      ORDER BY f.semana_inicio DESC,f.descricao COLLATE NOCASE
    `

    const [resultado, consultores, ufs] = await env.DB.batch([
      env.DB.prepare(sql).bind(...binds),
      env.DB.prepare("SELECT id,nome FROM consultores WHERE ativo=1 AND origem='PAINEL_EQUIPE' ORDER BY nome COLLATE NOCASE"),
      env.DB.prepare("SELECT DISTINCT UPPER(TRIM(uf)) uf FROM clientes WHERE carteira_importada=1 AND ativo=1 AND LENGTH(TRIM(COALESCE(uf,'')))=2 ORDER BY uf"),
    ])

    const focos = (resultado.results || []).map((item) => {
      const alvo = numero(item.clientes_alvo)
      const compraram = numero(item.clientes_compraram)
      const valor = numero(item.valor_faturado)
      const meta = numero(item.meta_valor)
      return {
        ...item,
        meta_clientes: numero(item.meta_clientes),
        meta_valor: meta,
        clientes_alvo: alvo,
        clientes_compraram: compraram,
        clientes_sem_comprar: Math.max(0, alvo - compraram),
        cobertura_percentual: alvo > 0 ? (compraram / alvo) * 100 : 0,
        pedidos: numero(item.pedidos),
        quantidade: numero(item.quantidade),
        valor_faturado: valor,
        resultado_meta_valor: meta > 0 ? (valor / meta) * 100 : 0,
      }
    })

    return json({
      periodo: { inicio, fim },
      focos,
      filtros: {
        consultores: consultores.results || [],
        ufs: (ufs.results || []).map((item) => String(item.uf || '')).filter(Boolean),
      },
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table') || detalhe.includes('no such column')) {
      return json({
        periodo: semanaAtual(),
        focos: [],
        filtros: { consultores: [], ufs: [] },
        aviso: 'A migração do Foco Semanal ainda não foi aplicada.',
      })
    }
    return json({ erro: 'Não foi possível carregar o Foco Semanal.', detalhe }, 500)
  }
}

export async function onRequestPost({ request, env }) {
  const negado = await exigirAdmin(request, env)
  if (negado) return negado
  try {
    const body = await request.json()
    const acao = texto(body.acao || 'salvar')
    if (acao === 'excluir') {
      const id = texto(body.id)
      await env.DB.prepare('UPDATE foco_semanal SET ativo=0,atualizado_em=? WHERE id=?')
        .bind(new Date().toISOString(), id).run()
      return json({ sucesso: true, id })
    }

    const inicio = texto(body.semana_inicio)
    const fim = texto(body.semana_fim)
    const ean = texto(body.ean).replace(/\D/g, '')
    const descricao = texto(body.descricao)
    if (!dataValida(inicio) || !dataValida(fim) || inicio > fim || !ean) {
      return json({ erro: 'Informe período e EAN válidos.' }, 400)
    }

    const id = texto(body.id) || `foco-${crypto.randomUUID()}`
    const agora = new Date().toISOString()
    await env.DB.prepare(`
      INSERT INTO foco_semanal(
        id,semana_inicio,semana_fim,ean,descricao,meta_clientes,meta_valor,
        observacoes,criado_por,ativo,criado_em,atualizado_em
      ) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET
        semana_inicio=excluded.semana_inicio,semana_fim=excluded.semana_fim,
        ean=excluded.ean,descricao=excluded.descricao,meta_clientes=excluded.meta_clientes,
        meta_valor=excluded.meta_valor,observacoes=excluded.observacoes,
        ativo=1,atualizado_em=excluded.atualizado_em
    `).bind(
      id,inicio,fim,ean,descricao || `Produto ${ean}`,numero(body.meta_clientes),
      numero(body.meta_valor),texto(body.observacoes),texto(body.criado_por) || 'Painel',agora,agora,
    ).run()
    return json({ sucesso: true, id })
  } catch (error) {
    return json({ erro: 'Não foi possível salvar o foco.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
