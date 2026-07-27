import { useEffect, useMemo, useRef, useState } from 'react'
import './operations.css'
import './market-phase4.css'
import './market-cart.css'

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

type ClientOption = {
  cnpj: string
  nome: string
  cidade: string
  uf: string
  consultor: string
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
  clientes: ClientOption[]
  usuario: { nome: string; consultor_id: string; login: string } | null
}

type ProductGroup = {
  key: string
  ean: string
  produto: string
  rows: Row[]
}

type CartItem = {
  key: string
  ean: string
  produto: string
  quantidade: number
  selectedRowKey: string
  ofertas: Row[]
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
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
const digits = (value: string) => value.replace(/\D/g, '')
const itemOffer = (item: CartItem) => item.ofertas.find(row => rowKey(row) === item.selectedRowKey) || item.ofertas[0]
const itemPrice = (item: CartItem) => {
  const offer = itemOffer(item)
  return offer?.preco_com_imposto || offer?.preco_sem_imposto || 0
}

function matchesProduct(product: ProductGroup, query: string) {
  const tokens = normalize(query).split(' ').filter(Boolean)
  if (!tokens.length) return true
  const name = normalize(product.produto)
  const ean = digits(product.ean)
  return tokens.every(token => {
    const tokenDigits = digits(token)
    return tokenDigits ? name.includes(token) || ean.includes(tokenDigits) : name.includes(token)
  })
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
  const [clientCnpj, setClientCnpj] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [cartReady, setCartReady] = useState(false)
  const [exporting, setExporting] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ limite: '5000' })
        if (uf) params.set('uf', uf)
        if (dist) params.set('distribuidora', dist)
        if (search.trim()) params.set('busca', search.trim())
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
    }, search ? 250 : 0)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [uf, dist, search, stock, reload])

  const storageKey = data?.usuario?.login ? `mercado-farma-carrinho:${data.usuario.login}` : ''
  useEffect(() => {
    if (!storageKey) return
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
      setClientCnpj(String(saved.cliente_cnpj || ''))
      setCart(Array.isArray(saved.itens) ? saved.itens : [])
    } catch {
      setClientCnpj('')
      setCart([])
    } finally {
      setCartReady(true)
    }
  }, [storageKey])

  useEffect(() => {
    if (!storageKey || !cartReady) return
    localStorage.setItem(storageKey, JSON.stringify({ cliente_cnpj: clientCnpj, itens: cart }))
  }, [storageKey, cartReady, clientCnpj, cart])

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

  const allGroups = useMemo<ProductGroup[]>(() => {
    const map = new Map<string, ProductGroup>()
    for (const row of data?.resultados || []) {
      const key = row.ean || row.produto
      if (!map.has(key)) map.set(key, { key, ean: row.ean, produto: row.produto || `Produto ${row.ean}`, rows: [] })
      map.get(key)!.rows.push(row)
    }
    return [...map.values()].map(item => ({ ...item, rows: [...item.rows].sort((a, b) => priceOrder(a) - priceOrder(b)) }))
  }, [data])

  const groups = useMemo(() => allGroups.filter(product => matchesProduct(product, search)), [allGroups, search])
  const visibleRows = useMemo(() => groups.reduce((sum, group) => sum + group.rows.length, 0), [groups])
  const visibleStock = useMemo(() => groups.reduce((sum, group) => sum + group.rows.filter(row => row.estoque > 0).length, 0), [groups])
  const selectedClient = data?.clientes.find(client => client.cnpj === clientCnpj) || null

  const distributorTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const item of cart) {
      const offer = itemOffer(item)
      if (!offer) continue
      const label = distributorLabel(offer)
      totals.set(label, (totals.get(label) || 0) + itemPrice(item) * item.quantidade)
    }
    return [...totals.entries()].map(([distribuidora, valor]) => ({ distribuidora, valor })).sort((a, b) => b.valor - a.valor)
  }, [cart])
  const cartTotal = distributorTotals.reduce((sum, item) => sum + item.valor, 0)
  const cartUnits = cart.reduce((sum, item) => sum + item.quantidade, 0)

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

  function chooseClient(value: string) {
    if (cart.length && clientCnpj && value !== clientCnpj && !confirm('Trocar o cliente limpará o carrinho atual. Deseja continuar?')) return
    if (value !== clientCnpj) setCart([])
    setClientCnpj(value)
  }

  function addToCart(product: ProductGroup, selected: Row, quantity: number) {
    if (!clientCnpj) {
      setError('Selecione o CNPJ do cliente antes de adicionar produtos ao carrinho.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (quantity <= 0) return
    setCart(current => {
      const existing = current.find(item => item.key === product.key)
      if (existing) return current.map(item => item.key === product.key ? {
        ...item,
        quantidade: Math.min(99999, item.quantidade + quantity),
        selectedRowKey: rowKey(selected),
        ofertas: product.rows,
      } : item)
      return [...current, {
        key: product.key,
        ean: product.ean,
        produto: product.produto,
        quantidade: quantity,
        selectedRowKey: rowKey(selected),
        ofertas: product.rows,
      }]
    })
    setQuantities(current => ({ ...current, [product.key]: 0 }))
    setCartOpen(true)
    setError('')
  }

  function updateCartQuantity(key: string, value: number) {
    setCart(current => current.map(item => item.key === key ? { ...item, quantidade: Math.max(1, Math.min(99999, value)) } : item))
  }

  function updateCartDistributor(key: string, selectedRowKey: string) {
    setCart(current => current.map(item => item.key === key ? { ...item, selectedRowKey } : item))
  }

  async function exportCart() {
    if (!selectedClient || !cart.length) return
    setExporting(true)
    setError('')
    try {
      const response = await fetch('/api/mercado-farma-pedido-excel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cliente_cnpj: selectedClient.cnpj,
          itens: cart.map(item => {
            const offer = itemOffer(item)
            return {
              ean: item.ean,
              quantidade: item.quantidade,
              distribuidora: offer?.distribuidora,
              uf: offer?.uf,
            }
          }),
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const disposition = response.headers.get('content-disposition') || ''
      const name = disposition.match(/filename="([^"]+)"/)?.[1] || `pedido-mercado-farma-${selectedClient.cnpj}.xlsx`
      link.href = url
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setExporting(false)
    }
  }

  const summary = data?.resumo
  return <main className="content operations-page">
    <button className="back-button" onClick={onBack}>← Voltar ao painel</button>
    <section className="operations-hero">
      <div><h1>Mercado Farma</h1><p>Selecione o cliente, escolha a melhor distribuidora e monte o pedido.</p></div>
      <div className="market-hero-actions">
        <button className="market-cart-button" type="button" onClick={() => setCartOpen(true)}>🛒 Carrinho <b>{cartUnits}</b><span>{money.format(cartTotal)}</span></button>
        <button className="secondary-button" disabled={queueing} onClick={() => void extract()}>{queueing ? (status || 'Extraindo…') : 'Atualizar Mercado Farma'}</button>
        <a className="secondary-button market-download" href="/api/mercado-farma-excel" download="mercado-farma-por-estado.xlsx">Baixar em Excel</a>
      </div>
    </section>

    <section className="market-order-client">
      <label>
        <span>Cliente / CNPJ do pedido</span>
        <select value={clientCnpj} onChange={event => chooseClient(event.target.value)}>
          <option value="">Selecione um cliente da sua carteira</option>
          {(data?.clientes || []).map(client => <option key={client.cnpj} value={client.cnpj}>{client.nome} · {client.cnpj} · {client.cidade}/{client.uf}</option>)}
        </select>
      </label>
      {selectedClient && <div><strong>{selectedClient.nome}</strong><span>CNPJ {selectedClient.cnpj} · Consultor: {selectedClient.consultor || data?.usuario?.nome}</span></div>}
    </section>

    <section className="filters market-filters">
      <label><span>UF</span><select value={uf} onChange={(event: { target: { value: string } }) => setUf(event.target.value)}><option value="">Todas</option>{(data?.filtros.ufs || []).map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Distribuidora</span><select value={dist} onChange={(event: { target: { value: string } }) => setDist(event.target.value)}><option value="">Todas</option>{(data?.filtros.distribuidoras || []).map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Produto ou EAN</span><input value={search} placeholder="Ex.: Amitriptilina 75 ou EAN" onChange={(event: { target: { value: string } }) => setSearch(event.target.value)} /></label>
      <label className="stock-check"><input type="checkbox" checked={stock} onChange={(event: { target: { checked: boolean } }) => setStock(event.target.checked)} /><span>Com estoque</span></label>
    </section>
    {error && <div className="alert alert-error">{error}<button className="error-action" onClick={onAutomations}>Automações</button></div>}
    {status && !queueing && <div className="alert alert-success">{status}</div>}
    <section className="market-summary">
      <article><span>Produtos</span><strong>{loading ? '—' : num.format(groups.length)}</strong></article>
      <article><span>Registros</span><strong>{num.format(search ? visibleRows : summary?.registros || 0)}</strong></article>
      <article><span>Com estoque</span><strong>{num.format(search ? visibleStock : summary?.com_estoque || 0)}</strong></article>
      <article><span>Atualizado em</span><strong className="market-date">{date(summary?.atualizado_em)}</strong></article>
    </section>
    <section className="market-product-grid">
      {loading && <div className="operations-empty">Carregando…</div>}
      {!loading && !groups.length && <div className="operations-empty">Nenhum produto encontrado para “{search}”. Tente parte do nome, a dosagem ou o EAN.</div>}
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
          <button className="mef-cart-total" type="button" disabled={quantity === 0} onClick={() => addToCart(product, selected, quantity)}>🛒 {quantity ? `Adicionar · ${money.format(total)}` : money.format(0)}</button>
        </article>
      })}
    </section>

    {cartOpen && <div className="market-cart-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCartOpen(false) }}>
      <aside className="market-cart-drawer" role="dialog" aria-modal="true" aria-label="Carrinho do Mercado Farma">
        <header><div><span>PEDIDO MERCADO FARMA</span><h2>Carrinho</h2></div><button type="button" onClick={() => setCartOpen(false)}>×</button></header>
        <section className="market-cart-client">
          {selectedClient ? <><strong>{selectedClient.nome}</strong><span>CNPJ {selectedClient.cnpj}</span><span>Consultor: {selectedClient.consultor || data?.usuario?.nome}</span></> : <b>Selecione o cliente na página antes de montar o pedido.</b>}
        </section>
        <div className="market-cart-items">
          {!cart.length && <div className="market-cart-empty">O carrinho está vazio.</div>}
          {cart.map(item => {
            const offer = itemOffer(item)
            return <article key={item.key} className="market-cart-item">
              <div className="market-cart-item-title"><div><strong>{item.produto}</strong><span>EAN {item.ean}</span></div><button type="button" onClick={() => setCart(current => current.filter(currentItem => currentItem.key !== item.key))}>Excluir</button></div>
              <label><span>Distribuidora escolhida</span><select value={item.selectedRowKey} onChange={event => updateCartDistributor(item.key, event.target.value)}>{item.ofertas.map(row => <option key={rowKey(row)} value={rowKey(row)}>{distributorLabel(row)} · {money.format(row.preco_com_imposto || row.preco_sem_imposto || 0)} · estoque {num.format(row.estoque)}</option>)}</select></label>
              <div className="market-cart-item-values"><label><span>Quantidade</span><input type="number" min="1" max="99999" value={item.quantidade} onChange={event => updateCartQuantity(item.key, Number(event.target.value || 1))} /></label><div><span>Preço unitário</span><b>{money.format(itemPrice(item))}</b></div><div><span>Total</span><strong>{money.format(itemPrice(item) * item.quantidade)}</strong></div></div>
              {offer && <small>{num.format(offer.estoque)} unidades disponíveis na oferta selecionada.</small>}
            </article>
          })}
        </div>
        {!!cart.length && <section className="market-distributor-totals"><h3>Valor a faturar por distribuidora</h3>{distributorTotals.map(item => <div key={item.distribuidora}><span>{item.distribuidora}</span><b>{money.format(item.valor)}</b></div>)}<div className="market-cart-grand-total"><span>Total do pedido</span><strong>{money.format(cartTotal)}</strong></div></section>}
        <footer><button type="button" className="market-cart-clear" disabled={!cart.length} onClick={() => { if (confirm('Limpar todos os produtos do carrinho?')) setCart([]) }}>Limpar carrinho</button><button type="button" className="primary-action" disabled={!selectedClient || !cart.length || exporting} onClick={() => void exportCart()}>{exporting ? 'Gerando Excel…' : 'Extrair pedido em Excel'}</button></footer>
      </aside>
    </div>}
  </main>
}
