import { useEffect, useMemo, useState } from 'react'
import './clients.css'

type PeriodOption = 'mes-atual' | 'mes-anterior' | 'todo-periodo' | 'personalizado'
type ClientRow = {
  id: string; cnpj: string; nome: string; cidade: string; uf: string; gd: string; consultor: string
  faturamento_atual: number; faturamento_anterior: number; variacao_percentual: number; pedidos_atual: number
  ticket_medio: number; produtos_comprados: number; produtos_prioritarios: number; produtos_lancamentos: number
  ultima_compra: string | null; dias_sem_comprar: number | null; prioridade: string; motivo_prioridade: string
}
type ClientResponse = {
  periodo: { tipo: string; inicio: string | null; fim: string | null; rotulo: string }
  resumo: { clientes_ativos: number; clientes_com_venda: number; clientes_sem_venda: number; cobertura_percentual: number; faturamento_total: number; pedidos_faturados: number; ticket_medio_cliente: number; prioridades: Record<string, number> }
  paginacao: { pagina: number; limite: number; total: number; paginas: number }
  clientes: ClientRow[]
  filtros: { consultores: Array<{ id: string; nome: string }>; ufs: string[]; cidades: string[] }
  atualizado_em: string | null
}
type ClientDetail = {
  cliente: ClientRow & { grupo_economico?: string; rede_associacao?: string; bandeira?: string; situacao?: string }
  resumo: { faturamento: number; pedidos: number; produtos: number; ultima_compra: string | null; prioritarios: number; lancamentos: number; ticket_medio: number }
  historico: Array<{ ano_mes: string; faturamento: number; pedidos: number; produtos: number }>
  produtos: Array<{ produto: string; ean: string; tipo_mix: string; faturamento: number; quantidade: number; pedidos: number }>
  pedidos: Array<{ id: string; pedido_origem: string; nota_fiscal: string; status: string; data: string; valor: number; itens: number }>
  oportunidades: Array<{ id: string; ean: string; produto: string; tipo_mix: string }>
}
type Props = { onBack: () => void }

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const integer = new Intl.NumberFormat('pt-BR')
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function monthBounds(offset: number) {
  const now = new Date()
  return { inicio: localDate(new Date(now.getFullYear(), now.getMonth() + offset, 1)), fim: localDate(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)) }
}
function formatDate(value?: string | null) {
  if (!value) return 'Sem compra registrada'
  const [year, month, day] = value.slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}
function priorityLabel(value: string) {
  return value === 'CRITICA' ? 'Crítica' : value === 'ALTA' ? 'Alta' : value === 'MEDIA' ? 'Média' : value === 'BAIXA' ? 'Baixa' : 'Novo'
}

