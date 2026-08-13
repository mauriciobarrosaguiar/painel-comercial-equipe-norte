import { useEffect, useMemo, useState } from 'react'
import IntegrationSettings from './IntegrationSettings'
import ConsultantsModule from './ConsultantsModule'
import PendingOrdersOverview from './PendingOrdersOverview'
import DownloadImagesButton from './DownloadImagesButton'
import DesafioGigantesCard from './DesafioGigantesCard'
import type { SessionUser } from './LoginPage'
import type { AppPage } from './navigation'
import './dashboard.css'

type Page = 'dashboard' | 'administracao' | 'consultores'
type Period = 'mes-atual' | 'mes-anterior' | 'todo-periodo' | 'personalizado'
type Dashboard = any
type Props = {
  user: SessionUser
  page: Page
  onNavigate: (page: AppPage) => void
  onLogout: () => void
  onInstall: () => void
}

const modules = [
  ['Visão Geral', 'Indicadores, metas, projeções e desempenho da equipe.', '▦'],
  ['Consultores', 'Ranking, resultados individuais e acompanhamento das metas.', '◉'],
  ['Clientes', 'Positivação, cobertura, histórico e oportunidades por cliente.', '◇'],
  ['Foco Semanal', 'Produtos foco, metas por consultor e acompanhamento da semana.', '◎'],
  ['Oportunidades', 'Clientes sem compra, mix ausente e potenciais de crescimento.', '↗'],
  ['Mercado Farma', 'Preços, estoques e distribuidores organizados por UF.', '⌁'],
  ['SIP / Redes', 'Grupos, redes, acessos e resultados consolidados.', '⬡'],
  ['Histórico', 'Comparativos mensais e evolução dos principais indicadores.', '◫'],
  ['Automações', 'Extrações do Bússola e Mercado Farma com status em tempo real.', '⚙'],
  ['Administração', 'Integrações, metas, produtos e configurações.', '☷'],
]
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2)
  .map((item) => item[0]).join('').toUpperCase() || 'N'
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const bounds = (offset: number) => {
  const now = new Date()
  return {
    inicio: iso(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
    fim: iso(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)),
  }
}
const current = bounds(0)
const initial: Dashboard = {
  ol_total_faturado: 0,
  ol_sem_combate: 0,
  ol_combate: 0,
  ol_prioritarios: 0,
  ol_lancamentos: 0,
  meta_ol_sem_combate: 0,
  meta_ol_prioritarios: 0,
  meta_ol_lancamentos: 0,
  resultado_ol_sem_combate: 0,
  resultado_ol_prioritarios: 0,
  resultado_ol_lancamentos: 0,
  projecao: {
    ativa: false,
    dias_uteis_decorridos: 0,
    dias_uteis_total: 0,
    ol_sem_combate: 0,
    ol_prioritarios: 0,
    ol_lancamentos: 0,
    resultado_ol_sem_combate: 0,
    resultado_ol_prioritarios: 0,
    resultado_ol_lancamentos: 0,
  },
  clientes_com_venda: 0,
  clientes_sem_venda: 0,
  clientes_ativos: 0,
  pedidos_nao_faturados: 0,
  valor_nao_faturado: 0,
  nao_faturados_por_consultor: [],
  filtros: { consultores: [], ufs: [], aplicado: { rotulo: 'Mês atual' } },
  atualizado_em: '',
}
const updated = (value: string) => {
  if (!value) return 'Atualização ainda não concluída'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Horário indisponível'
    : `Atualizado em ${new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
    }).format(date)}`
}
const resultClass = (value: number) => value >= 100 ? 'metric-good' : value >= 80 ? 'metric-warning' : 'metric-low'

