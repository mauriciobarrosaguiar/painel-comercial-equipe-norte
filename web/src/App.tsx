type ModuleCard = {
  title: string
  description: string
  icon: string
  status?: string
}

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

const summary = [
  { label: 'OL sem combate', value: '—', detail: 'Aguardando banco de dados' },
  { label: 'OL prioritários', value: '—', detail: 'Aguardando banco de dados' },
  { label: 'OL lançamentos', value: '—', detail: 'Aguardando banco de dados' },
  { label: 'Clientes com venda', value: '—', detail: 'Aguardando banco de dados' },
]

function App() {
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
              <strong>{item.value}</strong>
              <small>{item.detail}</small>
            </article>
          ))}
        </section>

        <section className="section-heading">
          <div>
            <span className="eyebrow">Acesso rápido</span>
            <h2>Módulos do painel</h2>
          </div>
          <span className="development-note">Interface inicial em desenvolvimento</span>
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
