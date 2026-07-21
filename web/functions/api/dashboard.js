import { ITEM_FATURADO, MIX_SEM_COMBATE } from '../_lib/commercial.js'

const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
}
const PERIODOS = new Set(['mes-atual', 'mes-anterior', 'todo-periodo', 'personalizado'])
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const stmt = (env, sql, params = []) => params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql)
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const mostrar = (v) => v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : ''
const numero = (v) => Number.isFinite(Number(v)) ? Number(v) : 0
const percentual = (valor, meta) => numero(meta) > 0 ? (numero(valor) / numero(meta)) * 100 : 0

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
  }).formatToParts(new Date()).map((p) => [p.type, p.value]))
  let ano = Number(partes.year)
  let mes = Number(partes.month)
  if (tipo === 'mes-anterior') {
    mes -= 1
    if (!mes) { mes = 12; ano -= 1 }
  }
  return { tipo, inicio: iso(ano, mes, 1), fim: iso(ano, mes, new Date(Date.UTC(ano, mes, 0)).getUTCDate()) }
}

function filtros(params) {
  const faixa = periodo(params)
  const consultor = String(params.get('consultor') || '').trim().slice(0, 180)
  const uf = String(params.get('uf') || '').trim().toUpperCase().slice(0, 2)
  const cond = [ITEM_FATURADO]
  const valores = []

  if (faixa.inicio && faixa.fim) {
    cond.push('DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)')
    valores.push(faixa.inicio, faixa.fim)
  }
  if (consultor || uf) cond.push('cl.carteira_importada=1')
  if (consultor) { cond.push('cl.consultor_id=?'); valores.push(consultor) }
  if (uf) { cond.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?"); valores.push(uf) }

  const condClientesVenda = [ITEM_FATURADO, 'cl.carteira_importada=1', 'cl.ativo=1', 'ip.valor_faturado>0']
  const valoresClientesVenda = []
  if (faixa.inicio && faixa.fim) {
    condClientesVenda.push('DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?)')
    valoresClientesVenda.push(faixa.inicio, faixa.fim)
  }
  if (consultor) { condClientesVenda.push('cl.consultor_id=?'); valoresClientesVenda.push(consultor) }
  if (uf) { condClientesVenda.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?"); valoresClientesVenda.push(uf) }

  const condClientes = ['cl.carteira_importada=1', 'cl.ativo=1']
  const valoresClientes = []
  if (consultor) { condClientes.push('cl.consultor_id=?'); valoresClientes.push(consultor) }
  if (uf) { condClientes.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?"); valoresClientes.push(uf) }

  return {
    ...faixa, consultor, uf, where: cond.join(' AND '), valores,
    clientSaleWhere: condClientesVenda.join(' AND '), clientSaleValues: valoresClientesVenda,
    clientWhere: condClientes.join(' AND '), clientValues: valoresClientes,
    rotulo: faixa.inicio ? `${mostrar(faixa.inicio)} a ${mostrar(faixa.fim)}` : 'Todo o período extraído',
  }
}

function pascoa(ano) {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(ano, mes - 1, dia))
}

function adicionarDias(data, dias) {
  const nova = new Date(data)
  nova.setUTCDate(nova.getUTCDate() + dias)
  return nova
}

function chaveData(data) {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}-${String(data.getUTCDate()).padStart(2, '0')}`
}

function feriadosComerciais(ano) {
  const fixos = ['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25']
  const datas = new Set(fixos.map((item) => `${ano}-${item}`))
  const domingoPascoa = pascoa(ano)
  ;[-48, -47, -2, 60].forEach((dias) => datas.add(chaveData(adicionarDias(domingoPascoa, dias))))
  return datas
}

function diasUteis(inicio, fim, limite = fim) {
  if (!inicio || !fim) return 0
  const dataInicio = new Date(`${inicio}T12:00:00Z`)
  const dataFim = new Date(`${fim}T12:00:00Z`)
  const dataLimite = new Date(`${limite}T12:00:00Z`)
  const final = dataLimite < dataFim ? dataLimite : dataFim
  const feriadosPorAno = new Map()
  let total = 0
  for (let atual = new Date(dataInicio); atual <= final; atual.setUTCDate(atual.getUTCDate() + 1)) {
    const diaSemana = atual.getUTCDay()
    if (diaSemana === 0 || diaSemana === 6) continue
    const ano = atual.getUTCFullYear()
    if (!feriadosPorAno.has(ano)) feriadosPorAno.set(ano, feriadosComerciais(ano))
    if (!feriadosPorAno.get(ano).has(chaveData(atual))) total += 1
  }
  return total
}

function hojeSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function montarProjecao(filtro, valores) {
  const hoje = hojeSaoPaulo()
  const ativo = filtro.tipo === 'mes-atual' && filtro.inicio && filtro.fim && hoje >= filtro.inicio && hoje <= filtro.fim
  const totalDias = filtro.inicio && filtro.fim ? diasUteis(filtro.inicio, filtro.fim) : 0
  const decorridos = ativo ? diasUteis(filtro.inicio, filtro.fim, hoje) : totalDias
  const fator = ativo && decorridos > 0 ? totalDias / decorridos : 1
  const projetar = (valor) => numero(valor) * fator
  return {
    ativa: Boolean(ativo),
    dias_uteis_decorridos: decorridos,
    dias_uteis_total: totalDias,
    fator,
    ol_sem_combate: projetar(valores.ol_sem_combate),
    ol_prioritarios: projetar(valores.ol_prioritarios),
    ol_lancamentos: projetar(valores.ol_lancamentos),
  }
}

function consultaMeta(env, filtro) {
  const cond = []
  const binds = []
  if (filtro.inicio && filtro.fim) {
    cond.push('ano_mes BETWEEN ? AND ?')
    binds.push(filtro.inicio.slice(0, 7), filtro.fim.slice(0, 7))
  }
  if (filtro.consultor) {
    cond.push("escopo='consultor'", 'consultor_id=?')
    binds.push(filtro.consultor)
  } else if (filtro.uf) {
    cond.push("escopo='consultor'")
    cond.push("consultor_id IN (SELECT DISTINCT consultor_id FROM clientes WHERE carteira_importada=1 AND ativo=1 AND UPPER(TRIM(COALESCE(uf,'')))=?)")
    binds.push(filtro.uf)
  } else {
    cond.push("escopo='gerente'")
  }
  return stmt(env, `
    SELECT COALESCE(SUM(ol_sem_combate),0) ol_sem_combate,
           COALESCE(SUM(ol_prioritarios),0) ol_prioritarios,
           COALESCE(SUM(ol_lancamentos),0) ol_lancamentos,
           COALESCE(SUM(clientes_positivados),0) clientes_positivados
      FROM metas WHERE ${cond.length ? cond.join(' AND ') : '1=1'}
  `, binds)
}

const JOINS = 'FROM itens_pedido ip JOIN pedidos pe ON pe.id=ip.pedido_id LEFT JOIN clientes cl ON cl.id=pe.cliente_id LEFT JOIN produtos pr ON pr.id=ip.produto_id'

export async function onRequestGet({ request, env }) {
  try {
    const filtro = filtros(new URL(request.url).searchParams)
    const consultas = [
      stmt(env, `SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${filtro.where} AND ${MIX_SEM_COMBATE}`, filtro.valores),
      stmt(env, `SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${filtro.where} AND UPPER(COALESCE(pr.tipo_mix,''))='PRIORITARIO'`, filtro.valores),
      stmt(env, `SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${filtro.where} AND UPPER(COALESCE(pr.tipo_mix,''))='LANCAMENTO'`, filtro.valores),
      stmt(env, `SELECT COUNT(DISTINCT pe.cliente_id) total ${JOINS} WHERE ${filtro.clientSaleWhere}`, filtro.clientSaleValues),
      stmt(env, `SELECT COUNT(*) total FROM clientes cl WHERE ${filtro.clientWhere}`, filtro.clientValues),
      stmt(env, "SELECT COUNT(*) total FROM consultores WHERE ativo=1 AND origem='PAINEL_EQUIPE'"),
      stmt(env, `SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${filtro.where}`, filtro.valores),
      stmt(env, "SELECT COUNT(*) total FROM extracoes WHERE status='executando'"),
      stmt(env, "SELECT id,nome FROM consultores WHERE ativo=1 AND origem='PAINEL_EQUIPE' AND TRIM(nome)<>'' ORDER BY nome COLLATE NOCASE"),
      stmt(env, "SELECT DISTINCT UPPER(TRIM(uf)) uf FROM clientes WHERE carteira_importada=1 AND ativo=1 AND LENGTH(TRIM(COALESCE(uf,'')))=2 ORDER BY uf"),
      stmt(env, "SELECT (SELECT COUNT(*) FROM clientes WHERE carteira_importada=1) clientes_carteira,(SELECT COUNT(*) FROM produtos WHERE UPPER(COALESCE(tipo_mix,''))<>'SEM CLASSIFICACAO') produtos_mix,(SELECT COUNT(*) FROM produtos WHERE mercado_farma_ativo=1) produtos_mercado_farma,(SELECT COUNT(*) FROM metas WHERE escopo='consultor') metas"),
      stmt(env, `SELECT COUNT(DISTINCT pe.id) pedidos,COUNT(ip.id) itens,COALESCE(SUM(ip.valor_faturado),0) valor_total,MIN(COALESCE(pe.data_faturamento,pe.data_pedido)) data_min,MAX(COALESCE(pe.data_faturamento,pe.data_pedido)) data_max ${JOINS} WHERE ${ITEM_FATURADO}`),
      stmt(env, `SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${filtro.where} AND UPPER(TRIM(COALESCE(pr.tipo_mix,'')))='COMBATE'`, filtro.valores),
      stmt(env, `SELECT COUNT(DISTINCT pe.id) total ${JOINS} WHERE ${filtro.where}`, filtro.valores),
      stmt(env, "SELECT finalizado_em FROM extracoes WHERE tipo='BUSSOLA' AND status='concluido' AND finalizado_em IS NOT NULL ORDER BY finalizado_em DESC LIMIT 1"),
      consultaMeta(env, filtro),
    ]

    const resultados = await env.DB.batch(consultas)
    const ativos = numero(resultados[4]?.results?.[0]?.total)
    const comVenda = numero(resultados[3]?.results?.[0]?.total)
    const faturamento = numero(resultados[6]?.results?.[0]?.total)
    const pedidos = numero(resultados[13]?.results?.[0]?.total)
    const semCombate = numero(resultados[0]?.results?.[0]?.total)
    const prioritarios = numero(resultados[1]?.results?.[0]?.total)
    const lancamentos = numero(resultados[2]?.results?.[0]?.total)
    const base = resultados[10]?.results?.[0] || {}
    const diagnostico = resultados[11]?.results?.[0] || {}
    const meta = resultados[15]?.results?.[0] || {}
    const metas = {
      ol_sem_combate: numero(meta.ol_sem_combate),
      ol_prioritarios: numero(meta.ol_prioritarios),
      ol_lancamentos: numero(meta.ol_lancamentos),
      clientes_positivados: numero(meta.clientes_positivados),
    }
    const projecao = montarProjecao(filtro, { ol_sem_combate: semCombate, ol_prioritarios: prioritarios, ol_lancamentos: lancamentos })

    return json({
      ol_sem_combate: semCombate,
      ol_combate: numero(resultados[12]?.results?.[0]?.total),
      ol_prioritarios: prioritarios,
      ol_lancamentos: lancamentos,
      meta_ol_sem_combate: metas.ol_sem_combate,
      meta_ol_prioritarios: metas.ol_prioritarios,
      meta_ol_lancamentos: metas.ol_lancamentos,
      resultado_ol_sem_combate: percentual(semCombate, metas.ol_sem_combate),
      resultado_ol_prioritarios: percentual(prioritarios, metas.ol_prioritarios),
      resultado_ol_lancamentos: percentual(lancamentos, metas.ol_lancamentos),
      projecao: {
        ...projecao,
        resultado_ol_sem_combate: percentual(projecao.ol_sem_combate, metas.ol_sem_combate),
        resultado_ol_prioritarios: percentual(projecao.ol_prioritarios, metas.ol_prioritarios),
        resultado_ol_lancamentos: percentual(projecao.ol_lancamentos, metas.ol_lancamentos),
      },
      clientes_com_venda: comVenda,
      clientes_sem_venda: Math.max(0, ativos - comVenda),
      clientes_ativos: ativos,
      consultores_ativos: numero(resultados[5]?.results?.[0]?.total),
      ol_total_faturado: faturamento,
      vendas_faturadas: pedidos,
      pedidos_faturados: pedidos,
      ticket_medio_cliente: comVenda > 0 ? faturamento / comVenda : 0,
      ticket_medio_pedido: pedidos > 0 ? faturamento / pedidos : 0,
      percentual_positivacao: ativos > 0 ? (comVenda / ativos) * 100 : 0,
      automacoes_executando: numero(resultados[7]?.results?.[0]?.total),
      bases: {
        painel_equipe_norte: numero(base.clientes_carteira),
        produtos_mix: numero(base.produtos_mix),
        produtos_mercado_farma: numero(base.produtos_mercado_farma),
        metas: numero(base.metas),
      },
      diagnostico: {
        pedidos_faturados: numero(diagnostico.pedidos),
        itens_faturados: numero(diagnostico.itens),
        valor_faturado_total: numero(diagnostico.valor_total),
        primeira_data: diagnostico.data_min || null,
        ultima_data: diagnostico.data_max || null,
      },
      filtros: {
        consultores: (resultados[8]?.results || []).map((item) => ({ id: String(item.id || ''), nome: String(item.nome || '') })).filter((item) => item.id && item.nome),
        ufs: (resultados[9]?.results || []).map((item) => String(item.uf || '')).filter(Boolean),
        aplicado: { periodo: filtro.tipo, inicio: filtro.inicio, fim: filtro.fim, consultor: filtro.consultor, uf: filtro.uf, rotulo: filtro.rotulo },
      },
      regra_calculo: {
        valor: 'itens_pedido.valor_faturado (coluna AA do Bússola)',
        data: 'data_faturamento; data_pedido apenas como fallback',
        carteira: 'Painel Equipe Norte por CNPJ para filtros de consultor e UF',
        projecao: 'Dias úteis, excluindo sábados, domingos e feriados comerciais nacionais.',
      },
      atualizado_em: resultados[14]?.results?.[0]?.finalizado_em || null,
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    return json({ erro: 'Não foi possível carregar os indicadores.', detalhe }, detalhe.includes('data inicial') || detalhe.includes('data final') ? 400 : 500)
  }
}
