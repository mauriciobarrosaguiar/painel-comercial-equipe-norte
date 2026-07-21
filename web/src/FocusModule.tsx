import { FormEvent, Fragment, useEffect, useMemo, useState } from 'react'
import './operations.css'
import './focus.css'

type Line = {
  id: string
  foco_id: string
  semana_inicio: string
  semana_fim: string
  produto_id: string
  ean: string
  descricao: string
  observacoes: string
  consultor_id: string
  consultor: string
  setor: string
  meta_quantidade: number
  realizado_quantidade: number
  cobertura_percentual: number
  cnpj_positivados: number
  pedidos: number
  faturamento: number
}

type Consultant = { id: string; nome: string; setor?: string }
type Product = { id: string; ean: string; descricao: string; laboratorio?: string }
type Data = {
  periodo: { inicio: string; fim: string }
  linhas: Line[]
  filtros: { consultores: Consultant[]; ufs: string[]; produtos: Product[] }
  aviso?: string
}
type FocusProduct = Pick<Line, 'foco_id' | 'produto_id' | 'ean' | 'descricao' | 'observacoes'>
type ResultConsultant = Pick<Line, 'consultor_id' | 'consultor' | 'setor'>

const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
const local = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const dateLabel = (value: string) => {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}
const normalizar = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

