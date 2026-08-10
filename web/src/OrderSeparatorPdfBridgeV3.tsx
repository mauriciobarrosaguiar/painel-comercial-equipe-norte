import { useEffect } from 'react'
import OrderSeparatorPdfBridgeV2 from './OrderSeparatorPdfBridgeV2'

function selectedUfFromPanel() {
  const active = document.querySelector<HTMLElement>('.separator-state-list button.active span')?.textContent?.trim().toUpperCase() || ''
  if (/^[A-Z]{2}$/.test(active)) return active

  const modeText = document.querySelector<HTMLElement>('.separator-rule-top label span')?.textContent || ''
  const match = modeText.match(/\b(?:para|estado)\s+([A-Z]{2})\b/i)
  return match?.[1]?.toUpperCase() || ''
}

function addSelectedUfToAnalysis(init: RequestInit | undefined) {
  if (!init?.body || typeof init.body !== 'string') return init

  try {
    const body = JSON.parse(init.body)
    if (!Array.isArray(body?.headers) || !Array.isArray(body?.rows) || !body?.mapping) return init

    const selectedUf = selectedUfFromPanel()
    if (!selectedUf) return init

    const headers = [...body.headers]
    const rows = body.rows.map((row: unknown) => Array.isArray(row) ? [...row] : row)
    let ufIndex = Number.isInteger(Number(body.mapping.uf)) ? Number(body.mapping.uf) : -1

    const hasUfInSpreadsheet = ufIndex >= 0 && rows.some((row: unknown) => {
      if (!Array.isArray(row)) return false
      return /^[A-Z]{2}$/.test(String(row[ufIndex] ?? '').trim().toUpperCase())
    })

    if (hasUfInSpreadsheet) return init

    if (ufIndex < 0) {
      ufIndex = headers.length
      headers.push('UF / Estado')
      for (const row of rows) if (Array.isArray(row)) row.push(selectedUf)
    } else {
      for (const row of rows) {
        if (!Array.isArray(row)) continue
        row[ufIndex] = selectedUf
      }
    }

    const nextBody = {
      ...body,
      headers,
      rows,
      mapping: { ...body.mapping, uf: ufIndex },
      uf_selecionada_no_painel: selectedUf,
    }

    return { ...init, body: JSON.stringify(nextBody) }
  } catch {
    return init
  }
}

function UfFallbackInterceptor() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window)

    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/api/separador-pedidos-analisar') && String(init?.method || 'GET').toUpperCase() === 'POST') {
        return originalFetch(input, addSelectedUfToAnalysis(init))
      }
      return originalFetch(input, init)
    }) as typeof window.fetch

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return null
}

export default function OrderSeparatorPdfBridgeV3({ onBack }: { onBack: () => void }) {
  return (
    <>
      <OrderSeparatorPdfBridgeV2 onBack={onBack} />
      <UfFallbackInterceptor />
    </>
  )
}
