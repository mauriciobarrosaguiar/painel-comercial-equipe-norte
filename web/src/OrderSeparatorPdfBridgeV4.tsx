import { useEffect } from 'react'
import OrderSeparatorPdfBridgeV3 from './OrderSeparatorPdfBridgeV3'

function findMappingRow(label: string) {
  const normalized = label.trim().toUpperCase()
  return [...document.querySelectorAll<HTMLTableRowElement>('.separator-map-table tbody tr')]
    .find(row => row.querySelector('td')?.textContent?.trim().toUpperCase().startsWith(normalized)) || null
}

function decorateOptionalCnpj() {
  const row = findMappingRow('CNPJ')
  if (!row) return

  const marker = row.querySelector<HTMLElement>('em')
  if (marker && marker.textContent !== 'Opcional') marker.textContent = 'Opcional'

  const tip = document.querySelector<HTMLElement>('.separator-tip')
  if (tip?.textContent?.includes('a planilha precisa conter CNPJ')) {
    tip.innerHTML = '<b>Importante:</b> EAN e quantidade são obrigatórios. CNPJ, produto, unidade e UF podem ser informados quando existirem.'
  }
}

function rewriteAnalysisRequest(input: RequestInfo | URL, init: RequestInit | undefined, cnpjOmitted: boolean) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (!url.includes('/api/separador-pedidos-analisar') || url.includes('/api/separador-pedidos-analisar-v2')) {
    return { input, init }
  }

  const nextUrl = url.replace('/api/separador-pedidos-analisar', '/api/separador-pedidos-analisar-v2')
  let nextInput: RequestInfo | URL = input
  if (typeof input === 'string') nextInput = nextUrl
  else if (input instanceof URL) nextInput = new URL(nextUrl)
  else nextInput = new Request(nextUrl, input)

  if (!cnpjOmitted || !init?.body || typeof init.body !== 'string') return { input: nextInput, init }

  try {
    const body = JSON.parse(init.body)
    if (body?.mapping) body.mapping = { ...body.mapping, cnpj: -1 }
    return { input: nextInput, init: { ...init, body: JSON.stringify(body) } }
  } catch {
    return { input: nextInput, init }
  }
}

function OptionalCnpjInterceptor() {
  useEffect(() => {
    let cnpjOmitted = false
    let retryingConfirm = false
    const originalFetch = window.fetch.bind(window)

    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const rewritten = rewriteAnalysisRequest(input, init, cnpjOmitted)
      return originalFetch(rewritten.input, rewritten.init)
    }) as typeof window.fetch

    let scheduled = false
    const scheduleDecoration = () => {
      if (scheduled) return
      scheduled = true
      window.requestAnimationFrame(() => {
        scheduled = false
        decorateOptionalCnpj()
      })
    }

    const observer = new MutationObserver(scheduleDecoration)
    observer.observe(document.body, { childList: true, subtree: true })
    decorateOptionalCnpj()

    const beforeClick = (event: Event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null
      if (!button) return

      if (button.textContent?.includes('Nova análise')) {
        cnpjOmitted = false
        retryingConfirm = false
        return
      }

      if (!button.textContent?.includes('Confirmar e continuar') || retryingConfirm) return

      const cnpjSelect = findMappingRow('CNPJ')?.querySelector<HTMLSelectElement>('select')
      if (!cnpjSelect || (cnpjSelect.value !== '-1' && cnpjSelect.value !== '')) {
        cnpjOmitted = false
        return
      }

      // O componente original ainda valida se CNPJ possui um índice de coluna.
      // Para permitir planilha sem CNPJ sem alterar os dados, usamos temporariamente
      // o índice da Quantidade apenas para ultrapassar a validação da tela. Antes da
      // requisição o interceptor restaura mapping.cnpj = -1, e a API V2 trata o pedido
      // corretamente como SEM CNPJ.
      const quantitySelect = findMappingRow('QUANTIDADE')?.querySelector<HTMLSelectElement>('select')
      const temporaryIndex = quantitySelect?.value || ''
      if (!temporaryIndex || temporaryIndex === '-1') return

      event.preventDefault()
      event.stopPropagation()
      cnpjOmitted = true
      retryingConfirm = true
      cnpjSelect.value = temporaryIndex
      cnpjSelect.dispatchEvent(new Event('change', { bubbles: true }))

      window.setTimeout(() => {
        retryingConfirm = false
        button.click()
      }, 0)
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
