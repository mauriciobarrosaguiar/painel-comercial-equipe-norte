import { authorized, json } from '../../_lib/credentials.js'

const texto = (value) => String(value ?? '').trim()
const numero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const documento = (value) => texto(value).replace(/\D/g, '').slice(0, 14)

function documentos(value) {
  const source = Array.isArray(value) ? value : texto(value).split(/[\n,;]+/)
  return [...new Set(source.map(documento).filter((item) => item.length === 14))]
}

async function requireAdmin(request, env) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return json({ erro: 'Chave administrativa não configurada.' }, 503)
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Acesso não autorizado.' }, 401)
  }
  return null
}

export async function onRequestPost({ request, env }) {
  const denial = await requireAdmin(request, env)
  if (denial) return denial

  try {
    const body = await request.json()
    const sipId = texto(body?.sip_id).slice(0, 180)
    const nome = texto(body?.nome).slice(0, 220)
    const metaMes = Math.round(Math.max(0, numero(body?.meta_mes)) * 100) / 100
    const pagamento = Math.round(Math.max(0, numero(body?.pagamento_percentual)) * 100) / 100
    const acessoPublico = body?.acesso_publico_ativo === false ? 0 : 1
    const adicionar = documentos(body?.cnpjs_adicionar)
    const remover = documentos(body?.cnpjs_remover).filter((item) => !adicionar.includes(item))

    if (!sipId) return json({ erro: 'Informe a SIP que será editada.' }, 400)
    if (nome.length < 3) return json({ erro: 'Informe um nome válido para a SIP.' }, 400)
    if (adicionar.length > 2000 || remover.length > 2000) {
      return json({ erro: 'Quantidade de CNPJs acima do limite permitido.' }, 400)
    }

    const sip = await env.DB.prepare(
      'SELECT id,nome FROM sips WHERE id=? AND ativo=1',
    ).bind(sipId).first()
    if (!sip) return json({ erro: 'SIP não encontrada ou já excluída.' }, 404)

    const clientesEncontrados = new Map()
    if (adicionar.length) {
      const consultas = adicionar.map((cnpj) => env.DB.prepare(
        'SELECT id,cnpj,COALESCE(nome_fantasia,razao_social,cnpj) nome FROM clientes WHERE cnpj=? AND carteira_importada=1 AND ativo=1 LIMIT 1',
      ).bind(cnpj))
      const resultados = await env.DB.batch(consultas)
      resultados.forEach((resultado, index) => {
        const cliente = resultado.results?.[0]
        if (cliente) clientesEncontrados.set(adicionar[index], cliente)
      })
      const naoEncontrados = adicionar.filter((cnpj) => !clientesEncontrados.has(cnpj))
      if (naoEncontrados.length) {
        return json({
          erro: 'Alguns CNPJs não foram encontrados na carteira ativa.',
          cnpjs_nao_encontrados: naoEncontrados,
        }, 400)
      }
    }

    const now = new Date().toISOString()
    await env.DB.prepare(`
      UPDATE sips
         SET nome=?,meta_mes=?,pagamento_percentual=?,acesso_publico_ativo=?,atualizado_em=?
       WHERE id=? AND ativo=1
    `).bind(nome, metaMes, pagamento, acessoPublico, now, sipId).run()

    if (remover.length) {
      await env.DB.batch(remover.map((cnpj) => env.DB.prepare(`
        UPDATE sip_clientes
           SET ativo=0,objetivo_preco_liquido=0,atualizado_em=?
         WHERE sip_id=? AND cnpj=?
      `).bind(now, sipId, cnpj)))
    }

    if (adicionar.length) {
      await env.DB.batch(adicionar.map((cnpj) => {
        const cliente = clientesEncontrados.get(cnpj)
        return env.DB.prepare(`
          INSERT INTO sip_clientes(sip_id,cnpj,cliente_id,ativo,objetivo_preco_liquido,atualizado_em)
          VALUES(?,?,?,1,0,?)
          ON CONFLICT(sip_id,cnpj) DO UPDATE SET
            cliente_id=excluded.cliente_id,
            ativo=1,
            atualizado_em=excluded.atualizado_em
        `).bind(sipId, cnpj, cliente.id, now)
      }))
    }

    const totalRow = await env.DB.prepare(
      'SELECT COUNT(*) total FROM sip_clientes WHERE sip_id=? AND ativo=1',
    ).bind(sipId).first()
    const totalCnpjs = Number(totalRow?.total || 0)
    const objetivoIndividual = totalCnpjs > 0 ? metaMes / totalCnpjs : 0
    await env.DB.prepare(`
      UPDATE sip_clientes
         SET objetivo_preco_liquido=?,atualizado_em=?
       WHERE sip_id=? AND ativo=1
    `).bind(objetivoIndividual, now, sipId).run()

    return json({
      sucesso: true,
      sip_id: sipId,
      nome,
      meta_mes: metaMes,
      pagamento_percentual: pagamento,
      acesso_publico_ativo: Boolean(acessoPublico),
      cnpjs_vinculados: totalCnpjs,
      cnpjs_adicionados: adicionar,
      cnpjs_removidos: remover,
      mensagem: `SIP ${nome} atualizada com ${totalCnpjs} CNPJs vinculados.`,
      atualizado_em: now,
    })
  } catch (error) {
    return json({
      erro: 'Não foi possível editar a SIP.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
