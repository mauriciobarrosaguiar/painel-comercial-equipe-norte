import { onRequestPost as salvar } from './desafio-gigantes-gestao.js'

export async function onRequestPost(context) {
  const form = await context.request.formData()
  const request = new Request(context.request.url.replace('desafio-gigantes-corrigir', 'desafio-gigantes-gestao'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: context.request.headers.get('cookie') || '' },
    body: JSON.stringify({ acao: 'corrigir_sap', sku: form.get('sku'), ean: form.get('ean'), produto: form.get('produto') }),
  })
  const response = await salvar({ ...context, request })
  if (!response.ok) return response
  const url = new URL(context.request.url)
  url.pathname = '/'
  url.search = '?pagina=desafio-de-gigantes'
  return Response.redirect(url.toString(), 303)
}