function week() {
  const current = new Date()
  const monday = new Date(current)
  monday.setDate(current.getDate() - ((current.getDay() + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { inicio: local(monday), fim: local(sunday) }
}

function coverageClass(value: number) {
  if (value >= 100) return 'coverage-complete'
  if (value > 0) return 'coverage-progress'
  return 'coverage-zero'
}

export default function FocusModule({ onBack }: { onBack: () => void }) {
  const currentWeek = week()
  const [inicio, setInicio] = useState(currentWeek.inicio)
  const [fim, setFim] = useState(currentWeek.fim)
  const [consultor, setConsultor] = useState('')
  const [uf, setUf] = useState('')
  const [data, setData] = useState<Data>({ periodo: currentWeek, linhas: [], filtros: { consultores: [], ufs: [], produtos: [] } })
  const [produtoId, setProdutoId] = useState('')
  const [produtoBusca, setProdutoBusca] = useState('')
  const [listaProdutosAberta, setListaProdutosAberta] = useState(false)
  const [observacoes, setObservacoes] = useState('')
  const [metas, setMetas] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ inicio, fim })
      if (consultor) params.set('consultor', consultor)
      if (uf) params.set('uf', uf)
      const response = await fetch(`/api/foco-semanal?${params}`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro)
      setData({
        ...result,
        filtros: {
          consultores: result.filtros?.consultores || [],
          ufs: result.filtros?.ufs || [],
          produtos: result.filtros?.produtos || [],
        },
      })
      setMetas(current => {
        const next = { ...current }
        for (const item of result.filtros?.consultores || []) if (next[item.id] === undefined) next[item.id] = '0'
        return next
      })
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [inicio, fim, consultor, uf])

  const produtoSelecionado = useMemo(
    () => data.filtros.produtos.find(item => item.id === produtoId),
    [data.filtros.produtos, produtoId],
  )

  const produtosFiltrados = useMemo(() => {
    const query = normalizar(produtoBusca)
    const digits = produtoBusca.replace(/\D/g, '')
    return data.filtros.produtos
      .filter(item => !query && !digits || normalizar(item.descricao).includes(query) || item.ean.includes(digits || produtoBusca.trim()))
      .sort((a, b) => {
        const aPrefix = normalizar(a.descricao).startsWith(query) || a.ean.startsWith(digits) ? 0 : 1
        const bPrefix = normalizar(b.descricao).startsWith(query) || b.ean.startsWith(digits) ? 0 : 1
        return aPrefix - bPrefix || a.descricao.localeCompare(b.descricao, 'pt-BR')
      })
      .slice(0, 40)
  }, [data.filtros.produtos, produtoBusca])

  const focusProducts = useMemo(() => {
    const map = new Map<string, FocusProduct>()
    for (const line of data.linhas) if (!map.has(line.foco_id)) map.set(line.foco_id, line)
    return [...map.values()]
  }, [data.linhas])

  const resultConsultants = useMemo(() => {
    const map = new Map<string, ResultConsultant>()
    for (const line of data.linhas) if (!map.has(line.consultor_id)) map.set(line.consultor_id, line)
    return [...map.values()].sort((a, b) => (a.setor || '').localeCompare(b.setor || '') || a.consultor.localeCompare(b.consultor, 'pt-BR'))
  }, [data.linhas])

  const lineMap = useMemo(
    () => new Map(data.linhas.map(line => [`${line.consultor_id}|${line.foco_id}`, line])),
    [data.linhas],
  )

  const totalsByProduct = useMemo(() => {
    const totals = new Map<string, { meta: number; realizado: number }>()
    for (const line of data.linhas) {
      const current = totals.get(line.foco_id) || { meta: 0, realizado: 0 }
      current.meta += Number(line.meta_quantidade || 0)
      current.realizado += Number(line.realizado_quantidade || 0)
      totals.set(line.foco_id, current)
    }
    return totals
  }, [data.linhas])

  function selecionarProduto(product: Product) {
    setProdutoId(product.id)
    setProdutoBusca(`${product.descricao} · ${product.ean}`)
    setListaProdutosAberta(false)
    setError('')
  }

  function limparProduto() {
    setProdutoId('')
    setProdutoBusca('')
    setListaProdutosAberta(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const selected = data.filtros.produtos.find(item => item.id === produtoId)
    if (!selected) {
      setError('Pesquise e selecione um produto da lista pelo nome ou EAN.')
      return
    }
    const consultores = data.filtros.consultores
      .map(item => ({ id: item.id, meta_quantidade: Number(metas[item.id] || 0) }))
      .filter(item => item.meta_quantidade > 0)
    if (!consultores.length) {
      setError('Informe a meta de pelo menos um consultor.')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/foco-semanal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          semana_inicio: inicio,
          semana_fim: fim,
          produto_id: selected.id,
          ean: selected.ean,
          descricao: selected.descricao,
          observacoes,
          consultores,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro)
      setMessage(`${selected.descricao} salvo. O realizado será calculado pela quantidade faturada de ${dateLabel(inicio)} a ${dateLabel(fim)}.`)
      setProdutoId('')
      setProdutoBusca('')
      setListaProdutosAberta(false)
      setObservacoes('')
      setMetas(Object.fromEntries(data.filtros.consultores.map(item => [item.id, '0'])))
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string, description: string) {
    if (!confirm(`Remover ${description} desta missão?`)) return
    const response = await fetch('/api/foco-semanal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao: 'excluir', id }),
    })
    if (!response.ok) {
      const result = await response.json()
      setError(result.erro || 'Não foi possível remover.')
      return
    }
    await load()
  }

  const metasInformadas = Object.values(metas).filter(value => Number(value) > 0).length
  const missionWidth = Math.max(720, 330 + focusProducts.length * 300)
  const exportParams = useMemo(() => {
    const params = new URLSearchParams({ tipo: 'foco_pendentes', formato: 'xls', inicio, fim })
    if (consultor) params.set('consultor', consultor)
    if (uf) params.set('uf', uf)
    return params.toString()
  }, [inicio, fim, consultor, uf])

  return <main className="content operations-page focus-page">
    <button className="back-button" onClick={onBack}>← Voltar ao painel</button>

    <section className="operations-hero focus-hero">
      <div>
        <span className="eyebrow">Missão comercial</span>
        <h1>Foco Semanal</h1>
        <p>Cadastre o produto e a meta de cada consultor. O realizado é buscado automaticamente na quantidade faturada do período selecionado.</p>
      </div>
      <a className="secondary-button market-download" href={`/api/exportar?${exportParams}`}>Clientes que não compraram</a>
    </section>

    <section className="filters history-filters focus-filters">
      <label><span>Data inicial</span><input type="date" value={inicio} onChange={event => setInicio(event.target.value)} /></label>
      <label><span>Data final</span><input type="date" value={fim} onChange={event => setFim(event.target.value)} /></label>
      <label><span>Consultor</span><select value={consultor} onChange={event => setConsultor(event.target.value)}><option value="">Todos</option>{data.filtros.consultores.map(item => <option value={item.id} key={item.id}>{item.nome}</option>)}</select></label>
      <label><span>UF</span><select value={uf} onChange={event => setUf(event.target.value)}><option value="">Todas</option>{data.filtros.ufs.map(item => <option key={item}>{item}</option>)}</select></label>
    </section>

    {error && <div className="alert alert-error">{error}</div>}
    {message && <div className="alert alert-success">{message}</div>}
    {data.aviso && <div className="alert alert-error">{data.aviso}</div>}

    <section className="focus-mission-panel">
      <div className="focus-mission-title">
        <div><span>MISSÃO DO PERÍODO</span><h2>{focusProducts.length ? focusProducts.map(item => item.descricao).join(' & ') : 'Nenhum produto cadastrado'}</h2></div>
        <strong>{dateLabel(inicio)} a {dateLabel(fim)}</strong>
      </div>

      <div className="focus-mission-table-wrap">
        <table className="focus-mission-table" style={{ minWidth: `${missionWidth}px` }}>
          <thead>
            <tr>
              <th rowSpan={2} className="focus-fixed-head focus-head-blue">SETOR</th>
              <th rowSpan={2} className="focus-consultant-head focus-head-blue">CONSULTOR</th>
              {focusProducts.map((product, index) => <th key={product.foco_id} colSpan={3} className={`focus-product-head focus-group-${index % 2}`}>
                <div><span>{product.descricao}</span><small>EAN {product.ean}</small><button type="button" title="Remover produto da missão" onClick={() => void remove(product.foco_id, product.descricao)}>×</button></div>
              </th>)}
            </tr>
            <tr>
              {focusProducts.map((product, index) => <Fragment key={product.foco_id}>
                <th className={`focus-subhead focus-group-${index % 2}`}>META DO PRODUTO</th>
                <th className={`focus-subhead focus-group-${index % 2}`}>QTDE FATURADA</th>
                <th className={`focus-subhead focus-group-${index % 2}`}>% ATINGIMENTO</th>
              </Fragment>)}
            </tr>
          </thead>
          <tbody>
            {resultConsultants.map(item => <tr key={item.consultor_id}>
              <td className="focus-sector-cell">{item.setor || '—'}</td>
              <td className="focus-consultant-cell"><strong>{item.consultor}</strong></td>
              {focusProducts.map(product => {
                const line = lineMap.get(`${item.consultor_id}|${product.foco_id}`)
                const meta = Number(line?.meta_quantidade || 0)
                const realizado = Number(line?.realizado_quantidade || 0)
                const coverage = meta > 0 ? realizado / meta * 100 : 0
                return <Fragment key={product.foco_id}>
                  <td className="focus-number-cell">{meta > 0 ? num.format(meta) : '—'}</td>
                  <td className="focus-number-cell focus-realized-cell">{meta > 0 ? num.format(realizado) : '—'}</td>
                  <td className={`focus-number-cell focus-coverage-cell ${meta > 0 ? coverageClass(coverage) : ''}`}>{meta > 0 ? `${pct.format(coverage)}%` : '—'}</td>
                </Fragment>
              })}
            </tr>)}
            {!resultConsultants.length && <tr><td colSpan={2 + focusProducts.length * 3} className="focus-empty-row">{loading ? 'Carregando…' : 'Cadastre abaixo o primeiro produto e as metas deste período.'}</td></tr>}
          </tbody>
          {!!resultConsultants.length && <tfoot><tr>
            <td colSpan={2}>TOTAL</td>
            {focusProducts.map(product => {
              const total = totalsByProduct.get(product.foco_id) || { meta: 0, realizado: 0 }
              const coverage = total.meta > 0 ? total.realizado / total.meta * 100 : 0
              return <Fragment key={product.foco_id}>
                <td>{num.format(total.meta)}</td>
                <td>{num.format(total.realizado)}</td>
                <td className={coverageClass(coverage)}>{pct.format(coverage)}%</td>
              </Fragment>
            })}
          </tr></tfoot>}
        </table>
      </div>
    </section>

    <form className="operations-list focus-form focus-form-compact" onSubmit={event => void save(event)}>
      <div className="operations-heading focus-section-heading">
        <div>
          <h2>Cadastrar produto e metas</h2>
          <small>O produto será salvo para o período de {dateLabel(inicio)} a {dateLabel(fim)}.</small>
        </div>
        <span>{metasInformadas} consultores com meta</span>
      </div>

      <div className="focus-product-row">
        <label className="focus-product-picker">
          <span>Produto — pesquise pelo nome ou EAN</span>
          <div className={`focus-search-box ${listaProdutosAberta ? 'is-open' : ''}`}>
            <input
              value={produtoBusca}
              placeholder="Ex.: Apixabana ou 7896004782744"
              autoComplete="off"
              onFocus={() => setListaProdutosAberta(true)}
              onBlur={() => window.setTimeout(() => setListaProdutosAberta(false), 150)}
              onChange={event => {
                setProdutoBusca(event.target.value)
                setProdutoId('')
                setListaProdutosAberta(true)
              }}
            />
            {produtoBusca && <button type="button" className="focus-clear-product" onMouseDown={event => event.preventDefault()} onClick={limparProduto}>×</button>}
            {listaProdutosAberta && <div className="focus-product-options">
              {produtosFiltrados.map(product => <button type="button" key={product.id} className={product.id === produtoId ? 'selected' : ''} onMouseDown={event => event.preventDefault()} onClick={() => selecionarProduto(product)}>
                <strong>{product.descricao}</strong>
                <span>EAN {product.ean}{product.laboratorio ? ` · ${product.laboratorio}` : ''}</span>
              </button>)}
              {!produtosFiltrados.length && <div className="focus-no-products">Nenhum produto localizado.</div>}
            </div>}
          </div>
          {produtoSelecionado && <small className="focus-selected-product">Selecionado: <b>{produtoSelecionado.descricao}</b> · EAN {produtoSelecionado.ean}</small>}
        </label>
        <label className="focus-observation-field"><span>Observações</span><input value={observacoes} onChange={event => setObservacoes(event.target.value)} placeholder="Opcional" /></label>
      </div>

      <div className="focus-target-table-wrap">
        <table className="focus-target-table">
          <thead><tr><th>Setor</th><th>Consultor</th><th>Meta do produto</th></tr></thead>
          <tbody>{data.filtros.consultores.map(item => <tr key={item.id}>
            <td>{item.setor || '—'}</td>
            <td><strong>{item.nome}</strong></td>
            <td><input type="number" min="0" step="1" value={metas[item.id] || '0'} onChange={event => setMetas(current => ({ ...current, [item.id]: event.target.value }))} /></td>
          </tr>)}</tbody>
        </table>
      </div>

      <div className="focus-submit"><button className="primary-action" disabled={busy}>{busy ? 'Salvando…' : 'Salvar produto e metas'}</button></div>
    </form>
  </main>
}