export default function ClientsModule({ onBack }: Props) {
  const currentMonth = monthBounds(0)
  const [period, setPeriod] = useState<PeriodOption>('mes-atual')
  const [customStart, setCustomStart] = useState(currentMonth.inicio)
  const [customEnd, setCustomEnd] = useState(currentMonth.fim)
  const [consultant, setConsultant] = useState('')
  const [uf, setUf] = useState('')
  const [city, setCity] = useState('')
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState('')
  const [sort, setSort] = useState('prioridade')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ClientResponse | null>(null)
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')

  const selectedPeriod = useMemo(() => {
    if (period === 'mes-atual') return monthBounds(0)
    if (period === 'mes-anterior') return monthBounds(-1)
    if (period === 'personalizado') return { inicio: customStart, fim: customEnd }
    return { inicio: '', fim: '' }
  }, [period, customStart, customEnd])

  useEffect(() => { setPage(1) }, [period, customStart, customEnd, consultant, uf, city, search, priority, sort])

  useEffect(() => {
    if (period === 'personalizado' && (!customStart || !customEnd)) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('')
      try {
        const params = new URLSearchParams({ periodo: period, pagina: String(page), limite: '100', ordenar: sort })
        if (selectedPeriod.inicio && selectedPeriod.fim) { params.set('inicio', selectedPeriod.inicio); params.set('fim', selectedPeriod.fim) }
        if (consultant) params.set('consultor', consultant)
        if (uf) params.set('uf', uf)
        if (city) params.set('cidade', city)
        if (search) params.set('busca', search)
        if (priority) params.set('prioridade', priority)
        const response = await fetch(`/api/clientes?${params}`, { cache: 'no-store', signal: controller.signal })
        const result = await response.json() as ClientResponse & { erro?: string; detalhe?: string }
        if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível carregar os clientes.')
        setData(result)
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally { setLoading(false) }
    }, search ? 350 : 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [period, customStart, customEnd, selectedPeriod.inicio, selectedPeriod.fim, consultant, uf, city, search, priority, sort, page])

  async function openDetail(client: ClientRow) {
    setDetailLoading(true); setDetail(null); setError('')
    try {
      const params = new URLSearchParams({ id: client.id })
      if (selectedPeriod.inicio && selectedPeriod.fim) { params.set('inicio', selectedPeriod.inicio); params.set('fim', selectedPeriod.fim) }
      const response = await fetch(`/api/clientes/detalhe?${params}`, { cache: 'no-store' })
      const result = await response.json() as ClientDetail & { erro?: string; detalhe?: string }
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível abrir a ficha do cliente.')
      setDetail(result)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setDetailLoading(false) }
  }

  const resumo = data?.resumo
  const maxHistory = Math.max(1, ...(detail?.historico || []).map((item) => item.faturamento))

  return <main className="content clients-page">
    <button className="back-button" type="button" onClick={onBack}>← Voltar ao painel</button>
    <section className="clients-hero"><div><span className="eyebrow">Carteira comercial</span><h1>Clientes</h1><p>Positivação, faturamento, queda, dias sem comprar e prioridade de atendimento.</p></div><span className="clients-period">{data?.periodo.rotulo || 'Carregando período…'}</span></section>

    <section className="filters clients-filters" aria-label="Filtros dos clientes">
      <label><span>Período</span><select value={period} onChange={(event) => setPeriod(event.target.value as PeriodOption)}><option value="mes-atual">Mês atual</option><option value="mes-anterior">Mês anterior</option><option value="todo-periodo">Todo o período</option><option value="personalizado">Personalizado</option></select></label>
      <label><span>Consultor</span><select value={consultant} onChange={(event) => setConsultant(event.target.value)}><option value="">Todos</option>{(data?.filtros.consultores || []).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
      <label><span>UF</span><select value={uf} onChange={(event) => { setUf(event.target.value); setCity('') }}><option value="">Todas</option>{(data?.filtros.ufs || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Cidade</span><select value={city} onChange={(event) => setCity(event.target.value)}><option value="">Todas</option>{(data?.filtros.cidades || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Prioridade</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="">Todas</option><option value="CRITICA">Crítica</option><option value="ALTA">Alta</option><option value="MEDIA">Média</option><option value="BAIXA">Baixa</option><option value="NOVO">Novo</option></select></label>
      <label><span>Ordenar</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="prioridade">Maior prioridade</option><option value="dias_sem_comprar">Mais dias sem comprar</option><option value="maior_queda">Maior queda</option><option value="maior_faturamento">Maior faturamento</option><option value="menor_faturamento">Menor faturamento</option><option value="nome">Nome</option></select></label>
      <label className="client-search"><span>Buscar cliente, CNPJ ou cidade</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Digite para pesquisar" /></label>
      {period === 'personalizado' && <><label><span>Data inicial</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label><span>Data final</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></>}
    </section>

    {error && <div className="alert alert-error clients-alert">{error}</div>}
    <section className="clients-summary">
      <article><span>Clientes ativos</span><strong>{loading ? '—' : integer.format(resumo?.clientes_ativos || 0)}</strong><small>Carteira oficial filtrada</small></article>
      <article><span>Com venda</span><strong>{loading ? '—' : integer.format(resumo?.clientes_com_venda || 0)}</strong><small>{percent.format(resumo?.cobertura_percentual || 0)}% de cobertura</small></article>
      <article><span>Sem venda</span><strong>{loading ? '—' : integer.format(resumo?.clientes_sem_venda || 0)}</strong><small>{integer.format((resumo?.prioridades?.CRITICA || 0) + (resumo?.prioridades?.ALTA || 0))} urgentes</small></article>
      <article><span>Faturamento</span><strong>{loading ? '—' : currency.format(resumo?.faturamento_total || 0)}</strong><small>Ticket por cliente: {currency.format(resumo?.ticket_medio_cliente || 0)}</small></article>
    </section>

    <section className="clients-list-card">
      <div className="clients-list-heading"><div><span className="eyebrow">Prioridades</span><h2>Carteira organizada</h2></div><span>{integer.format(data?.paginacao.total || 0)} clientes encontrados</span></div>
      <div className="clients-table-wrap"><table className="clients-table"><thead><tr><th>Prioridade</th><th>Cliente</th><th>Responsável</th><th>Faturamento</th><th>Comparação</th><th>Última compra</th><th>Mix</th><th></th></tr></thead><tbody>
        {loading && <tr><td colSpan={8} className="clients-empty">Carregando clientes…</td></tr>}
        {!loading && (data?.clientes || []).map((client) => <tr key={client.id}>
          <td><span className={`priority-pill priority-${client.prioridade.toLowerCase()}`}>{priorityLabel(client.prioridade)}</span><small>{client.motivo_prioridade}</small></td>
          <td><strong>{client.nome}</strong><small>{client.cnpj} · {client.cidade}/{client.uf}</small></td>
          <td><strong>{client.consultor || 'Sem consultor'}</strong><small>{client.gd || 'GD não informado'}</small></td>
          <td><strong>{currency.format(client.faturamento_atual)}</strong><small>{integer.format(client.pedidos_atual)} pedidos · ticket {currency.format(client.ticket_medio)}</small></td>
          <td><span className={client.variacao_percentual < 0 ? 'variation-negative' : 'variation-positive'}>{client.variacao_percentual >= 0 ? '+' : ''}{percent.format(client.variacao_percentual)}%</span><small>Anterior: {currency.format(client.faturamento_anterior)}</small></td>
          <td><strong>{formatDate(client.ultima_compra)}</strong><small>{client.dias_sem_comprar === null ? 'Sem histórico' : `${client.dias_sem_comprar} dias`}</small></td>
          <td><strong>{integer.format(client.produtos_comprados)} produtos</strong><small>{client.produtos_prioritarios} prioritários · {client.produtos_lancamentos} lançamentos</small></td>
          <td><button className="outline-button compact-button" type="button" onClick={() => void openDetail(client)}>Ver ficha</button></td>
        </tr>)}
        {!loading && !data?.clientes.length && <tr><td colSpan={8} className="clients-empty">Nenhum cliente encontrado para os filtros selecionados.</td></tr>}
      </tbody></table></div>
      <div className="pagination"><button type="button" disabled={(data?.paginacao.pagina || 1) <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Anterior</button><span>Página {data?.paginacao.pagina || 1} de {data?.paginacao.paginas || 1}</span><button type="button" disabled={(data?.paginacao.pagina || 1) >= (data?.paginacao.paginas || 1)} onClick={() => setPage((value) => value + 1)}>Próxima →</button></div>
    </section>

    {(detailLoading || detail) && <div className="client-detail-backdrop" role="presentation" onClick={() => !detailLoading && setDetail(null)}><aside className="client-detail" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <button className="detail-close" type="button" onClick={() => setDetail(null)}>×</button>
      {detailLoading ? <div className="detail-loading">Carregando ficha do cliente…</div> : detail && <>
        <header><span className="eyebrow">Ficha do cliente</span><h2>{detail.cliente.nome}</h2><p>{detail.cliente.cnpj} · {detail.cliente.cidade}/{detail.cliente.uf} · {detail.cliente.consultor || 'Sem consultor'}</p></header>
        <div className="detail-metrics"><article><span>Faturamento</span><strong>{currency.format(detail.resumo.faturamento)}</strong></article><article><span>Pedidos</span><strong>{integer.format(detail.resumo.pedidos)}</strong></article><article><span>Ticket médio</span><strong>{currency.format(detail.resumo.ticket_medio)}</strong></article><article><span>Última compra</span><strong>{formatDate(detail.resumo.ultima_compra)}</strong></article></div>
        <section className="detail-section"><h3>Evolução mensal</h3><div className="history-bars">{detail.historico.map((item) => <div key={item.ano_mes}><span>{item.ano_mes.slice(5, 7)}/{item.ano_mes.slice(0, 4)}</span><div><i style={{ width: `${Math.max(2, item.faturamento / maxHistory * 100)}%` }} /></div><strong>{currency.format(item.faturamento)}</strong></div>)}</div></section>
        <section className="detail-section"><h3>Produtos mais comprados</h3>{detail.produtos.slice(0, 12).map((item) => <div className="detail-row" key={`${item.ean}-${item.produto}`}><div><strong>{item.produto}</strong><span>{item.ean} · {item.tipo_mix}</span></div><b>{currency.format(item.faturamento)}</b></div>)}</section>
        <section className="detail-section"><h3>Oportunidades de mix</h3>{detail.oportunidades.length === 0 ? <p>Nenhum prioritário ou lançamento ausente.</p> : detail.oportunidades.slice(0, 20).map((item) => <div className="detail-row" key={item.id}><div><strong>{item.produto}</strong><span>{item.ean}</span></div><b>{item.tipo_mix}</b></div>)}</section>
        <section className="detail-section"><h3>Últimos pedidos</h3>{detail.pedidos.slice(0, 15).map((item) => <div className="detail-row" key={item.id}><div><strong>Pedido {item.pedido_origem}</strong><span>{formatDate(item.data)} · NF {item.nota_fiscal || 'não informada'} · {item.itens} itens</span></div><b>{currency.format(item.valor)}</b></div>)}</section>
      </>}
    </aside></div>}
  </main>
}
