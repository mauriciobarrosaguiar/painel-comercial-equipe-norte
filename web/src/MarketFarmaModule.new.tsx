import { useEffect, useMemo, useRef, useState } from 'react'
import './operations.css'
import './market-phase4.css'

type Row = {
  uf: string
  ean: string
  produto: string
  distribuidora: string
  estoque: number
  desconto: number
  pf_distribuidora: number
  pf_fabrica: number
  preco_com_imposto: number
  preco_sem_imposto: number
  melhor_preco: number | null
  atualizado_em: string
}

type Data = {
  resumo: {
    registros: number
    produtos: number
    ufs: number
    distribuidoras: number
    com_estoque: number
    atualizado_em: string | null
  }
  resultados: Row[]
  filtros: { ufs: string[]; distribuidoras: string[] }
}

type ProductGroup = {
  key: string
  ean: string
  produto: string
  rows: Row[]
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')
const date = (value: string | null | undefined) => {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('pt-BR')
}
const discount = (value: number) => `${(Math.abs(value) <= 1 ? value * 100 : value).toFixed(2)}%`
const priceOrder = (row: Row) => row.preco_sem_imposto > 0 ? row.preco_sem_imposto : row.preco_com_imposto > 0 ? row.preco_com_imposto : Number.MAX_SAFE_INTEGER
const rowKey = (row: Row) => `${row.uf}|${row.distribuidora}|${row.preco_com_imposto}|${row.preco_sem_imposto}`
const distributorLabel = (row: Row) => {
  const name = row.distribuidora.trim() || 'Distribuidora não informada'
  return row.uf && !name.toUpperCase().includes(` ${row.uf}`) && !name.toUpperCase().includes(`-${row.uf}`) ? `${name} - ${row.uf}` : name
}

export default function MarketFarmaModule({ onBack, onAutomations }: { onBack: () => void; onAutomations: () => void }) {
  const [uf, setUf] = useState('')
  const [dist, setDist] = useState('')
  const [search, setSearch] = useState('')
  const [stock, setStock] = useState(false)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [queueing, setQueueing] = useState(false)
  const [reload, setReload] = useState(0)
  const [trackingStart, setTrackingStart] = useState(0)
  const [openBuybox, setOpenBuybox] = useState('')
  const [selectedRows, setSelectedRows] = useState<Record<string, string>>({})
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limite: '1000' })
        if (uf) params.set('uf', uf)
        if (dist) params.set('distribuidora', dist)
        if (search) params.set('busca', search)
        if (stock) params.set('estoque', '1')
        const response = await fetch(`/api/mercado-farma?${params}`, { cache: 'no-store', signal: controller.signal })
        const json = await response.json()
        if (!response.ok) throw new Error(json.detalhe || json.erro || 'Falha ao carregar Mercado Farma')
        setData(json)
        setError('')
        setOpenBuybox('')
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setLoading(false)
      }
    }, search ? 300 : 0)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [uf, dist, search, stock, reload])

  useEffect(() => {
    if (!trackingStart) return
    async function acompanhar() {
      try {
        const response = await fetch('/api/automacoes', { cache: 'no-store' })
        const json = await response.json()
        if (!response.ok) return
        const inicio = trackingStart - 60000
        const extracao = (json.extracoes || []).find((item: { tipo: string; criado_em: string }) => item.tipo === 'MERCADO_FARMA' && new Date(item.criado_em).getTime() >= inicio)
        const comando = (json.comandos || []).find((item: { tipo: string; solicitado_em: string }) => item.tipo === 'MERCADO_FARMA' && new Date(item.solicitado_em).getTime() >= inicio)
        if (extracao?.status === 'concluido') {
          setStatus('Atualizado')
          setQueueing(false)
          setTrackingStart(0)
          setReload(value => value + 1)
          return
        }
        if (extracao?.status === 'erro' || comando?.status === 'erro') {
          setError(extracao?.erro || comando?.erro || 'Falha na extração')
          setStatus('')
          setQueueing(false)
          setTrackingStart(0)
          return
        }
        setStatus(extracao?.status === 'executando' ? 'Extraindo…' : 'Iniciando…')
      } catch {
        // A próxima consulta atualiza o estado.
      }
    }
    void acompanhar()
    timerRef.current = window.setInterval(() => void acompanhar(), 8000)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [trackingStart])

  const groups = useMemo<ProductGroup[]>(() => {
    const map = new Map<string, ProductGroup>()
    for (const row of data?.resultados || []) {
      const key = row.ean || row.produto
      if (!map.has(key)) map.set(key, { key, ean: row.ean, produto: row.produto || `Produto ${row.ean}`, rows: [] })
      map.get(key)!.rows.push(row)
    }
    return [...map.values()].map(item => ({ ...item, rows: [...item.rows].sort((a, b) => priceOrder(a) - priceOrder(b)) }))
  }, [data])

  async function extract() {
    setQueueing(true)
    setError('')
    setStatus('Iniciando…')
    const inicio = Date.now()
    try {
      const response = await fetch('/api/automacoes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tipo: 'MERCADO_FARMA', parametros: { ufs: uf || 'MA,MT,PA,PI,TO' }, solicitado_por: 'Mercado Farma' }),
      })
      const json = await response.json()
      if (!response.ok && response.status !== 409) throw new Error(json.detalhe || json.erro || 'Não foi possível iniciar a atualização')
      setTrackingStart(inicio)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setStatus('')
      setQueueing(false)
    }
  }

  function changeQuantity(productKey: string, delta: number) {
    setQuantities(current => ({ ...current, [productKey]: Math.max(0, Math.min(99999, (current[productKey] || 0) + delta)) }))
  }

  function copyEan(ean: string) {
    if (!ean) return
    void navigator.clipboard?.writeText(ean)
  }

  const summary = data?.resumo
  return <main className="content operations-page">
    <button className="back-button" onClick={onBack}>← Voltar ao painel</button>
    <section className="operations-hero">
      <div><h1>Mercado Farma</h1></div>
      <div className="market-hero-actions">
        <button className="secondary-button" disabled={queueing} onClick={() => void extract()}>{queueing ? (status || 'Extraindo…') : 'Atualizar Mercado Farma'}</button>
        <a className="secondary-button market-download" href="/api/mercado-farma-excel" download="mercado-farma-por-estado.xlsx">Baixar em Excel</a>
      </div>
    </section>
    <section className="filters market-filters">
      <label><span>UF</span><select value={uf} onChange={(event: { target: { value: string } }) => setUf(event.target.value)}><option value="">Todas</option>{(data?.filtros.ufs || []).map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Distribuidora</span><select value={dist} onChange={(event: { target: { value: string } }) => setDist(event.target.value)}><option value="">Todas</option>{(data?.filtros.distribuidoras || []).map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Produto ou EAN</span><input value={search} onChange={(event: { target: { value: string } }) => setSearch(event.target.value)} /></label>
      <label className="stock-check"><input type="checkbox" checked={stock} onChange={(event: { target: { checked: boolean } }) => setStock(event.target.checked)} /><span>Com estoque</span></label>
    </section>
    {error && <div className="alert alert-error">{error}<button className="error-action" onClick={onAutomations}>Automações</button></div>}
    {status && !queueing && <div className="alert alert-success">{status}</div>}
    <section className="market-summary">
      <article><span>Produtos</span><strong>{loading ? '—' : num.format(summary?.produtos || 0)}</strong></article>
      <article><span>Registros</span><strong>{num.format(summary?.registros || 0)}</strong></article>
      <article><span>Com estoque</span><strong>{num.format(summary?.com_estoque || 0)}</strong></article>
      <article><span>Atualizado em</span><strong className="market-date">{date(summary?.atualizado_em)}</strong></article>
    </section>
    <section className="market-product-grid">
      {loading && <div className="operations-empty">Carregando…</div>}
      {!loading && !groups.length && <div className="operations-empty">Nenhum produto.</div>}
      {groups.map(product => {
        const selectedKey = selectedRows[product.key]
        const selected = product.rows.find(row => rowKey(row) === selectedKey) || product.rows[0]
        const quantity = quantities[product.key] || 0
        const total = quantity * (selected?.preco_com_imposto || selected?.preco_sem_imposto || 0)
        const menuOpen = openBuybox === product.key
        return <article className={`mef-product-card ${menuOpen ? 'is-open' : ''}`} key={product.key}>
          <div className="mef-card-top">
            <span className="mef-discount">{discount(selected?.desconto || 0)}</span>
            <button className="mef-info" type="button" title={`Atualizado em ${date(selected?.atualizado_em)}${selected?.uf ? ` · UF ${selected.uf}` : ''}`}>i</button>
          </div>
          <div className="mef-product-info">
            <h2>{product.produto}</h2>
            <div className="mef-brand-ean"><span>EMS Genéricos</span><button type="button" onClick={() => copyEan(product.ean)} title="Copiar EAN">{product.ean || 'EAN não informado'} <b>▣</b></button></div>
          </div>
          {selected && <div className="mef-buybox-wrap">
            <button className="mef-buybox" type="button" aria-expanded={menuOpen} onClick={() => setOpenBuybox(menuOpen ? '' : product.key)}>
              <span className="mef-buybox-distributor"><strong>{distributorLabel(selected)}</strong><small>{num.format(selected.estoque)} un. disponíveis</small></span>
              <span className="mef-buybox-price"><small>PF Dist.: {money.format(selected.pf_distribuidora || 0)}</small><b>{money.format(selected.preco_com_imposto || selected.preco_sem_imposto || 0)}</b><small>Sem imposto: {money.format(selected.preco_sem_imposto || 0)}</small></span>
              <span className="mef-chevron">⌄</span>
            </button>
            {menuOpen && <div className="mef-buybox-menu" role="listbox">
              {product.rows.map(row => {
                const active = rowKey(row) === rowKey(selected)
                return <button className={`mef-buybox-option ${active ? 'selected' : ''}`} type="button" role="option" aria-selected={active} key={rowKey(row)} onClick={() => { setSelectedRows(current => ({ ...current, [product.key]: rowKey(row) })); setOpenBuybox('') }}>
                  <span className="mef-option-main"><strong>{distributorLabel(row)}</strong><small>{num.format(row.estoque)} un. disponíveis</small>{active && <em>Distribuidor selecionado</em>}</span>
                  <span className="mef-option-price"><small>PF Dist.: {money.format(row.pf_distribuidora || 0)}</small><b>{money.format(row.preco_com_imposto || row.preco_sem_imposto || 0)}</b><small>Sem imposto: {money.format(row.preco_sem_imposto || 0)}</small></span>
                  <span className="mef-option-discount">{discount(row.desconto || 0)}</span>
                </button>
              })}
            </div>}
          </div>}
          <div className="mef-quantity" aria-label="Controles de quantidade">
            <button type="button" disabled={quantity === 0} onClick={() => changeQuantity(product.key, -1)}>−</button>
            <input aria-label="Quantidade" value={quantity} onChange={(event: { target: { value: string } }) => { const value = Number(event.target.value.replace(/\D/g, '')); setQuantities(current => ({ ...current, [product.key]: Math.max(0, Math.min(99999, value || 0)) })) }} />
            <button type="button" onClick={() => changeQuantity(product.key, 1)}>+</button>
          </div>
          <button className="mef-cart-total" type="button" disabled={quantity === 0}>🛒 {money.format(total)}</button>
        </article>
      })}
    </section>
  </main>
}
