import { authorized, json, readSession } from './_lib/credentials.js'

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url), path = url.pathname
  if (!path.startsWith('/api/')) return next()
  if (path === '/api/auth/login' || path === '/api/auth/session' || path === '/api/auth/logout') return next()
  if (path === '/api/sips/detalhe' && url.searchParams.get('publico') === '1') return next()
  if (path === '/api/exportar' && url.searchParams.get('tipo') === 'sip_detalhado' && url.searchParams.get('publico') === '1') return next()
  if (path.startsWith('/api/internal/')) return (await authorized(request, env.PAINEL_ADMIN_KEY)) ? next() : json({ erro: 'Acesso interno negado.' }, 401)
  if (await readSession(request, env.PAINEL_ADMIN_KEY)) return next()
  if (await authorized(request, env.PAINEL_ADMIN_KEY)) return next()
  return json({ erro: 'Sessão expirada. Entre novamente no painel.' }, 401)
}
