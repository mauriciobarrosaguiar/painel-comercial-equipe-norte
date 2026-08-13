import { useEffect, useRef, useState } from 'react'
import OrderCrossingModule from './OrderCrossingModule'

type Saved = Record<string, { ean: string; produto: string }>
const STORAGE_KEY = 'painel_norte_cruzamento_aprendizado_v1'
const aliases: Array<[RegExp, string]> = [
  [/\bHCTZ\b/g, 'HIDROCLOROTIAZIDA'], [/\bCPR?\b|\bCOMP\b/g, 'COMPRIMIDO'], [/\bCAPS?\b/g, 'CAPSULA'],
  [/\bXPE\b/g, 'XAROPE'], [/\bGTS?\b/g, 'GOTAS'], [/\bSUSP\b/g, 'SUSPENSAO'], [/\bBG\b/g, 'BISNAGA'],
  [/\bPOT\b/g, 'POTASSICA'], [/\bCLOR\b/g, 'CLORIDRATO'], [/\bREV\b/g, 'REVESTIDO'],
]
const normalize = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/(\d),(\d)/g, '$1.$2').replace(/[^A-Z0-9.+/%]+/g, ' ').replace(/\s+/g, ' ').trim()
const canonical = (value: string) => aliases.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), normalize(value))

const seeds: Array<[string, string]> = [
  ['APIXABANA 25MG 20COMP', '7896004782690'],
  ['APIXABANA 25MG 60COMP', '7896004782713'],
  ['BISOPROLOL 25MG 30COMP', '7896004722177'],
  ['CARVEDILOL 625MG 30COMP', '7896004731285'],
  ['INDAPAMIDA 15MG 30COMP', '7896004728827'],
  ['INDAPAMIDA 15MG 30 COMP REV', '7896004728827'],
  ['LEVANLODIPINO 25MG 30COMP', '7896004796314'],
  ['ATENOLOL+CLORTALIDONA 50+125MG 30COMP', '7896004709130'],
  ['CLORTALIDONA 125MG 60COMP', '7896004706375'],
  ['IPRATROPIO 025MG/ML SOL INAL 20ML', '7896004725420'],
  ['CLOBETASOL 05MG/G CREME DERM 30G', '7896004712413'],
  ['OLMESARTANA+HIDROCLOROTIAZIDA 20+125MG 30COMP', '7896004750330'],
  ['Olmesartana + HCTZ 40/12', '7896004750347'],
  ['Olmesartana + HCTZ 40/25', '7896004750354'],
  ['Olmesartana + HCTZ 20/12,5', '7896004750330'],
  ['AZITROMICINA 1500MG PO SUSP 375ML', '7896004759678'],
  ['FEXOFENADINA 180MG 10 CPR', '7896004777559'],
  ['Cl Fexofenadina 120mg c/10', '7896004777535'],
  ['Cl Fexofenadina 180mg c/10', '7896004777559'],
  ['CLOR CICLOBENZAPR 10MG 10CP EMS-GENERICO', '7896004726908'],
  ['Cloridrato De Ciclobenzaprina 10mg c/15', '7896004730196'],
  ['CICLOBENZAPRINA 10MG 30COMP', '7896004730189'],
  ['CICLOBENZAPRINA 5MG 30COMP', '7896004730059'],
  ['LOSARTANA POT+HCTZ 50+12,5MG 30CPR EMS', '7896004713922'],
  ['LOSARTANA+HCTZ 100/25MG 30CP EMS-GENERICO', '7896004713915'],
  ['Losartana 50mg c/30 comp', '7896004706795'],
  ['DESLORATADINA XPE 0.5MG 100ML (E3S-G) EMS', '7896004769684'],
  ['Dipirona xarope', '7896004715674'],
  ['Dipirona Sodica 50mg 100ml Solucao', '7896004715674'],
  ['Acebrofilina adulto', '7896004710471'],
  ['Acebrofilina infantil', '7896004710464'],
  ['Orlistate c/42', '7896004737218'],
  ['Orlistate c/84', '7896004737225'],
  ['Duloxetina 60/30', '7896004747774'],
  ['Bilastina 15 comprimidos', '7896004784076'],
  ['Cetorolaco colírio', '7896004706900'],
  ['Clobetasol creme', '7896004712413'],
  ['Terbinafina creme', '7896004701035'],
  ['Timolol colírio', '7896004715711'],
  ['Nistatina + óxido de zinco', '7896004711195'],
  ['Bromoprida 10mg c/20', '7896004727882'],
  ['Fumarato De Quetiapina 100mg c/30', '7896004730370'],
  ['Paracetamol+Codeina 500mg+30mg c/12', '7896004756417'],
  ['BUDESONIDA 64MCG FR 120AP EMS GEN 4UNI', '7896004758275'],
]

function seedHistory() {
  try {
    const saved: Saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    let changed = false
    for (const [label, ean] of seeds) {
      const key = canonical(label)
      if (!saved[key]) { saved[key] = { ean, produto: '' }; changed = true }
    }
    if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch { /* armazenamento indisponível */ }
}

function marketUrl(input: RequestInfo | URL) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (!url.includes('/api/mercado-farma')) return null
  const parsed = new URL(url, window.location.origin)
  parsed.searchParams.delete('estoque')
  return parsed.toString()
}

function preferAvailable(rows: any[]) {
  const groups = new Map<string, any[]>()
  for (const row of rows || []) {
    const key = String(row?.ean || '')
    const list = groups.get(key) || []
    list.push(row); groups.set(key, list)
  }
  return [...groups.values()].flatMap(list => {
    const available = list.filter(row => Number(row?.estoque || 0) > 0)
    return available.length ? available : list
  })
}

export default function OrderCrossingHistoryBridge({ onBack }: { onBack: () => void }) {
  const original = useRef<typeof window.fetch | null>(null)
  const [ready] = useState(() => { seedHistory(); return true })
  if (!original.current && typeof window !== 'undefined') {
    original.current = window.fetch.bind(window)
    const baseFetch = original.current
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const rewritten = marketUrl(input)
      if (!rewritten) return baseFetch(input, init)
      const response = await baseFetch(rewritten, init)
      if (!response.ok) return response
      try {
        const data = await response.clone().json()
        data.resultados = preferAvailable(data.resultados || [])
        return new Response(JSON.stringify(data), { status: response.status, headers: { 'content-type': 'application/json; charset=UTF-8' } })
      } catch { return response }
    }) as typeof window.fetch
  }
  useEffect(() => () => { if (original.current) window.fetch = original.current }, [])
  return ready ? <OrderCrossingModule onBack={onBack} /> : null
}
