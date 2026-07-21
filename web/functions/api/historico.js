const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store,no-cache,must-revalidate',
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })
const texto = (value) => String(value ?? '').trim()
const numero = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const chave = (escopo, referencia) => `${escopo}|${referencia}`

function resultadoImportado(grupo, clientesAtivos) {
  const clientesComVenda = grupo.clientesComVenda.size
  const olTotal = Number(grupo.olTotal.toFixed(2))
  return {
    origem: 'IMPORTADO',
    mix_disponivel: false,
    ol_total: olTotal,
    ol_sem_combate: 0,
    ol_combate: 0,
    ol_prioritarios: 0,
    ol_lancamentos: 0,
    pedidos: grupo.pedidos,
    produtos: grupo.produtos,
    quantidade: grupo.quantidade,
    clientes_ativos: clientesAtivos,
    clientes_com_venda: clientesComVenda,
    clientes_sem_venda: Math.max(0, clientesAtivos - clientesComVenda),
    positivacao_percentual: clientesAtivos > 0 ? (clientesComVenda / clientesAtivos) * 100 : 0,
    ticket_medio_cliente: clientesComVenda > 0 ? olTotal / clientesComVenda : 0,
    ticket_medio_pedido: grupo.pedidos > 0 ? olTotal / grupo.pedidos : 0,
    registros_importados: grupo.registros,
  }
}

