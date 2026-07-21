import React from 'react'
import ReactDOM from 'react-dom/client'
import AppShell from './AppShell'
import './styles.css'
import './focus.css'
import './focus-history.css'
import './phase4-responsive.css'
import './automation-phase4.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined))
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
)
