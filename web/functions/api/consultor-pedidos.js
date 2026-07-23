import {
  ITEM_FATURADO,
  ITEM_ATIVO,
  PEDIDO_NAO_FATURADO,
  VALOR_ITEM_NAO_FATURADO,
} from '../_lib/commercial.js'

const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
}
const PERIODOS = new Set(['mes-atual', 'mes-anterior', 'todo-periodo', 'personalizado'])
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const mostrar = (value) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : ''
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const texto = (value) => String(value ?? '').trim()

function periodo(params) {
  const tipo = PERIODOS.has(params.get('periodo')) ? params.get('periodo') : 'mes-atual'
  if (tipo === 'todo-periodo') return { tipo, inicio: null, fim: null }

  const inicio = params.get('inicio') || ''
  const fim = params.get('fim') || ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(inicio) && /^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    if (inicio > fim) throw new Error('A data inicial não pode ser posterior à data final.')
    return { tipo, inicio, fim }
  }
  if (tipo === 'personalizado') throw new Error('Informe uma data inicial e uma data final válidas.')

  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  let ano = Number(partes.year)
  let mes = Number(partes.month)
  if (tipo === 'mes-anterior') {
    mes -= 1
    if (!mes) { mes = 12; ano -= 1 }
  }
  return { tipo, inicio: iso(ano, mes, 1), fim: iso(ano, mes, new Date(Date.UTC(ano, mes, 0)).getUTCDate()) }
}

function filtros(params, consultor, status) {
  const faixa = periodo(params)
  const uf = texto(params.get('uf')).toUpperCase().slice(0, 2)
  const condicoes = [
    status === 'faturado' ? ITEM_FATURADO : PEDIDO_NAO_FATURADO,
    ...(status === 'faturado' ? [] : [ITEM_ATIVO]),
    'cl.consultor_id=?',
    'cl.carteira_importada=1',
    'cl.ativo=1',
  ]
  const valores = [consultor]

  if (faixa.inicio && faixa.fim) {
    condicoes.push(status === 'faturado'
      ? 'DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)'
      : 'DATE(pe.data_pedido) BETWEEN DATE(?) AND DATE(?)')
    valores.push(faixa.inicio, faixa.fim)
  }
  if (uf) {
    condicoes.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?")
    valores.push(uf)
  }

  return { faixa, uf, where: condicoes.join(' AND '), valores }
}

function normalizarPedido(item, tipo) {
  const nota = texto(item.nota_fiscal)
  return {
    id: texto(item.id),
    tipo,
    pedido: texto(item.pedido_origem),
    nota_fiscal: /^(?:0|-)+$/.test(nota) ? '' : nota,
    status: texto(item.status),
    data_pedido: texto(item.data_pedido),
    data_faturamento: texto(item.data_faturamento),
    cnpj: texto(item.cnpj),
    cliente: texto(item.cliente),
    cidade: texto(item.cidade),
    uf: texto(item.uf),
    centro_distribuicao: texto(item.centro_distribuicao),
    uf_centro_distribuicao: texto(item.uf_centro_distribuicao),
    itens: numero(item.itens),
    quantidade_solicitada: numero(item.quantidade_solicitada),
    quantidade_atendida: numero(item.quantidade_atendida),
    quantidade_faturada: numero(item.quantidade_faturada),
    valor_solicitado_sem_imposto: numero(item.valor_solicitado_sem_imposto),
    valor_atendido_sem_imposto: numero(item.valor_atendido_sem_imposto),
    valor_faturado: numero(item.valor_faturado),
    valor_considerado: numero(item.valor_considerado),
  }
}

const SELECT_BASE = `
  SELECT pe.id,pe.pedido_origem,pe.nota_fiscal,pe.status,pe.data_pedido,pe.data_faturamento,
         pe.centro_distribuicao,pe.uf_centro_distribuicao,
         cl.cnpj,COALESCE(NULLIF(TRIM(cl.nome_fantasia),''),NULLIF(TRIM(cl.razao_social),''),'Cliente sem nome') cliente,
         cl.cidade,cl.uf,
         COUNT(DISTINCT ip.id) itens,
         COALESCE(SUM(ip.quantidade_solicitada),0) quantidade_solicitada,
         COALESCE(SUM(ip.quantidade_atendida),0) quantidade_atendida,
         COALESCE(SUM(ip.quantidade_faturada),0) quantidade_faturada,
         COALESCE(SUM(ip.valor_total_solicitado_sem_imposto),0) valor_solicitado_sem_imposto,
         COALESCE(SUM(ip.total_atendido_sem_imposto),0) valor_atendido_sem_imposto,
         COALESCE(SUM(ip.valor_faturado),0) valor_faturado`
const JOINS = `
    FROM itens_pedido ip
    JOIN pedidos pe ON pe.id=ip.pedido_id
    JOIN clientes cl ON cl.id=pe.cliente_id`
