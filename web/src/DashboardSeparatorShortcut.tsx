import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export default function DashboardSeparatorShortcut({ onOpen }: { onOpen: () => void }) {
  const [target, setTarget] = useState<Element | null>(null)
  useEffect(() => {
    const locate = () => setTarget(document.querySelector('.modules-grid'))
    locate()
    const observer = new MutationObserver(locate)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  if (!target) return null
  return createPortal(
    <button className="module-card separator-dashboard-card" type="button" onClick={onOpen}>
      <div className="module-card-top">
        <span className="module-icon">✓</span>
        <span className="module-status">Novo</span>
      </div>
      <div>
        <h3>Separador de Pedidos</h3>
        <p>Importe a planilha e separe os pedidos por CNPJ, estado, estoque, prioridade e pedido mínimo.</p>
      </div>
      <span className="module-link">Abrir módulo <b>→</b></span>
    </button>,
    target,
  )
}
