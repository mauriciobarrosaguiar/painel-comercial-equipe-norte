import { useEffect, useState } from 'react'

type Product = { id: string; ean: string; produto: string; tipo_mix: string }
type Offer = { ean: string; uf: string; distribuidora: string; preco: number; estoque: number; atualizado_em: string | null }
type Client = { id: string; cnpj: string; uf: string }
type Data = { cliente: Client; ofertas: Offer[] }
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default function ClientMixOpportunities({ cliente, produtos, onOpenMarket }: {
  cliente: Client; produtos: Product[]; onOpenMarket: () => void
}) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [distributors, setDistributors] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string[]>([])
  const eans = [...new Set(produtos.map(item => item.ean).filter(ean => /^\d{1,14}$/.test(ean)))].join(',')
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setData(null); setError('')
    fetch(`/api/clientes/ofertas?${new URLSearchParams({ id: cliente.id, eans })}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.erro || 'Não foi possível consultar os preços.')
        if (body.cliente?.id !== cliente.id || !Array.isArray(body.ofertas)) throw new Error('Resposta de preços inválida.')
        return body as Data
      }).then(setData)
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Falha na consulta de preços.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [cliente.id, eans, retry])

  const quantity = (ean: string) => quantities[ean] || 1
  const offersFor = (ean: string) => (data?.ofertas || []).filter(offer => offer.ean === ean
    && offer.uf === data?.cliente.uf && offer.preco > 0 && offer.estoque >= 1)
  const offerFor = (ean: string) => {
    const offers = offersFor(ean)
    return offers.find(offer => offer.distribuidora === distributors[ean])
      || offers.find(offer => offer.estoque >= quantity(ean)) || offers[0]
  }
  const available = (ean: string) => {
    const offer = offerFor(ean)
    return Boolean(!loading && data && offer && offer.estoque >= quantity(ean))
  }
  function addToCart(requested: Product[]) {
    const items = [...new Map(requested.map(item => [item.ean, item])).values()]
    if (!data || !items.length) return
    if (items.some(item => !available(item.ean))) { setError('Revise os itens: há produtos sem oferta ou sem estoque para a quantidade informada.'); return }
    try {
      sessionStorage.setItem('mercado-farma-importacao-proposta', JSON.stringify({
        criado_em: Date.now(), cliente_cnpj: data.cliente.cnpj, uf: data.cliente.uf,
        itens: items.map(item => ({ ean: item.ean, quantidade: quantity(item.ean), distribuidora: offerFor(item.ean)!.distribuidora, preco_referencia: offerFor(item.ean)!.preco })),
      }))
      onOpenMarket()
    } catch { setError('Não foi possível preparar o carrinho. Verifique se o armazenamento do navegador está disponível.') }
  }
  return <section className="detail-section client-mix-opportunities">
    <h3>Oportunidades de mix</h3>
    <p>Preços e estoque da última extração para <b>{data?.cliente.uf || cliente.uf || 'a UF do cliente'}</b>. Escolha a quantidade e a distribuidora para adicionar ao carrinho.</p>
    {loading && <p role="status">Consultando preços para a UF do cliente…</p>}
    {error && <div className="client-rec-warning" role="alert">{error} <button className="outline-button" type="button" onClick={() => setRetry(value => value + 1)}>Consultar novamente</button></div>}
    {!produtos.length && <p>Nenhum prioritário ou lançamento ausente.</p>}
    <div className="client-mix-items">{produtos.map(item => {
      const offers = offersFor(item.ean), offer = offerFor(item.ean)
      const canAdd = available(item.ean)
      return <article className="client-mix-item" key={item.id}>
        <div className="client-mix-title"><input type="checkbox" aria-label={`Selecionar ${item.produto}`} disabled={!canAdd} checked={selected.includes(item.ean)} onChange={event => setSelected(values => event.target.checked ? [...values, item.ean] : values.filter(ean => ean !== item.ean))} /><div><strong>{item.produto}</strong><small>EAN {item.ean || 'não cadastrado'} · {item.tipo_mix}</small></div></div>
        <div className="client-mix-fields">
          <label>Distribuidora · {data?.cliente.uf || cliente.uf}<select aria-label={`Distribuidora de ${item.produto}`} value={offer?.distribuidora || ''} disabled={!offers.length || loading} onChange={event => setDistributors(values => ({ ...values, [item.ean]: event.target.value }))}>
            {!offers.length && <option value="">{loading ? 'Consultando…' : 'Sem oferta disponível nesta UF'}</option>}
            {offers.map(option => <option key={option.distribuidora} value={option.distribuidora}>{option.distribuidora} · {money.format(option.preco)} · estoque {option.estoque}</option>)}
          </select></label>
          <label>Quantidade<input aria-label={`Quantidade de ${item.produto}`} type="number" min="1" max="99999" step="1" value={quantity(item.ean)} onChange={event => setQuantities(values => ({ ...values, [item.ean]: Math.max(1, Math.min(99999, Math.floor(Number(event.target.value) || 1))) }))} /></label>
        </div>
        <div className="client-mix-price"><div><small>Preço unitário</small><strong>{offer ? money.format(offer.preco) : 'Indisponível'}</strong>{offer && <small>Total: {money.format(offer.preco * quantity(item.ean))} · Estoque: {offer.estoque}</small>}</div>
          <button type="button" className="primary-action" disabled={!canAdd} onClick={() => addToCart([item])}>Adicionar ao carrinho</button></div>
        {offer && <small className="client-mix-date">Extração: {offer.atualizado_em ? new Date(offer.atualizado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'data não informada'}{!canAdd ? ' · Estoque insuficiente para esta quantidade' : ''}</small>}
      </article>
    })}</div>
    {!!produtos.length && <div className="client-mix-footer"><span>{selected.length} selecionado(s)</span><button type="button" className="primary-action" disabled={!selected.length || loading || !data || selected.some(ean => !available(ean))} onClick={() => addToCart(produtos.filter(item => selected.includes(item.ean)))}>Adicionar selecionados ao carrinho</button></div>}
  </section>
}
