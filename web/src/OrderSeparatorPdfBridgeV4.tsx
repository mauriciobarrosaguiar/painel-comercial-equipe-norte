import { useEffect } from 'react'
import OrderSeparatorPdfBridgeV3 from './OrderSeparatorPdfBridgeV3'

const OPTIONAL_CNPJ_VALUE = '99999'

function findCnpjRow() {
  return [...document.querySelectorAll<HTMLTableRowElement>('.separator-map-table tbody tr')]
    .find(row => row.querySelector('td')?.textContent?.trim().toUpperCase().startsWith('CNPJ')) || null
}

function ensureOptionalCnpj() {
  const row = findCnpjRow()
  if (!row) return

  const select = row.querySelector<HTMLSelectElement>('select')
  if (!select) return

  let option = [...select.options].find(item => item.value === OPTIONAL_CNPJ_VALUE)
  if (!option) {
    option = document.createElement('option')
    option.value = OPTIONAL_CNPJ_VALUE
    option.textContent = 'Sem CNPJ (pedido único)'
    select.appendChild(option)
  }

  const marker = row.querySelector<HTMLElement>('em')
  if (marker) marker.textContent = 'Opcional'

  if (select.value === '-1' || select.value === '' || select.selectedIndex < 0) {
    select.value = OPTIONAL_CNPJ_VALUE
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const tip = document.querySelector<HTMLElement>('.separator-tip')
  if (tip?.textContent?.includes('a planilha precisa conter CNPJ')) {
    tip.innerHTML = '<b>Importante:</b> EAN e quantidade são obrigatórios. CNPJ, produto, unidade e UF podem ser informados quando existirem.'
  }
}

function optionalCnpjRequest(input: RequestInfo | URL) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (!url.includes('/api/separador-pedidos-analisar') || url.includes('/api/separador-pedidos-analisar-v2')) return input

  const nextUrl = url.replace('/api/separador-pedidos-analisar', '/api/separador-pedidos-analisar-v2')
  if (typeof input === 'string') return nextUrl
  if (input instanceof URL) return new URL(nextUrl)
  return new Request(nextUrl, input)
}

function OptionalCnpjInterceptor() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => originalFetch(optionalCnpjRequest(input), init)) as typeof window.fetch

    const observer = new MutationObserver(() => ensureOptionalCnpj())
    observer.observe(document.body, { childList: true, subtree: true })
    ensureOptionalCnpj()

    const beforeClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null
      if (target?.textContent?.includes('Confirmar e continuar')) ensureOptionalCnpj()
    }
    document.addEventListener('click', beforeClick, true)

    return () => {
      window.fetch = originalFetch
      observer.disconnect()
      document.removeEventListener('click', beforeClick, true)
    }
  }, [])

  return null
}

export default function OrderSeparatorPdfBridgeV4({ onBack }: { onBack: () => void }) {
  return (
    <>
      <OrderSeparatorPdfBridgeV3 onBack={onBack} />
      <OptionalCnpjInterceptor />
    </>
  )
}
