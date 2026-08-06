export type AppPage =
  | 'dashboard'
  | 'administracao'
  | 'consultores'
  | 'clientes'
  | 'oportunidades'
  | 'sips'
  | 'mercado'
  | 'separador'
  | 'automacoes'
  | 'historico'
  | 'foco'

const PAGE_SLUG: Record<AppPage, string> = {
  dashboard: '',
  administracao: 'administracao',
  consultores: 'consultores',
  clientes: 'clientes',
  oportunidades: 'oportunidades',
  sips: 'sips',
  mercado: 'mercado-farma',
  separador: 'separador-pedidos',
  automacoes: 'automacoes',
  historico: 'historico',
  foco: 'foco-semanal',
}

const SLUG_PAGE = new Map<string, AppPage>(
  Object.entries(PAGE_SLUG)
    .filter(([, slug]) => slug)
    .map(([page, slug]) => [slug, page as AppPage]),
)

SLUG_PAGE.set('home', 'dashboard')
SLUG_PAGE.set('painel', 'dashboard')
SLUG_PAGE.set('mercado', 'mercado')
SLUG_PAGE.set('foco', 'foco')
SLUG_PAGE.set('separador', 'separador')
SLUG_PAGE.set('pedidos', 'separador')

export function readPageFromUrl(search = window.location.search): AppPage {
  const slug = new URLSearchParams(search).get('pagina')?.trim().toLowerCase() || ''
  return SLUG_PAGE.get(slug) || 'dashboard'
}

export function pageUrl(page: AppPage, href = window.location.href) {
  const url = new URL(href)
  const slug = PAGE_SLUG[page]
  if (slug) url.searchParams.set('pagina', slug)
  else url.searchParams.delete('pagina')
  return `${url.pathname}${url.search}${url.hash}`
}

export function savePageInHistory(page: AppPage, replace = false) {
  const method = replace ? 'replaceState' : 'pushState'
  window.history[method]({ pagina: page }, '', pageUrl(page))
}
