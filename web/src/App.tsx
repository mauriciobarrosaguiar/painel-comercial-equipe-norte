import { useEffect, useMemo, useState } from 'react'
import IntegrationSettings from './IntegrationSettings'
import ConsultantsModule from './ConsultantsModule'
import './dashboard.css'

type ModuleCard = {
  title: string
  description: string
  icon: string
  status?: string
}

type ConsultantOption = {
  id: string
  nome: string
}

type AppliedFilters = {
  periodo: string
  inicio: string | null
  fim: string | null
  consultor: string
  uf: string
  rotulo: string
}

type DashboardData = {
  ol_total_faturado: number
  ol_sem_combate: number
  ol_combate: number
  ol_prioritarios: number
  ol_lancamentos: number
  clientes_com_venda: number
  clientes_sem_venda: number
  clientes_ativos: number
  consultores_ativos: number
  vendas_faturadas: number
  automacoes_executando: number
  filtros: {
    consultores: ConsultantOption[]
    ufs: string[]
    aplicado: AppliedFilters
  }
  atualizado_em: string
}

type DatabaseState = 'carregando' | 'conectado' | 'erro'
type Page = 'dashboard' | 'administracao' | 'consultores'
type PeriodOption = 'mes-atual' | 'mes-anterior' | 'todo-periodo' | 'personalizado'

const modules: ModuleCard[] = [
  { title: 'Visão Geral', description: 'Indicadores, metas, projeções e desempenho da equipe.', icon: '▦', status: 'Primeira etapa' },
  { title: 'Consultores', description: 'Ranking, resultados individuais e acompanhamento das metas.', icon: '◉', status: 'Ativo' },
  { title: 'Clientes', description: 'Positivação, cobertura, histórico e oportunidades por cliente.', icon: '◇' },
  { title: 'Foco Semanal', description: 'Produtos foco, clientes selecionados e acompanhamento da semana.', icon: '◎' },
  { title: 'Oportunidades', description: 'Clientes sem compra, mix ausente e potenciais de crescimento.', icon: '↗' },
  { title: 'Mercado Farma', description: 'Preços, estoques e distribuidores organizados por UF.', icon: '⌁' },
  { title: 'SIP / Redes', description: 'Grupos, redes, acessos e resultados consolidados.', icon: '⬡' },
  { title: 'Histórico', description: 'Comparativos mensais e evolução dos principais indicadores.', icon: '◫' },
  { title: 'Automações', description: 'Extrações do Bússola e Mercado Farma com status em tempo real.', icon: '⚙' },
  { title: 'Administração', description: 'Usuários, integrações, metas, produtos e configurações.', icon: '☷' },
]

const initialDashboard: DashboardData = {
  ol_total_faturado: 0,
  ol_sem_combate: 0,
  ol_combate: 0,
  ol_prioritarios: 0,
  ol_lancamentos: 0,
  clientes_com_venda: 0,
  clientes_sem_venda: 0,
  clientes_ativos: 0,
  consultores_ativos: 0,
  vendas_faturadas: 0,
  automacoes_executando: 0,
  filtros: {
    consultores: [],
    ufs: [],
    aplicado: {
      periodo: 'mes-atual',
      inicio: null,
      fim: null,
      consultor: '',
      uf: '',
      rotulo: 'Mês atual',
    },
  },
  atualizado_em: '',
}

const numberFormatter = new Intl.NumberFormat('pt-BR')
const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthBounds(offset: number) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { inicio: formatLocalDate(first), fim: formatLocalDate(last) }
}

const currentMonth = monthBounds(0)

function formatUpdatedAt(value: string) {
  if (!value) return 'Atualização ainda não concluída'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Horário de atualização indisponível'
  return `Atualizado em ${new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date)}`
}