function montarImportados(importados, clientes, consultores, sips) {
  const clientePorId = new Map(clientes.map((item) => [texto(item.id), item]))
  const consultorPorId = new Map(
    consultores.map((item) => [texto(item.id), texto(item.nome) || texto(item.id)]),
  )
  const sipsPorCnpj = new Map()
  const sipNomes = new Map()
  const ativos = new Map()
  ativos.set(chave('GERAL', ''), clientes.length)

  for (const cliente of clientes) {
    const consultorId = texto(cliente.consultor_id) || 'SEM_CONSULTOR'
    const uf = texto(cliente.uf).toUpperCase() || 'SEM_UF'
    const gd = texto(cliente.nome_gd) || 'SEM GD'
    ativos.set(
      chave('CONSULTOR', consultorId),
      (ativos.get(chave('CONSULTOR', consultorId)) || 0) + 1,
    )
    ativos.set(chave('UF', uf), (ativos.get(chave('UF', uf)) || 0) + 1)
    ativos.set(chave('GD', gd), (ativos.get(chave('GD', gd)) || 0) + 1)
  }

  const sipClientes = new Map()
  for (const item of sips) {
    const sipId = texto(item.id)
    const documento = texto(item.cnpj).replace(/\D/g, '')
    if (!sipId || !documento) continue
    sipNomes.set(sipId, texto(item.nome) || sipId)
    if (!sipsPorCnpj.has(documento)) sipsPorCnpj.set(documento, [])
    sipsPorCnpj.get(documento).push(sipId)
    if (!sipClientes.has(sipId)) sipClientes.set(sipId, new Set())
    sipClientes.get(sipId).add(documento)
  }
  for (const [sipId, documentos] of sipClientes) {
    ativos.set(chave('SIP', sipId), documentos.size)
  }

  const grupos = new Map()
  function adicionar(anoMes, escopo, referenciaId, referenciaNome, row) {
    const id = texto(referenciaId)
    const key = `${anoMes}|${escopo}|${id}`
    if (!grupos.has(key)) {
      grupos.set(key, {
        ano_mes: anoMes,
        escopo,
        referencia_id: id,
        referencia_nome: texto(referenciaNome) || id,
        fechado_em: texto(row.importado_em),
        olTotal: 0,
        pedidos: 0,
        produtos: 0,
        quantidade: 0,
        registros: 0,
        clientesComVenda: new Set(),
      })
    }
    const grupo = grupos.get(key)
    grupo.olTotal += numero(row.faturamento)
    grupo.pedidos += Math.max(0, Math.round(numero(row.pedidos)))
    grupo.produtos += Math.max(0, Math.round(numero(row.produtos)))
    grupo.quantidade += numero(row.quantidade)
    grupo.registros += 1
    if (numero(row.faturamento) > 0) grupo.clientesComVenda.add(texto(row.cnpj))
    if (texto(row.importado_em) > grupo.fechado_em) grupo.fechado_em = texto(row.importado_em)
  }

  for (const row of importados) {
    const anoMes = texto(row.ano_mes).slice(0, 7)
    const cliente = clientePorId.get(texto(row.cliente_id))
    if (!/^\d{4}-\d{2}$/.test(anoMes) || !cliente) continue
    const documento = texto(row.cnpj).replace(/\D/g, '')
    adicionar(anoMes, 'GERAL', '', 'Equipe Norte', row)
    const consultorId = texto(cliente.consultor_id) || 'SEM_CONSULTOR'
    adicionar(
      anoMes,
      'CONSULTOR',
      consultorId,
      consultorPorId.get(consultorId) || 'Sem consultor',
      row,
    )
    const uf = texto(cliente.uf).toUpperCase() || 'SEM_UF'
    adicionar(anoMes, 'UF', uf, uf, row)
    const gd = texto(cliente.nome_gd) || 'SEM GD'
    adicionar(anoMes, 'GD', gd, gd, row)
    for (const sipId of sipsPorCnpj.get(documento) || []) {
      adicionar(anoMes, 'SIP', sipId, sipNomes.get(sipId) || sipId, row)
    }
  }

  return [...grupos.values()].map((grupo) => ({
    id: `importado-${grupo.ano_mes}-${grupo.escopo}-${grupo.referencia_id || 'geral'}`,
    ano_mes: grupo.ano_mes,
    escopo: grupo.escopo,
    referencia_id: grupo.referencia_id,
    referencia_nome: grupo.referencia_nome,
    versao: 1,
    fechado_em: grupo.fechado_em,
    criado_em: grupo.fechado_em,
    origem: 'IMPORTADO',
    resultado: resultadoImportado(
      grupo,
      ativos.get(chave(grupo.escopo, grupo.referencia_id)) || grupo.clientesComVenda.size,
    ),
  }))
}

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams
    const mes = texto(params.get('ano_mes')).slice(0, 7)
    const escopo = texto(params.get('escopo')).toUpperCase().slice(0, 20)
    const referencia = texto(params.get('referencia')).slice(0, 180)
    const cond = ['versao_atual=1']
    const binds = []
    if (mes) {
      cond.push('ano_mes=?')
      binds.push(mes)
    }
    if (escopo) {
      cond.push('escopo=?')
      binds.push(escopo)
    }
    if (referencia) {
      cond.push('(referencia_id=? OR UPPER(referencia_nome) LIKE UPPER(?))')
      binds.push(referencia, `%${referencia}%`)
    }

    const [
      linhasResult,
      mesesResult,
      importadosResult,
      clientesResult,
      consultoresResult,
      sipsResult,
    ] = await env.DB.batch([
      env.DB
        .prepare(
          `SELECT id,ano_mes,escopo,referencia_id,referencia_nome,versao,resultado_json,fechado_em,criado_em FROM historico_mensal WHERE ${cond.join(' AND ')} ORDER BY ano_mes DESC,escopo,referencia_nome COLLATE NOCASE LIMIT 1500`,
        )
        .bind(...binds),
      env.DB.prepare(
        'SELECT ano_mes,MAX(fechado_em) fechado_em,MAX(versao) versao FROM historico_mensal WHERE versao_atual=1 GROUP BY ano_mes ORDER BY ano_mes DESC',
      ),
      env.DB.prepare(
        'SELECT ano_mes,cnpj,cliente_id,faturamento,pedidos,produtos,quantidade,importado_em FROM historico_clientes_importado ORDER BY ano_mes DESC,cnpj',
      ),
      env.DB.prepare(
        'SELECT id,cnpj,consultor_id,uf,nome_gd FROM clientes WHERE carteira_importada=1 AND ativo=1',
      ),
      env.DB.prepare('SELECT id,nome FROM consultores WHERE ativo=1'),
      env.DB.prepare(
        'SELECT s.id,s.nome,sc.cnpj FROM sips s JOIN sip_clientes sc ON sc.sip_id=s.id AND sc.ativo=1 WHERE s.ativo=1',
      ),
    ])

    const fechados = (linhasResult.results || []).map((item) => {
      let resultado = {}
      try {
        resultado = JSON.parse(String(item.resultado_json || '{}'))
      } catch {}
      return { ...item, origem: 'FECHAMENTO', resultado }
    })
    const importados = montarImportados(
      importadosResult.results || [],
      clientesResult.results || [],
      consultoresResult.results || [],
      sipsResult.results || [],
    )
    const existentes = new Set(
      fechados.map((item) => `${item.ano_mes}|${item.escopo}|${item.referencia_id}`),
    )
    const referenciaNormalizada = referencia.toUpperCase()
    const sinteticos = importados.filter((item) => {
      if (existentes.has(`${item.ano_mes}|${item.escopo}|${item.referencia_id}`)) return false
      if (mes && item.ano_mes !== mes) return false
      if (escopo && item.escopo !== escopo) return false
      if (
        referencia &&
        item.referencia_id !== referencia &&
        !item.referencia_nome.toUpperCase().includes(referenciaNormalizada)
      ) {
        return false
      }
      return true
    })
    const itens = [...fechados, ...sinteticos]
      .sort(
        (a, b) =>
          b.ano_mes.localeCompare(a.ano_mes) ||
          a.escopo.localeCompare(b.escopo) ||
          a.referencia_nome.localeCompare(b.referencia_nome, 'pt-BR'),
      )
      .slice(0, 1500)

    const mesesMap = new Map(
      (mesesResult.results || []).map((item) => [
        item.ano_mes,
        { ...item, origem: 'FECHAMENTO' },
      ]),
    )
    for (const item of importados.filter((row) => row.escopo === 'GERAL')) {
      if (!mesesMap.has(item.ano_mes)) {
        mesesMap.set(item.ano_mes, {
          ano_mes: item.ano_mes,
          fechado_em: item.fechado_em,
          versao: 1,
          origem: 'IMPORTADO',
        })
      }
    }
    const meses = [...mesesMap.values()].sort((a, b) => b.ano_mes.localeCompare(a.ano_mes))
    return json({ meses, geral: itens.filter((item) => item.escopo === 'GERAL'), itens })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error)
    if (detalhe.includes('no such table')) {
      return json({
        meses: [],
        geral: [],
        itens: [],
        aviso: 'O Histórico mensal ainda não foi criado no banco.',
      })
    }
    return json({ erro: 'Não foi possível carregar o histórico.', detalhe }, 500)
  }
}
