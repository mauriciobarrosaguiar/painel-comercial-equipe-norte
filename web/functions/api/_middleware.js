import { repairPptxBytes } from '../_lib/pptx-repair.js'
import { createTursoD1 } from '../_lib/turso-d1.js'

function ativarTurso(context) {
  const url = String(context.env?.TURSO_DATABASE_URL || '').trim()
  const token = String(context.env?.TURSO_AUTH_TOKEN || '').trim()
  if (!url || !token) return 'd1'

  const db = createTursoD1(context.env)
  try {
    context.env.DB = db
  } catch {
    // A validação abaixo detecta ambientes em que bindings sejam imutáveis.
  }
  if (context.env.DB !== db) {
    throw new Error('Não foi possível ativar o Turso como binding DB da API.')
  }
  return 'turso'
}

function comBackend(response, backend) {
  const headers = new Headers(response.headers)
  headers.set('x-db-backend', backend)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function onRequest(context) {
  const url = new URL(context.request.url)
  let backend = 'd1'
  try {
    backend = ativarTurso(context)
  } catch (error) {
    return new Response(JSON.stringify({
      erro: error instanceof Error ? error.message : String(error),
      backend: 'turso',
    }), {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-db-backend': 'turso-erro',
      },
    })
  }

  const response = await context.next()
  const contentType = response.headers.get('content-type') || ''
  if (
    context.request.method !== 'GET'
    || url.pathname !== '/api/apresentacao-painel'
    || !response.ok
    || !contentType.includes('presentationml.presentation')
  ) return comBackend(response, backend)

  const original = response.clone()
  try {
    const repaired = await repairPptxBytes(new Uint8Array(await response.arrayBuffer()))
    const headers = new Headers(response.headers)
    headers.set('content-type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    headers.set('cache-control', 'no-store')
    headers.set('x-pptx-compatible', 'powerpoint-mobile')
    headers.set('x-db-backend', backend)
    headers.delete('content-length')
    return new Response(repaired, { status: response.status, headers })
  } catch {
    return comBackend(original, backend)
  }
}
