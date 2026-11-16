import SkuCoverage from './SkuCoverage'
import { useEffect, useMemo, useState } from 'react'
import ClientPurchaseInsights, { type InteligenciaCliente } from './ClientPurchaseInsights'
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
  historico: Array<{ ano_mes: string; faturamento: number; pedidos: number; produtos: number; origem?: string }>
  produtos: Array<{ produto: string; ean: string; tipo_mix: string; faturamento: number; quantidade: number; pedidos: number }>
  pedidos: Array<{ id: string; pedido_origem: string; nota_fiscal: string; status: string; data: string; valor: number; itens: number }>
  oportunidades: Array<{ id: string; ean: string; produto: string; tipo_mix: string }>
}
type PdvOption = Pick<ClientRow, 'cnpj' | 'nome' | 'cidade' | 'uf'>
type PdvOptionResponse = { pdvs: PdvOption[]; total: number; truncado: boolean; erro?: string }
type DistributorOption = { nome: string; ufs: string[] }
type Props = { onBack: () => void; onOpenMarket: () => void }

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

export default function ClientsModule({ onBack, onOpenMarket }: Props) {
  const currentMonth = monthBounds(0)
  const [period, setPeriod] = useState<PeriodOption>('mes-atual')
  const [customStart, setCustomStart] = useState(currentMonth.inicio)
  const [customEnd, setCustomEnd] = useState(currentMonth.fim)
  const [consultant, setConsultant] = useState('')
  const [uf, setUf] = useState('')
  const [city, setCity] = useState('')
  const [search, setSearch] = useState('')
  const [pdvOptions, setPdvOptions] = useState<PdvOption[]>([])
  const [pdvOptionsOpen, setPdvOptionsOpen] = useState(false)
  const [pdvOptionsLoading, setPdvOptionsLoading] = useState(false)
  const [pdvOptionsTruncated, setPdvOptionsTruncated] = useState(false)
  const [pdvOptionsError, setPdvOptionsError] = useState('')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedPdvs, setSelectedPdvs] = useState<PdvOption[]>([])
  const [priority, setPriority] = useState('')
  const [sort, setSort] = useState('prioridade')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ClientResponse | null>(null)
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [insights, setInsights] = useState<InteligenciaCliente | null>(null)
  const [insightsError, setInsightsError] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [exportandoMix, setExportandoMix] = useState(false)
  const [distribuidoras, setDistribuidoras] = useState<DistributorOption[]>([])
  const [distribuidorasEscolhidas, setDistribuidorasEscolhidas] = useState<string[] | null>(null)
  const [distribuidorasLoading, setDistribuidorasLoading] = useState(false)
  const [distribuidorasError, setDistribuidorasError] = useState('')
  // Aberto inicialmente para tornar a lista e suas caixas de seleção visíveis.
  const [distribuidorasAberto, setDistribuidorasAberto] = useState(true)
  const [buscaDistribuidora, setBuscaDistribuidora] = useState('')
  const [error, setError] = useState('')

  const selectedCnpjs = useMemo(() => selectedPdvs.map(item => item.cnpj).join(','), [selectedPdvs])
  const distribuidoresDisponiveis = useMemo(() => distribuidoras.map(item=>item.nome),[distribuidoras])
  const distribuidoresAtivos = useMemo(() =>
    distribuidorasEscolhidas === null ? distribuidoresDisponiveis
      : distribuidorasEscolhidas.filter(item=>distribuidoresDisponiveis.includes(item)),
  [distribuidorasEscolhidas,distribuidoresDisponiveis])
  const distribuidorasFiltradas = useMemo(() => distribuidoras.filter(item =>
    item.nome.toLocaleLowerCase('pt-BR').includes(buscaDistribuidora.trim().toLocaleLowerCase('pt-BR')) ||
    item.ufs.some(ufAtendida => ufAtendida.toLocaleLowerCase('pt-BR').includes(buscaDistribuidora.trim().toLocaleLowerCase('pt-BR')))
  ), [distribuidoras,buscaDistribuidora])

  function alterarDistribuidora(nome: string) {
    setDistribuidorasEscolhidas(current => {
      const nomes = current === null ? distribuidoresDisponiveis : current
      return nomes.includes(nome) ? nomes.filter(item=>item!==nome) : [...nomes,nome]
    })
  }

  useEffect(() => {
    const controller = new AbortController()
    setDistribuidorasLoading(true)
    setDistribuidorasError('')
    setDistribuidorasEscolhidas(null)
    const params = new URLSearchParams()
    if (uf) params.set('uf',uf)
    fetch(`/api/clientes/distribuidoras?${params}`, {
      credentials:'same-origin',cache:'no-store',signal:controller.signal,
    }).then(async response => {
      const body = await response.json() as { distribuidoras?: DistributorOption[]; erro?: string }
      if (!response.ok) throw new Error(body.erro || 'Erro ao listar distribuidoras.')
      if (!controller.signal.aborted) setDistribuidoras(body.distribuidoras || [])
    }).catch(reason => {
      if (controller.signal.aborted) return
      setDistribuidoras([])
      setDistribuidorasError(reason instanceof Error ? reason.message : 'Não foi possível consultar o estoque.')
    }).finally(() => { if (!controller.signal.aborted) setDistribuidorasLoading(false) })
    return () => controller.abort()
  },[uf])

  function togglePdv(item: PdvOption) {
    const marcado = selectedPdvs.some(pdv => pdv.cnpj === item.cnpj)
    if (!marcado && selectedPdvs.length >= 100) {
      setPdvOptionsError('Limite de 100 CNPJs por exportação. Remova algum PDV ou refine a busca.')
      return
    }
    setSelectionMode(true)
    setPdvOptionsError('')
    setSelectedPdvs(current => marcado ? current.filter(pdv => pdv.cnpj !== item.cnpj) : [...current, item])
  }

  function selecionarTodosEncontrados() {
    const unicos = new Map([...selectedPdvs, ...pdvOptions].map(item => [item.cnpj, item]))
    if (pdvOptionsTruncated) {
      setPdvOptionsError('A busca retornou muitos PDVs. Refine o nome para selecionar todos sem omissões.')
      return
    }
    if (unicos.size > 100) {
      setPdvOptionsError('São mais de 100 CNPJs. Refine a pesquisa ou escolha os PDVs individualmente.')
      return
    }
    setSelectedPdvs([...unicos.values()])
    setSelectionMode(true)
    setPdvOptionsError('')
  }

  function limparSelecaoPdvs() {
    setSelectedPdvs([])
    setSelectionMode(false)
    setPdvOptionsError('')
  }

  useEffect(() => {
    const term = search.trim()
    if (term.length < 2) {
      setPdvOptions([])
      setPdvOptionsLoading(false)
      setPdvOptionsTruncated(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setPdvOptionsLoading(true)
      setPdvOptionsError('')
      try {
        const params = new URLSearchParams({ busca: term })
        if (uf) params.set('uf', uf)
        if (city) params.set('cidade', city)
        const response = await fetch(`/api/clientes/opcoes-pdv?${params}`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
        const body = await response.json() as PdvOptionResponse
        if (!response.ok) throw new Error(body.erro || 'Não foi possível buscar PDVs.')
        setPdvOptions(body.pdvs || [])
        setPdvOptionsTruncated(!!body.truncado)
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setPdvOptions([])
        setPdvOptionsError(reason instanceof Error ? reason.message : 'Erro ao pesquisar PDVs.')
      } finally {
        if (!controller.signal.aborted) setPdvOptionsLoading(false)
      }
    }, 250)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [search, uf, city])

  const selectedPeriod = useMemo(() => {
    if (period === 'mes-atual') return monthBounds(0)
    if (period === 'mes-anterior') return monthBounds(-1)
    if (period === 'personalizado') return { inicio: customStart, fim: customEnd }
    return { inicio: '', fim: '' }
  }, [period, customStart, customEnd])

  useEffect(() => { setPage(1) }, [period, customStart, customEnd, consultant, uf, city, search, priority, sort, selectionMode, selectedCnpjs])

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
        if (selectionMode) params.set('selecionados', selectedCnpjs)
        else if (search) params.set('busca', search)
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
  }, [period, customStart, customEnd, selectedPeriod.inicio, selectedPeriod.fim, consultant, uf, city, search, priority, sort, page, selectionMode, selectedCnpjs])

  async function exportarMixFiltrado() {
    if (exportandoMix || loading || !data?.paginacao.total) return
    if (!distribuidoresAtivos.length) {
      setError('Selecione ao menos uma distribuidora para incluir as colunas de estoque no Excel.')
      return
    }
    setExportandoMix(true)
    setError('')
    try {
      const params = new URLSearchParams({ periodo: period, ordenar: sort })
      if (selectedPeriod.inicio && selectedPeriod.fim) {
        params.set('inicio', selectedPeriod.inicio)
        params.set('fim', selectedPeriod.fim)
      }
      if (consultant) params.set('consultor', consultant)
      if (uf) params.set('uf', uf)
      if (city) params.set('cidade', city)
      if (selectionMode) params.set('selecionados', selectedCnpjs)
      else if (search) params.set('busca', search)
      if (priority) params.set('prioridade', priority)
      distribuidoresAtivos.forEach(nome => params.append('distribuidora',nome))
      const response = await fetch(`/api/clientes/exportar-mix?${params}`, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) {
        const reason = await response.text()
        throw new Error(reason || 'Falha ao gerar relatório de MIX.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `carteira-mix-clientes-${new Date().toISOString().slice(0,10)}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 3000)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setExportandoMix(false)
    }
  }

  async function openDetail(client: ClientRow) {
    setDetailLoading(true); setDetail(null); setInsights(null); setInsightsError(''); setError('')
    try {
      const params = new URLSearchParams({ id: client.id })
      if (selectedPeriod.inicio && selectedPeriod.fim) { params.set('inicio', selectedPeriod.inicio); params.set('fim', selectedPeriod.fim) }
      const response = await fetch(`/api/clientes/detalhe?${params}`, { cache: 'no-store' })
      const result = await response.json() as ClientDetail & { erro?: string; detalhe?: string }
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível abrir a ficha do cliente.')
      setDetail(result)
      // Falha da análise não esconde a ficha nem seu histórico existente.
      try {
        const resposta = await fetch(`/api/clientes/inteligencia?id=${encodeURIComponent(client.id)}`, { cache: 'no-store' })
        const analise = await resposta.json() as InteligenciaCliente & { erro?: string; detalhe?: string }
        if (resposta.ok) setInsights(analise)
        else setInsightsError(analise.detalhe || analise.erro || 'Dados de cobertura indisponíveis.')
      } catch (motivo) {
        setInsightsError(motivo instanceof Error ? motivo.message : 'Análise de compras temporariamente indisponível.')
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setDetailLoading(false) }
  }

  const resumo = data?.resumo
  const mesesRecentes = (detail?.historico || []).slice(-12).reverse()
  const maxHistory = Math.max(1, ...mesesRecentes.map((item) => item.faturamento))
  useEffect(() => {
    if (!detail && !detailLoading) return
    const fechar = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDetail(null); setDetailLoading(false) } }
    document.addEventListener('keydown', fechar)
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', fechar); document.body.style.overflow = original }
  }, [detail, detailLoading])

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
      <section className="clients-distributors clients-distributors-visible" aria-label="Selecionar distribuidoras para o Excel">
        <button type="button" className="clients-distributors-trigger"
          aria-expanded={distribuidorasAberto} aria-controls="clientes-distribuidoras-lista"
          onClick={() => setDistribuidorasAberto(aberto => !aberto)}>
          <span className="clients-distributors-trigger-copy">
            <strong>Distribuidoras para o Excel</strong>
            <small>Escolha quais estoques aparecerão nas colunas da planilha</small>
          </span>
          <span className="clients-distributors-trigger-right">
            <span className="clients-distributors-count">{distribuidorasLoading ? 'Carregando…' : `${distribuidoresAtivos.length} de ${distribuidoras.length} selecionadas`}</span>
            <span className="clients-distributors-chevron" aria-hidden="true">{distribuidorasAberto ? '▴' : '▾'}</span>
          </span>
        </button>
        {distribuidorasAberto && <div id="clientes-distribuidoras-lista" className="clients-distributors-menu">
          <div className="clients-distributors-toolbar">
            <label className="clients-distributors-search" htmlFor="clientes-buscar-distribuidora">
              <span>Filtrar distribuidoras</span>
              <input id="clientes-buscar-distribuidora" type="search" value={buscaDistribuidora}
                onChange={event => setBuscaDistribuidora(event.target.value)}
                placeholder="Nome da distribuidora ou UF" />
            </label>
            <div className="clients-distributors-actions">
              <button type="button" onClick={() => setDistribuidorasEscolhidas(null)}>Selecionar todas</button>
              <button type="button" onClick={() => setDistribuidorasEscolhidas([])}>Desmarcar todas</button>
            </div>
          </div>
          {distribuidorasError && <small role="alert" className="clients-distributors-error">{distribuidorasError}</small>}
          {!distribuidorasLoading && !distribuidoras.length && <small>Sem distribuidoras disponíveis para a UF.</small>}
          <div className="clients-distributors-options" role="group" aria-label="Distribuidoras disponíveis">
            {distribuidorasFiltradas.map(item => <label key={item.nome}>
              <input type="checkbox" checked={distribuidoresAtivos.includes(item.nome)}
                onChange={() => alterarDistribuidora(item.nome)} />
              <span>{item.nome}<small>Atende {item.ufs.join(' / ')}</small></span>
            </label>)}
          </div>
          {!distribuidorasLoading && distribuidoras.length > 0 && !distribuidorasFiltradas.length &&
            <small>Nenhuma distribuidora corresponde à pesquisa.</small>}
          <div className="clients-distributors-footer">
            <small>{distribuidoresAtivos.length ? 'Somente as distribuidoras marcadas entrarão no Excel.' : 'Marque ao menos uma distribuidora para habilitar o Excel.'}</small>
            <button type="button" onClick={() => setDistribuidorasAberto(false)}>Concluir seleção</button>
          </div>
        </div>}
      </section>
      <div className="client-search client-pdv-multiselect">
        <label htmlFor="client-pdv-search"><span>Buscar e selecionar PDVs por nome, CNPJ ou cidade</span></label>
        <div className="client-pdv-searchbox">
          <input id="client-pdv-search" value={search} autoComplete="off"
            aria-controls="client-pdv-options" aria-expanded={pdvOptionsOpen && search.trim().length >= 2}
            onChange={event => { setSearch(event.target.value); setPdvOptions([]); setPdvOptionsLoading(event.target.value.trim().length >= 2); setPdvOptionsOpen(true) }}
            onFocus={() => { if (search.trim().length >= 2) setPdvOptionsOpen(true) }}
            onKeyDown={event => { if (event.key === 'Escape') setPdvOptionsOpen(false) }}
            placeholder="Ex.: ULTRA POPU — selecione os CNPJs desejados" />
          {search && <button type="button" className="client-pdv-clear-search" onClick={() => { setSearch(''); setPdvOptionsOpen(false) }} aria-label="Apagar pesquisa">×</button>}
        </div>
        {pdvOptionsOpen && search.trim().length >= 2 && <div className="client-pdv-options" id="client-pdv-options">
          <div className="client-pdv-options-heading">
            <strong>{pdvOptionsLoading ? 'Pesquisando PDVs…' : `${pdvOptions.length} PDV(s) encontrado(s)`}</strong>
            <div className="client-pdv-options-actions">
              <button type="button" disabled={pdvOptionsLoading || !pdvOptions.length || pdvOptionsTruncated}
                onClick={selecionarTodosEncontrados}>Selecionar todos</button>
              <button type="button" onClick={() => setPdvOptionsOpen(false)}>Concluir</button>
            </div>
          </div>
          {pdvOptionsTruncated && <p className="client-pdv-hint">Mais de 500 resultados; refine o nome para visualizar todos.</p>}
          {pdvOptionsError && <p className="client-pdv-error" role="alert">{pdvOptionsError}</p>}
          {!pdvOptionsLoading && pdvOptions.length === 0 && <p className="client-pdv-hint">Nenhum PDV encontrado para essa pesquisa.</p>}
          <div className="client-pdv-option-list" role="group" aria-label="Selecionar PDVs encontrados">
            {pdvOptions.map(pdv => <label key={pdv.cnpj} className="client-pdv-option">
              <input type="checkbox" checked={selectedPdvs.some(item => item.cnpj === pdv.cnpj)}
                onChange={() => togglePdv(pdv)} />
              <span><strong>{pdv.nome}</strong><small>{pdv.cnpj} · {pdv.cidade}/{pdv.uf}</small></span>
            </label>)}
          </div>
        </div>}
        {selectionMode && <div className="client-pdv-selection" role="status">
          <div className="client-pdv-selection-heading"><strong>{selectedPdvs.length} PDV(s) selecionado(s) para a tabela e Excel</strong>
            <button type="button" onClick={limparSelecaoPdvs}>Limpar seleção</button>
          </div>
          {selectedPdvs.length === 0 ? <small>Seleção vazia. Marque um PDV acima ou limpe a seleção para voltar à pesquisa geral.</small> :
            <div className="client-pdv-selected-chips">{selectedPdvs.map(pdv => <button key={pdv.cnpj} type="button"
              onClick={() => togglePdv(pdv)} aria-label={`Retirar ${pdv.nome}, CNPJ ${pdv.cnpj}`}
              title={`Retirar ${pdv.nome} (${pdv.cnpj})`}>
              <span>{pdv.nome} · {pdv.cnpj}</span> <b aria-hidden="true">×</b>
            </button>)}</div>}
        </div>}
        {!selectionMode && search.trim().length >= 2 && <small className="client-pdv-help">Marque os PDVs desejados ou use “Selecionar todos”; depois retire qualquer unidade desmarcando-a. A seleção será aplicada ao Excel.</small>}
      </div>
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
      <div className="clients-list-heading">
        <div><span className="eyebrow">Prioridades</span><h2>Carteira organizada</h2></div>
        <div className="clients-list-actions">
          <span>{integer.format(data?.paginacao.total || 0)} clientes encontrados</span>
          <button type="button" className="clients-export-mix" disabled={loading || exportandoMix || distribuidoresAtivos.length===0 || distribuidorasLoading || !(data?.paginacao.total)}
            onClick={() => void exportarMixFiltrado()}
            title="Exporta todos os CNPJs filtrados, inclusive de outras páginas; cada CNPJ em sua aba">
            {exportandoMix ? 'Gerando relatório…' : '↓ Excel · MIX por CNPJ'}
          </button>
        </div>
      </div>
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

    {(detailLoading || detail) && <div className="client-detail-backdrop" role="presentation" onClick={() => !detailLoading && setDetail(null)}><section className="client-detail" role="dialog" aria-modal="true" aria-label="Ficha completa do cliente" onClick={(event) => event.stopPropagation()}>
      <button className="detail-close" type="button" onClick={() => setDetail(null)}>×</button>
      {detailLoading ? <div className="detail-loading">Carregando ficha do cliente…</div> : detail && <>
        <header><span className="eyebrow">Ficha do cliente</span><h2>{detail.cliente.nome}</h2><p>{detail.cliente.cnpj} · {detail.cliente.cidade}/{detail.cliente.uf} · {detail.cliente.consultor || 'Sem consultor'}</p></header>
        <div className="detail-metrics"><article><span>Faturamento</span><strong>{currency.format(detail.resumo.faturamento)}</strong></article><article><span>Pedidos</span><strong>{integer.format(detail.resumo.pedidos)}</strong></article><article><span>Ticket médio</span><strong>{currency.format(detail.resumo.ticket_medio)}</strong></article><article><span>Última compra</span><strong>{formatDate(detail.resumo.ultima_compra)}</strong></article></div>
        <section className="detail-section"><h3>Histórico de compras — últimos 12 meses disponíveis</h3><p>Mês atual: somente itens faturados da extração do Bússola. Nos meses anteriores, o histórico importado é utilizado quando não há dados detalhados do Bússola.</p><div className="history-bars">{mesesRecentes.map((item) => <div key={item.ano_mes}><span>{item.ano_mes.slice(5, 7)}/{item.ano_mes.slice(0, 4)}</span><div><i style={{ width: `${item.faturamento > 0 ? Math.max(2, item.faturamento / maxHistory * 100) : 0}%` }} /></div><strong>{currency.format(item.faturamento)}</strong></div>)}</div><div className="client-history-table-wrap"><table className="client-history-table"><thead><tr><th>Mês</th><th>Faturamento</th><th>Pedidos</th><th>Produtos</th><th>Origem</th></tr></thead><tbody>{mesesRecentes.map(item => <tr key={item.ano_mes}><td>{item.ano_mes.slice(5, 7)}/{item.ano_mes.slice(0, 4)}</td><td>{currency.format(item.faturamento)}</td><td>{integer.format(item.pedidos)}</td><td>{integer.format(item.produtos)}</td><td>{item.origem === 'IMPORTADO' ? 'Histórico agregado' : 'Bússola'}</td></tr>)}</tbody></table></div>{!mesesRecentes.length && <p>Não há histórico de compras cadastrado.</p>}</section>
        <SkuCoverage key={detail.cliente.id} clienteId={detail.cliente.id} inicio={selectedPeriod.inicio} fim={selectedPeriod.fim} />
        {insights ? <ClientPurchaseInsights dados={insights} onOpenMarket={onOpenMarket} /> : <section className="detail-section"><h3>Cobertura e sugestões</h3><p>{insightsError || 'Carregando análise de compras por produto…'}</p></section>}
        <div className="client-ficha-grid"><div><section className="detail-section"><h3>Produtos mais comprados</h3>{detail.produtos.slice(0, 12).map((item) => <div className="detail-row" key={`${item.ean}-${item.produto}`}><div><strong>{item.produto}</strong><span>{item.ean} · {item.tipo_mix}</span></div><b>{currency.format(item.faturamento)}</b></div>)}</section>
        <section className="detail-section"><h3>Oportunidades de mix</h3>{detail.oportunidades.length === 0 ? <p>Nenhum prioritário ou lançamento ausente.</p> : detail.oportunidades.slice(0, 20).map((item) => <div className="detail-row" key={item.id}><div><strong>{item.produto}</strong><span>{item.ean}</span></div><b>{item.tipo_mix}</b></div>)}</section>
        </div><div><section className="detail-section"><h3>Últimos pedidos</h3>{detail.pedidos.slice(0, 15).map((item) => <div className="detail-row" key={item.id}><div><strong>Pedido {item.pedido_origem}</strong><span>{formatDate(item.data)} · NF {item.nota_fiscal || 'não informada'} · {item.itens} itens</span></div><b>{currency.format(item.valor)}</b></div>)}</section></div></div>
      </>}
    </section></div>}
  </main>
}