const GROUP_ORDER = `
   GROUP BY pe.id,pe.pedido_origem,pe.nota_fiscal,pe.status,pe.data_pedido,pe.data_faturamento,
            pe.centro_distribuicao,pe.uf_centro_distribuicao,
            cl.cnpj,cl.nome_fantasia,cl.razao_social,cl.cidade,cl.uf
   ORDER BY DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) DESC,pe.pedido_origem DESC`

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const consultor = texto(params.get('consultor')).slice(0, 180)
    if (!consultor) return json({ erro: 'Informe o consultor.' }, 400)

    const faturado = filtros(params, consultor, 'faturado')
    const pendente = filtros(params, consultor, 'pendente')
    const consultorStmt = env.DB.prepare(`
      SELECT c.id,c.nome,MIN(NULLIF(TRIM(cl.setor_rep),'')) setor
        FROM consultores c
        LEFT JOIN clientes cl ON cl.consultor_id=c.id AND cl.carteira_importada=1 AND cl.ativo=1
       WHERE c.id=? AND c.ativo=1
       GROUP BY c.id,c.nome
    `).bind(consultor)
    const faturadosStmt = env.DB.prepare(`${SELECT_BASE},
         COALESCE(SUM(ip.valor_faturado),0) valor_considerado
         ${JOINS}
        WHERE ${faturado.where}
        ${GROUP_ORDER}`).bind(...faturado.valores)
    const pendentesStmt = env.DB.prepare(`${SELECT_BASE},
         COALESCE(SUM(${VALOR_ITEM_NAO_FATURADO}),0) valor_considerado
         ${JOINS}
        WHERE ${pendente.where}
        ${GROUP_ORDER}`).bind(...pendente.valores)

    const [consultorResult, faturadosResult, pendentesResult] = await env.DB.batch([
      consultorStmt, faturadosStmt, pendentesStmt,
    ])
    const cadastro = consultorResult.results?.[0]
    if (!cadastro) return json({ erro: 'Consultor não encontrado.' }, 404)

    const faturados = (faturadosResult.results || []).map((item) => normalizarPedido(item, 'FATURADO'))
    const naoFaturados = (pendentesResult.results || []).map((item) => normalizarPedido(item, 'NAO_FATURADO'))
    const somar = (lista, campo) => lista.reduce((total, item) => total + numero(item[campo]), 0)

    return json({
      consultor: {
        id: texto(cadastro.id),
        nome: texto(cadastro.nome),
        setor: texto(cadastro.setor),
      },
      periodo: {
        tipo: faturado.faixa.tipo,
        inicio: faturado.faixa.inicio,
        fim: faturado.faixa.fim,
        rotulo: faturado.faixa.inicio
          ? `${mostrar(faturado.faixa.inicio)} a ${mostrar(faturado.faixa.fim)}`
          : 'Todo o período extraído',
        uf: faturado.uf,
      },
      resumo: {
        pedidos_faturados: faturados.length,
        valor_faturado: somar(faturados, 'valor_faturado'),
        pedidos_nao_faturados: naoFaturados.length,
        valor_nao_faturado: somar(naoFaturados, 'valor_considerado'),
      },
      faturados,
      nao_faturados: naoFaturados,
      regra: 'Faturados usam valor_faturado. Atendido e Atendido parcial usam total_atendido_sem_imposto. Enviado usa valor_total_solicitado_sem_imposto.',
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    const status = detalhe.includes('data inicial') || detalhe.includes('data final') ? 400 : 500
    return json({ erro: 'Não foi possível carregar os pedidos do consultor.', detalhe }, status)
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const consultor = texto(params.get('consultor')).slice(0, 180)
    const pedidoId = texto(params.get('pedido')).slice(0, 180)
    if (!consultor || !pedidoId) return json({ erro: 'Informe o consultor e o pedido.' }, 400)

    const pedido = await env.DB.prepare(`
      SELECT pe.id,pe.pedido_origem,pe.status
        FROM pedidos pe
        JOIN clientes cl ON cl.id=pe.cliente_id
       WHERE pe.id=? AND cl.consultor_id=? AND ${PEDIDO_NAO_FATURADO}
    `).bind(pedidoId, consultor).first()
    if (!pedido) return json({ erro: 'Pedido não encontrado ou não pode ser excluído.' }, 404)

    const agora = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare('UPDATE itens_pedido SET ativo=0 WHERE pedido_id=?').bind(pedidoId),
      env.DB.prepare(`
        UPDATE pedidos
           SET ativo=0,excluido_manual=1,atualizado_em=?
         WHERE id=?
      `).bind(agora, pedidoId),
    ])

    return json({
      sucesso: true,
      mensagem: `Pedido ${texto(pedido.pedido_origem) || pedidoId} excluído.`,
      pedido: pedidoId,
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    return json({ erro: 'Não foi possível excluir o pedido.', detalhe }, 500)
  }
}
