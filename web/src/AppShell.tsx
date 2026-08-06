import { useEffect, useState } from 'react'
import App from './App'
import AutomationsModule from './AutomationsModule'
import ClientsModule from './ClientsModule'
import DashboardSeparatorShortcut from './DashboardSeparatorShortcut'
import FocusModule from './FocusModule'
import HistoryModule from './HistoryModule'
import LoginPage, { SessionUser } from './LoginPage'
import MarketFarmaModule from './MarketFarmaModule.new'
import OrderSeparatorModule from './OrderSeparatorModule'
import { AppPage, readPageFromUrl, savePageInHistory } from './navigation'
import OpportunitiesModule from './OpportunitiesModule'
import SipsModule from './SipsModule'

type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}

const corePages = new Set<AppPage>(['dashboard', 'administracao', 'consultores'])
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2)
  .map((item) => item[0]).join('').toUpperCase() || 'N'

export default function AppShell() {
  const publicSip = new URLSearchParams(window.location.search).get('sip') || ''
  const [user, setUser] = useState<SessionUser | null>(null)
  const [checking, setChecking] = useState(!publicSip)
  const [install, setInstall] = useState<InstallEvent | null>(null)
  const [page, setPage] = useState<AppPage>(() => publicSip ? 'sips' : readPageFromUrl())

  useEffect(() => {
    if (publicSip) return
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setUser((await response.json()).usuario)
      })
      .catch(() => setUser(null))
      .finally(() => setChecking(false))
  }, [publicSip])

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      setInstall(event as InstallEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    if (publicSip) return
    const restorePage = () => {
      setPage(readPageFromUrl())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('popstate', restorePage)
    return () => window.removeEventListener('popstate', restorePage)
  }, [publicSip])

  const installApp = async () => {
    if (install) {
      await install.prompt()
      await install.userChoice
      setInstall(null)
      return
    }
    alert('No celular, abra o menu do navegador e escolha “Adicionar à tela inicial” ou “Instalar aplicativo”.')
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
    setUser(null)
    setPage('dashboard')
    savePageInHistory('dashboard', true)
  }

  const go = (nextPage: AppPage) => {
    if (nextPage !== page) savePageInHistory(nextPage)
    setPage(nextPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (publicSip) {
    return (
      <div className="app-shell public-sip-shell">
        <SipsModule onBack={() => window.location.assign(window.location.pathname)} publicId={publicSip} />
        <footer><span>Painel Comercial · Equipe Norte</span><span>Acompanhamento SIP</span></footer>
      </div>
    )
  }
  if (checking) {
    return <main className="login-page"><div className="login-card"><strong>Carregando acesso…</strong></div></main>
  }
  if (!user) return <LoginPage onLogin={setUser} />

  if (corePages.has(page)) {
    return (
      <>
        <App
          user={user}
          page={page as 'dashboard' | 'administracao' | 'consultores'}
          onNavigate={go}
          onLogout={() => void logout()}
          onInstall={() => void installApp()}
        />
        {page === 'dashboard' && <DashboardSeparatorShortcut onOpen={() => go('separador')} />}
      </>
    )
  }

  const back = () => go('dashboard')
  let module = <ClientsModule onBack={back} />
  if (page === 'oportunidades') module = <OpportunitiesModule onBack={back} />
  if (page === 'sips') module = <SipsModule onBack={back} />
  if (page === 'mercado') module = <MarketFarmaModule onBack={back} onAutomations={() => go('automacoes')} />
  if (page === 'separador') module = <OrderSeparatorModule onBack={back} />
  if (page === 'automacoes') module = <AutomationsModule onBack={back} />
  if (page === 'historico') module = <HistoryModule onBack={back} onAutomations={() => go('automacoes')} />
  if (page === 'foco') module = <FocusModule onBack={back} />
  const exportType = page === 'clientes' ? 'clientes' : page === 'oportunidades' ? 'oportunidades' : ''

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={back}>
          <div className="brand-mark">N</div>
          <div><strong>Painel Comercial</strong><span>Equipe Norte</span></div>
        </button>
        <div className="topbar-actions">
          {exportType && (
            <a className="topbar-download" href={`/api/exportar?tipo=${exportType}&formato=csv`}>
              Extrair base
            </a>
          )}
          <button className="topbar-download topbar-install" type="button" onClick={() => void installApp()}>
            Baixar app
          </button>
          <span className="environment-badge">{user.nome}</span>
          <span className="profile-button" aria-hidden="true">{initials(user.nome)}</span>
          <button className="topbar-logout" type="button" onClick={() => void logout()}>Sair</button>
        </div>
      </header>
      {module}
      <footer><span>Painel Comercial · Equipe Norte</span><span>Módulo ativo</span></footer>
    </div>
  )
}
