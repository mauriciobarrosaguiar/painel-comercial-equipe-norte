import { repairPptxBytes } from '../_lib/pptx-repair.js'

export async function onRequest(context) {
  const url = new URL(context.request.url)
  const response = await context.next()
  const contentType = response.headers.get('content-type') || ''
  if (
    context.request.method !== 'GET'
    || url.pathname !== '/api/apresentacao-painel'
    || !response.ok
    || !contentType.includes('presentationml.presentation')
  ) return response
  const original = response.clone()
  try {
    const repaired = await repairPptxBytes(new Uint8Array(await response.arrayBuffer()))
    const headers = new Headers(response.headers)
    headers.set('content-type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    headers.set('cache-control', 'no-store')
    headers.set('x-pptx-compatible', 'powerpoint-mobile')
    headers.delete('content-length')
    return new Response(repaired, { status: response.status, headers })
  } catch {
    return original
  }
}
