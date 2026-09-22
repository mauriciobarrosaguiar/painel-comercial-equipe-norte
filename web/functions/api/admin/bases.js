import { onRequestGet as obterBases, onRequestPost as importarBases } from './bases-v2.js'
import { onRequestPost as fecharMes } from '../internal/fechamento-mensal.js'
import { onRequestPost as dispararDesafioSap } from '../desafio-gigantes-disparar.js'
import { salvarArquivoDesafioGigantes } from '../../_lib/desafio-gigantes-arquivo.js'

const texto = (value) => String(value ?? '').trim()
const digitos = (value) => texto(value).replace(/\D/g, '')
const alto = (value) => texto(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .toUpperCase()

function mesAnterior(anoMes) {
  const [ano, mes] = anoMes.split('-').map(Number)
  const data = new Date(Date.UTC(ano, mes - 1, 1))
  data.setUTCMonth(data.getUTCMonth() - 1)
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`
}

function ehGerente(row) {
  const escopo = alto(row?.escopo || row?.cargo)
  return escopo.includes('GERENTE') || escopo.includes('DISTRITAL') || escopo === 'GD'
}

async function filtrarMetasParaEquipe(env, body) {
  const tipo = texto(body?.tipo)
  if (!['metas', 'metas_mix'].includes(tipo)) return body

  const rows = Array.isArray(body?.rows) ? body.rows : []
  if (!rows.length) return body

  const filtradas = rows
    .filter((row) => {
      if (ehGerente(row)) return false
      const nome = alto(row?.consultor || row?.colaborador)
      const setor = digitos(row?.setor)
      return nome === 'MAURICIO BARROS DE AGUIAR' || setor === '18150301'
    })
    .map((row) => ({
      ...row,
      consultor: 'MAURICIO BARROS DE AGUIAR',
      colaborador: 'MAURICIO BARROS DE AGUIAR',
      escopo: 'consultor',
    }))

  if (!filtradas.length) {
    throw new Error('A planilha não contém a meta de MAURICIO BARROS DE AGUIAR / setor 18150301.')
  }

  return {
    ...body,
    rows: filtradas,
    filtro_equipe: {
      modo: 'pessoal',
      linhas_recebidas: rows.length,
      linhas_importadas: filtradas.length,
      linhas_ignoradas: Math.max(0, rows.length - filtradas.length),
    },
  }
}

function requestComBody(request, body) {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
  })
}

async function aplicarMixAtual(env) {
  const agora = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE produtos
         SET tipo_mix='LINHA',
             mix_importacao_id=NULL,
             atualizado_em=?
       WHERE ativo=1
    `).bind(agora),
    env.DB.prepare(`
      UPDATE produtos
         SET tipo_mix=(
               SELECT m.tipo_mix
                 FROM produtos_mix_sap m
                WHERE m.ativo=1
                  AND TRIM(m.sku)=TRIM(COALESCE(produtos.sku,''))
                LIMIT 1
             ),
             mix_importacao_id=(
               SELECT m.importacao_id
                 FROM produtos_mix_sap m
                WHERE m.ativo=1
                  AND TRIM(m.sku)=TRIM(COALESCE(produtos.sku,''))
                LIMIT 1
             ),
             atualizado_em=?
       WHERE ativo=1
         AND EXISTS(
               SELECT 1
                 FROM produtos_mix_sap m
                WHERE m.ativo=1
                  AND TRIM(m.sku)=TRIM(COALESCE(produtos.sku,''))
             )
    `).bind(agora),
  ])
}