export default function App({ user, page, onNavigate, onLogout, onInstall }: Props) {
  const [dashboard, setDashboard] = useState<Dashboard>(initial)
  const [state, setState] = useState<'carregando' | 'conectado' | 'erro'>('carregando')
  const [period, setPeriod] = useState<Period>('mes-atual')
  const [consultant, setConsultant] = useState('')
  const [uf, setUf] = useState('')
  const [start, setStart] = useState(current.inicio)
  const [end, setEnd] = useState(current.fim)
  const selected = useMemo(
    () => period === 'mes-atual'
      ? bounds(0)
      : period === 'mes-anterior'
        ? bounds(-1)
        : period === 'personalizado'
          ? { inicio: start, fim: end }
          : { inicio: '', fim: '' },
    [period, start, end],
  )
  const presentationQuery = useMemo(() => {
    const params = new URLSearchParams({ periodo: period })
    if (selected.inicio && selected.fim) { params.set('inicio', selected.inicio); params.set('fim', selected.fim) }
    if (consultant) params.set('consultor', consultant)
    if (uf) params.set('uf', uf)
    return params.toString()
  }, [period, consultant, uf, selected.inicio, selected.fim])

  useEffect(() => {
    if (period === 'personalizado' && (!start || !end)) return undefined
    const controller = new AbortController()
    setState('carregando')
    const params = new URLSearchParams({ periodo: period })
    if (selected.inicio && selected.fim) { params.set('inicio', selected.inicio); params.set('fim', selected.fim) }
    if (consultant) params.set('consultor', consultant)
    if (uf) params.set('uf', uf)
    Promise.all([
      fetch('/api/health', { cache: 'no-store', signal: controller.signal }),
      fetch(`/api/dashboard?${params}`, { cache: 'no-store', signal: controller.signal }),
    ]).then(async ([healthResponse, dashboardResponse]) => {
      const result = await dashboardResponse.json()
      if (!healthResponse.ok || !dashboardResponse.ok) throw new Error(result.detalhe || result.erro || 'API indisponível')
      const health = await healthResponse.json()
      setDashboard(result)
      setState(health.database === 'ok' ? 'conectado' : 'erro')
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setState('erro')
    })
    return () => controller.abort()
  }, [period, consultant, uf, start, end, selected.inicio, selected.fim])

  const status = state === 'conectado' ? 'Banco conectado' : state === 'erro' ? 'Falha ao conectar ao banco' : 'Atualizando resultados'
  const consultantName = dashboard.filtros?.consultores?.find((item: any) => item.id === consultant)?.nome
  const filter = [dashboard.filtros?.aplicado?.rotulo || status, consultantName, uf ? `UF ${uf}` : ''].filter(Boolean).join(' · ')
  const open = (title: string) => {
    const route: Record<string, AppPage> = {
      'Visão Geral': 'dashboard', Consultores: 'consultores', Clientes: 'clientes', 'Foco Semanal': 'foco',
      Oportunidades: 'oportunidades', 'Mercado Farma': 'mercado', 'SIP / Redes': 'sips', Histórico: 'historico',
      Automações: 'automacoes', Administração: 'administracao',
    }
    const nextPage = route[title]
    if (nextPage) onNavigate(nextPage)
  }
  const cards = [
    ['OL sem combate', 'ol_sem_combate', 'meta_ol_sem_combate', 'resultado_ol_sem_combate'],
    ['OL prioritários', 'ol_prioritarios', 'meta_ol_prioritarios', 'resultado_ol_prioritarios'],
    ['OL lançamentos', 'ol_lancamentos', 'meta_ol_lancamentos', 'resultado_ol_lancamentos'],
  ]

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => onNavigate('dashboard')}>
          <div className="brand-mark">N</div><div><strong>Painel Comercial</strong><span>Equipe Norte</span></div>
        </button>
        <div className="topbar-actions">
          <button className="topbar-download topbar-install" onClick={onInstall}>Baixar app</button>
          <span className="environment-badge">{user.nome}</span>
          <span className="profile-button" aria-hidden="true">{initials(user.nome)}</span>
          <button className="topbar-logout" type="button" onClick={onLogout}>Sair</button>
        </div>
      </header>

      {page === 'administracao' ? (
        <IntegrationSettings onBack={() => onNavigate('dashboard')} />
      ) : page === 'consultores' ? (
        <ConsultantsModule onBack={() => onNavigate('dashboard')} />
      ) : (
        <main className="content">
          <section className="hero">
            <div><span className="eyebrow">Gestão comercial</span><h1>Olá, {user.nome.split(' ')[0]}</h1><p>Acompanhe a operação da Equipe Norte em um único lugar.</p></div>
            <div className="hero-actions">
              <DownloadImagesButton query={presentationQuery} />
              <button className="secondary-button" onClick={onInstall}>Baixar app mobile</button>
              <button className="primary-button" onClick={() => onNavigate('administracao')}>Central de automações</button>
            </div>
          </section>

          <section className="filters">
            <label><span>Período</span><select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
              <option value="mes-atual">Mês atual</option><option value="mes-anterior">Mês anterior</option><option value="todo-periodo">Todo o período</option><option value="personalizado">Personalizado</option>
            </select></label>
            <label><span>Consultor</span><select value={consultant} onChange={(event) => setConsultant(event.target.value)}>
              <option value="">Todos</option>{(dashboard.filtros?.consultores || []).map((item: any) => <option key={item.id} value={item.id}>{item.nome}</option>)}
            </select></label>
            <label><span>UF</span><select value={uf} onChange={(event) => setUf(event.target.value)}>
              <option value="">Todas</option>{(dashboard.filtros?.ufs || []).map((item: string) => <option key={item}>{item}</option>)}
            </select></label>
            {period === 'personalizado' && <><label><span>Data inicial</span><input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label><span>Data final</span><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label></>}
          </section>

          <section className="total-ol-card">
            <div><span>OL total faturado</span><small>{filter} · {updated(dashboard.atualizado_em)}</small></div>
            <strong>{state === 'carregando' ? '—' : money.format(dashboard.ol_total_faturado || 0)}</strong>
            <div className="total-ol-combate"><span>OL combate</span><b>{state === 'carregando' ? '—' : money.format(dashboard.ol_combate || 0)}</b></div>
          </section>

          <PendingOrdersOverview loading={state === 'carregando'} orders={dashboard.pedidos_nao_faturados || 0} value={dashboard.valor_nao_faturado || 0} rows={dashboard.nao_faturados_por_consultor || []} filter={filter} />

          <section className="goal-grid">
            {cards.map(([label, key, meta, result]) => <article className="goal-card" key={key}>
              <div className="goal-card-heading"><span>{label}</span><b className={resultClass(dashboard[result] || 0)}>{state === 'carregando' ? '—' : `${pct.format(dashboard[result] || 0)}%`}</b></div>
              <strong>{state === 'carregando' ? '—' : money.format(dashboard[key] || 0)}</strong>
              <div className="goal-details"><span>Meta</span><b>{money.format(dashboard[meta] || 0)}</b></div>
              <div className="goal-details"><span>Projeção do mês</span><b>{dashboard.projecao?.ativa ? money.format(dashboard.projecao[key] || 0) : 'Período concluído'}</b></div>
              <small>{dashboard.projecao?.ativa ? `${pct.format(dashboard.projecao[`resultado_${key}`] || 0)}% projetado · ${dashboard.projecao.dias_uteis_decorridos}/${dashboard.projecao.dias_uteis_total} dias úteis` : filter}</small>
            </article>)}
            <article className="goal-card">
              <div className="goal-card-heading"><span>Clientes com venda</span><b>{pct.format(dashboard.clientes_ativos > 0 ? dashboard.clientes_com_venda / dashboard.clientes_ativos * 100 : 0)}%</b></div>
              <strong>{num.format(dashboard.clientes_com_venda || 0)}</strong>
              <div className="goal-details"><span>Sem venda</span><b>{num.format(dashboard.clientes_sem_venda || 0)}</b></div><small>{filter}</small>
            </article>
          </section>

          <DesafioGigantesCard inicio={selected.inicio || current.inicio} consultor={consultant} uf={uf} />

          <section className="section-heading"><div><span className="eyebrow">Acesso rápido</span><h2>Módulos do painel</h2></div><span className="development-note">{status}</span></section>
          <section className="modules-grid">
            {modules.map(([title, description, icon]) => <button className="module-card" key={title} onClick={() => open(title)}>
              <div className="module-card-top"><span className="module-icon">{icon}</span><span className="module-status">Ativo</span></div>
              <div><h3>{title}</h3><p>{description}</p></div><span className="module-link">Abrir módulo <b>→</b></span>
            </button>)}
          </section>
        </main>
      )}
      <footer><span>Painel Comercial · Equipe Norte</span><span>Versão SaaS em evolução</span></footer>
    </div>
  )
}
