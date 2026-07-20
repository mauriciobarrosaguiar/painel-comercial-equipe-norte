import { useEffect, useMemo, useState } from 'react'

type ModuleCard = {
  title: string
  description: string
  icon: string
  status?: string
}

type DashboardData = {
  ol_sem_combate: number
  ol_prioritarios: number
  ol_lancamentos: number
  clientes_com_venda: number
  clientes_ativos: number
  consultores_ativos: number
  vendas_faturadas: number
  automacoes_executando: number
  atualizado_em: string
}

type DatabaseState = 'carregando' | 'conectado' | 'erro'

const modules: ModuleCard[] = [
  { title: 'Visão Geral', description: 'Indicadores, metas, projeções e desempenho da equipe.', icon: '▦', status: 'Primeira etapa' },
  { title: 'Consultores', description: 'Ranking, resultados individuais e acompanhamento das metas.', icon: '◉' },
  { title: 'Clientes', description: 'Positivação, cobertura, histórico e oportunidades por cliente.', icon: '◇' },
  { title: 'Foco Semanal', description: 'Produtos foco, clientes selecionados e acompanhamento da semana.', icon: '◎' },
  { title: 'Oportunidades', description: 'Clientes sem compra, mix ausente e potenciais de crescimento.', icon: '↗' },
  { title: 'Mercado Farma', description: 'Preços, estoques e distribuidores organizados por UF.', icon: '⌁' },
  { title: 'SIP / Redes', description: 'Grupos, redes, acessos e resultados consolidados.', icon: '⬡' },
  { title: 'Histórico', description: 'Comparativos mensais e evolução dos principais indicadores.', icon: '◫' },
  { title: 'Automações', description: 'Extrações do Bússola e Mercado Farma com status em tempo real.', icon: '⚙' },
  { title: 'Administração', description: 'Usuários, metas, produtos, permissões e configurações.', icon: '☷' },
]

const initialDashboard: DashboardData = {
  ol_sem_combate: 0,
  ol_prioritarios: 0,
  ol_lancamentos: 0,
  clientes_com_venda: 0,
  clientes_ativos: 0,
  consultores_ativos: 0,
  vendas_faturadas: 0,
  automacoes_executando: 0,
  atualizado_em: '',
}

const numberFormatter = new Intl.NumberFormat('pt-BR')

function App() {
  const [dashboard, setDashboard] = useState<DashboardData>(initialDashboard)
  const [databaseState, setDatabaseState] = useState<DatabaseState>('carregando')

  useEffect(() => {
    let active = true

    async function loadDashboard() {
      try {
        const [healthResponse, dashboardResponse] = await Promise.all([
          fetch('/api/health', { cache: 'no-store' }),
          fetch('/api/dashboard', { cache: 'no-store' }),
        ])

        if (!healthResponse.ok || !dashboardResponse.ok) {
          throw new Error('API indisponível')
        }

        const health = await healthResponse.json() as { database?: string }
        const data = await dashboardResponse.json() as DashboardData

        if (active) {
          setDashboard(data)
          setDatabaseState(health.database === 'ok' ? 'conectado' : 'erro')
        }
      } catch {
        if (active) {
          setDatabaseState('erro')
        }
      }
    }

    void loadDashboard()

    return () => {
      active = false
    }
  }, [])

  const statusText = databaseState === 'conectado'
    ? 'Banco conectado'
    : databaseState === 'erro'
      ? 'Falha ao conectar ao banco'
      : 'Conectando ao banco'

  const summary = useMemo(() => [
    { label: 'OL sem combate', value: numberFormatter.format(dashboard.ol_sem_combate), detail: statusText },
    { label: 'OL prioritários', value: numberFormatter.format(dashboard.ol_prioritarios), detail: statusText },
    { label: 'OL lançamentos', value: numberFormatter.format(dashboard.ol_lancamentos), detail: statusText },
    { label: 'Clientes com venda', value: numberFormatter.format(dashboard.clientes_com_venda), detail: statusText },
  ], [dashboard, statusText])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div>
            <strong>Painel Comercial</strong>
            <span>Equipe Norte</span>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="environment-badge">Nova versão</span>
          <button className="profile-button" type="button" aria-label="Perfil do usuário">MB</button>
        </div>
      </header>

      <main className="content">
        <section className="hero">
          <div>
            <span className="eyebrow">Gestão comercial</span>
            <h1>Bom dia, Maurício</h1>
            <p>Acompanhe a operação da Equipe Norte em um único lugar.</p>
          </div>
          <div className="hero-actions">
            <button className="secondary-button" type="button">Últimas atualizações</button>
            <button className="primary-button" type="button">Central de automações</button>
          </div>
        </section>

        <section className="filters" aria-label="Filtros do painel">
          <label>
            <span>Período</span>
            <select defaultValue="mes-atual">
              <option value="mes-atual">Mês atual</option>
              <option value="mes-anterior">Mês anterior</option>
              <option value="personalizado">Personalizado</option>
            </select>
          </label>
          <label>
            <span>Consultor</span>
            <select defaultValue="todos">
              <option value="todos">Todos os consultores</option>
            </select>
          </label>
          <label>
            <span>UF</span>
            <select defaultValue="todas">
              <option value="todas">Todas as UFs</option>
              <option>MA</option>
              <option>MT</option>
              <option>PA</option>
              <option>PI</option>
              <option>TO</option>
            </select>
          </label>
        </section>

        <section className="summary-grid" aria-label="Resumo de resultados">
          {summary.map((item) => (
            <article className="summary-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{databaseState === 'carregando' ? '—' : item.value}</strong>
              <small>{item.detail}</small>
            </article>
          ))}
        </section>

        <section className="section-heading">
          <div>
            <span className="eyebrow">Acesso rápido</span>
            <h2>Módulos do painel</h2>
          </div>
          <span className="development-note">{statusText}</span>
        </section>

        <section className="modules-grid">
          {modules.map((module) => (
            <button className="module-card" key={module.title} type="button">
              <div className="module-card-top">
                <span className="module-icon" aria-hidden="true">{module.icon}</span>
                {module.status && <span className="module-status">{module.status}</span>}
              </div>
              <div>
                <h3>{module.title}</h3>
                <p>{module.description}</p>
              </div>
              <span className="module-link">Abrir módulo <b>→</b></span>
            </button>
          ))}
        </section>
      </main>

      <footer>
        <span>Painel Comercial · Equipe Norte</span>
        <span>Versão SaaS em construção</span>
      </footer>
    </div>
  )
}

export default App