async function fecharAnteriorAntesDaImportacao({ request, env }, body) {
  const tipo = texto(body?.tipo)
  const anoMes = texto(body?.ano_mes)
  if (!['metas', 'metas_mix'].includes(tipo) || !/^\d{4}-\d{2}$/.test(anoMes)) return null

  const anterior = mesAnterior(anoMes)
  const metaAnterior = await env.DB.prepare(
    'SELECT COUNT(*) total FROM metas WHERE ano_mes=?',
  ).bind(anterior).first()
  if (Number(metaAnterior?.total || 0) === 0) return null

  const fechamentoAtual = await env.DB.prepare(`
    SELECT id FROM historico_mensal
     WHERE ano_mes=? AND escopo='GERAL' AND versao_atual=1
     LIMIT 1
  `).bind(anterior).first()
  if (fechamentoAtual?.id) return null

  const chave = request.headers.get('x-admin-key') || ''
  const fechamentoRequest = new Request(
    new URL('/api/internal/fechamento-mensal', request.url),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-key': chave,
      },
      body: JSON.stringify({
        ano_mes: anterior,
        motivo: `Fechamento automático antes da importação das metas de ${anoMes}.`,
      }),
    },
  )

  const response = await fecharMes({ request: fechamentoRequest, env })
  return response.ok ? null : response
}

async function acionarSapAposImportacao(context) {
  const headers = new Headers({ 'content-type': 'application/json' })
  const cookie = context.request.headers.get('cookie') || ''
  const chave = context.request.headers.get('x-admin-key') || ''
  if (cookie) headers.set('cookie', cookie)
  if (chave) headers.set('x-admin-key', chave)
  const request = new Request(new URL('/api/desafio-gigantes-disparar', context.request.url), {
    method: 'POST',
    headers,
    body: '{}',
  })
  return dispararDesafioSap({ request, env: context.env })
}

export const onRequestGet = obterBases

export async function onRequestPost(context) {
  let body = {}
  try {
    body = await context.request.clone().json()
  } catch {}

  try {
    body = await filtrarMetasParaEquipe(context.env, body)
  } catch (error) {
    return new Response(JSON.stringify({ erro: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
    })
  }

  const contextoImportacao = body !== null && ['metas', 'metas_mix'].includes(texto(body?.tipo))
    ? { ...context, request: requestComBody(context.request, body) }
    : context

  const falhaFechamento = await fecharAnteriorAntesDaImportacao(contextoImportacao, body)
  if (falhaFechamento) return falhaFechamento

  const response = await importarBases(contextoImportacao)
  if (!response.ok) return response

  if (texto(body?.tipo) === 'metas_mix') {
    try {
      await aplicarMixAtual(context.env)
    } catch (error) {
      return new Response(JSON.stringify({
        erro: `Metas e lista de MIX foram importadas, mas a aplicação final do MIX falhou: ${error instanceof Error ? error.message : String(error)}`,
      }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
      })
    }
  }

  if (texto(body?.tipo) !== 'desafio_gigantes') return response

  let resultado = {}
  try { resultado = await response.json() } catch {}

  let arquivoOriginal = { salvo: false }
  try {
    arquivoOriginal = await salvarArquivoDesafioGigantes(context.env, body)
  } catch (error) {
    arquivoOriginal = {
      salvo: false,
      erro: `Metas importadas, mas não foi possível guardar o arquivo original: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  let automacaoSap = { acionada: false, status: 'erro', mensagem: 'A planilha foi importada, mas a verificação SAP não pôde ser acionada.' }
  try {
    const disparo = await acionarSapAposImportacao(contextoImportacao)
    const dados = await disparo.json().catch(() => ({}))
    automacaoSap = {
      acionada: disparo.ok,
      status: dados.status || (disparo.ok ? 'acionada' : 'erro'),
      mensagem: dados.mensagem || dados.erro || automacaoSap.mensagem,
    }
  } catch (error) {
    automacaoSap.mensagem = `A planilha foi importada, mas o disparo SAP falhou: ${error instanceof Error ? error.message : String(error)}`
  }
  return new Response(JSON.stringify({ ...resultado, arquivo_original: arquivoOriginal, automacao_sap: automacaoSap }), {
    status: response.status,
    headers: response.headers,
  })
}