function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [dashboard, setDashboard] = useState<DashboardData>(initialDashboard)
  const [databaseState, setDatabaseState] = useState<DatabaseState>('carregando')
  const [period, setPeriod] = useState<PeriodOption>('mes-atual')
  const [consultant, setConsultant] = useState('')
  const [uf, setUf] = useState('')
  const [customStart, setCustomStart] = useState(currentMonth.inicio)
  const [customEnd, setCustomEnd] = useState(currentMonth.fim)

  const selectedPeriod = useMemo(() => {
    if (period === 'mes-atual') return monthBounds(0)
    if (period === 'mes-anterior') return monthBounds(-1)
    if (period === 'personalizado') return { inicio: customStart, fim: customEnd }
    return { inicio: '', fim: '' }
  }, [period, customStart, customEnd])

  useEffect(() => {
    if (period === 'personalizado' && (!customStart || !customEnd)) return

    const controller = new AbortController()
    let active = true

    async function loadDashboard() {
      setDatabaseState('carregando')
      try {
        const params = new URLSearchParams({ periodo: period })
        if (selectedPeriod.inicio && selectedPeriod.fim) {
          params.set('inicio', selectedPeriod.inicio)
          params.set('fim', selectedPeriod.fim)
        }
        if (consultant) params.set('consultor', consultant)
        if (uf) params.set('uf', uf)

        const [healthResponse, dashboardResponse] = await Promise.all([
          fetch('/api/health', { cache: 'no-store', signal: controller.signal }),
          fetch(`/api/dashboard?${params.toString()}`, { cache: 'no-store', signal: controller.signal }),
        ])
        if (!healthResponse.ok || !dashboardResponse.ok) throw new Error('API indisponível')
        const health = await healthResponse.json() as { database?: string }
        const data = await dashboardResponse.json() as DashboardData
        if (active) {
          setDashboard(data)
          setDatabaseState(health.database === 'ok' ? 'conectado' : 'erro')
        }
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        if (active) setDatabaseState('erro')
      }
    }

    void loadDashboard()
    return () => {
      active = false
      controller.abort()
    }
  }, [period, consultant, uf, customStart, customEnd, selectedPeriod.inicio, selectedPeriod.fim])

  const statusText = databaseState === 'conectado'
    ? 'Banco conectado'
    : databaseState === 'erro'
      ? 'Falha ao conectar ao banco'
      : 'Atualizando resultados'

  const selectedConsultantName = dashboard.filtros.consultores.find((item) => item.id === consultant)?.nome
  const activeFilterText = useMemo(() => {
    const parts = [dashboard.filtros.aplicado.rotulo || statusText]
    if (selectedConsultantName) parts.push(selectedConsultantName)
    if (uf) parts.push(`UF ${uf}`)
    return parts.join(' · ')
  }, [dashboard.filtros.aplicado.rotulo, selectedConsultantName, statusText, uf])

  const summary = useMemo(() => [
    { label: 'OL sem combate', value: currencyFormatter.format(dashboard.ol_sem_combate), detail: activeFilterText },
    { label: 'OL prioritários', value: currencyFormatter.format(dashboard.ol_prioritarios), detail: activeFilterText },
    { label: 'OL lançamentos', value: currencyFormatter.format(dashboard.ol_lancamentos), detail: activeFilterText },
    { label: 'Clientes com venda', value: numberFormatter.format(dashboard.clientes_com_venda), detail: `${numberFormatter.format(dashboard.clientes_sem_venda)} sem venda · ${activeFilterText}` },
  ], [dashboard, activeFilterText])

  function goTo(nextPage: Page) {
    setPage(nextPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function openModule(title: string) {
    if (title === 'Administração') goTo('administracao')
    if (title === 'Consultores') goTo('consultores')
    if (title === 'Visão Geral') goTo('dashboard')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={() => goTo('dashboard')}>
          <div className="brand-mark">N</div>
          <div><strong>Painel Comercial</strong><span>Equipe Norte</span></div>
        </button>
        <div className="topbar-actions">
          <span className="environment-badge">Nova versão</span>
          <button className="profile-button" type="button" aria-label="Perfil do usuário">MB</button>
        </div>
      </header>

      {page === 'administracao' ? (
        <IntegrationSettings onBack={() => goTo('dashboard')} />
      ) : page === 'consultores' ? (
        <ConsultantsModule onBack={() => goTo('dashboard')} />
      ) : (
        <main className="content">
          <section className="hero">
            <div>
              <span className="eyebrow">Gestão comercial</span>
              <h1>Bom dia, Maurício</h1>
              <p>Acompanhe a operação da Equipe Norte em um único lugar.</p>
            </div>
            <div className="hero-actions">
              <button className="secondary-button" type="button" onClick={() => goTo('administracao')}>Últimas atualizações</button>
              <button className="primary-button" type="button" onClick={() => goTo('administracao')}>Central de automações</button>
            </div>
          </section>

          <section className="filters" aria-label="Filtros do painel">
            <label>
              <span>Período</span>
              <select value={period} onChange={(event) => setPeriod(event.target.value as PeriodOption)}>
                <option value="mes-atual">Mês atual</option>
                <option value="mes-anterior">Mês anterior</option>
                <option value="todo-periodo">Todo o período extraído</option>
                <option value="personalizado">Personalizado</option>
              </select>
            </label>
            <label>
              <span>Consultor</span>
              <select value={consultant} onChange={(event) => setConsultant(event.target.value)}>
                <option value="">Todos os consultores</option>
                {dashboard.filtros.consultores.map((item) => (
                  <option value={item.id} key={item.id}>{item.nome}</option>
                ))}
              </select>
            </label>
            <label>
              <span>UF</span>
              <select value={uf} onChange={(event) => setUf(event.target.value)}>
                <option value="">Todas as UFs</option>
                {dashboard.filtros.ufs.map((item) => <option value={item} key={item}>{item}</option>)}
              </select>
            </label>
            {period === 'personalizado' && (
              <>
                <label><span>Data inicial</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
                <label><span>Data final</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
              </>
            )}
          </section>

          <section className="total-ol-card" aria-label="OL total faturado">
            <div>
              <span>OL total faturado</span>
              <small>{activeFilterText} · {formatUpdatedAt(dashboard.atualizado_em)}</small>
            </div>
            <strong>{databaseState === 'carregando' ? '—' : currencyFormatter.format(dashboard.ol_total_faturado)}</strong>
            <div className="total-ol-combate">
              <span>OL combate</span>
              <b>{databaseState === 'carregando' ? '—' : currencyFormatter.format(dashboard.ol_combate)}</b>
            </div>
          </section>

          <section className="summary-grid" aria-label="Resumo de resultados">
            {summary.map((item) => (
              <article className="summary-card" key={item.label}>
                <span>{item.label}</span>
                <strong>{databaseState === 'carregando' ? '—' : item.value}</strong>
                <small>{databaseState === 'erro' ? statusText : item.detail}</small>
              </article>
            ))}
          </section>

          <section className="section-heading">
            <div><span className="eyebrow">Acesso rápido</span><h2>Módulos do painel</h2></div>
            <span className="development-note">{statusText}</span>
          </section>

          <section className="modules-grid">
            {modules.map((module) => (
              <button className="module-card" key={module.title} type="button" onClick={() => openModule(module.title)}>
                <div className="module-card-top"><span className="module-icon" aria-hidden="true">{module.icon}</span>{module.status && <span className="module-status">{module.status}</span>}</div>
                <div><h3>{module.title}</h3><p>{module.description}</p></div>
                <span className="module-link">Abrir módulo <b>→</b></span>
              </button>
            ))}
          </section>
        </main>
      )}

      <footer><span>Painel Comercial · Equipe Norte</span><span>Versão SaaS em construção</span></footer>
    </div>
  )
}

export default App
