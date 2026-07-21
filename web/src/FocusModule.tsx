import { FormEvent, useEffect, useMemo, useState } from 'react'
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

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const local = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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
  const [data, setData] = useState<Data>({
    periodo: currentWeek,
    linhas: [],
    filtros: { consultores: [], ufs: [], produtos: [] },
  })
  const [produtoId, setProdutoId] = useState('')
  const [produtoBusca, setProdutoBusca] = useState('')
  const [listaProdutosAberta, setListaProdutosAberta] = useState(false)
  const [observacoes, setObservacoes] = useState('')
  const [metas, setMetas] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
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
        for (const item of result.filtros?.consultores || []) {
          if (next[item.id] === undefined) next[item.id] = '0'
        }
        return next
      })
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
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
    const candidates = data.filtros.produtos.filter(item => {
      if (!query && !digits) return true
      return normalizar(item.descricao).includes(query) || item.ean.includes(digits || produtoBusca.trim())
    })
    return candidates
      .sort((a, b) => {
        const aPrefix = normalizar(a.descricao).startsWith(query) || a.ean.startsWith(digits) ? 0 : 1
        const bPrefix = normalizar(b.descricao).startsWith(query) || b.ean.startsWith(digits) ? 0 : 1
        return aPrefix - bPrefix || a.descricao.localeCompare(b.descricao, 'pt-BR')
      })
      .slice(0, 40)
  }, [data.filtros.produtos, produtoBusca])

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
      setMessage(`Produto foco salvo para ${result.consultores} consultores.`)
      limparProduto()
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

  async function remove(id: string) {
    if (!confirm('Remover este produto foco de todos os consultores?')) return
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

  const totals = data.linhas.reduce(
    (total, item) => ({
      meta: total.meta + item.meta_quantidade,
      realizado: total.realizado + item.realizado_quantidade,
      cnpj: total.cnpj + item.cnpj_positivados,
      faturamento: total.faturamento + item.faturamento,
    }),
    { meta: 0, realizado: 0, cnpj: 0, faturamento: 0 },
  )
  const totalCoverage = totals.meta > 0 ? (totals.realizado / totals.meta) * 100 : 0
  const produtos = new Set(data.linhas.map(item => item.foco_id)).size
  const metasInformadas = Object.values(metas).filter(value => Number(value) > 0).length
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
        <span className="eyebrow">Execução comercial</span>
        <h1>Foco Semanal</h1>
        <p>Metas individuais por consultor e produto, com realizado e CNPJs positivados.</p>
      </div>
      <div className="market-hero-actions">
        <span>{produtos} produtos ativos</span>
        <a className="secondary-button market-download" href={`/api/exportar?${exportParams}`}>Clientes que não compraram</a>
      </div>
    </section>

    <section className="filters history-filters focus-filters">
      <label><span>Início</span><input type="date" value={inicio} onChange={event => setInicio(event.target.value)} /></label>
      <label><span>Fim</span><input type="date" value={fim} onChange={event => setFim(event.target.value)} /></label>
      <label><span>Consultor</span><select value={consultor} onChange={event => setConsultor(event.target.value)}><option value="">Todos</option>{data.filtros.consultores.map(item => <option value={item.id} key={item.id}>{item.nome}</option>)}</select></label>
      <label><span>UF</span><select value={uf} onChange={event => setUf(event.target.value)}><option value="">Todas</option>{data.filtros.ufs.map(item => <option key={item}>{item}</option>)}</select></label>
    </section>

    {error && <div className="alert alert-error">{error}</div>}
    {message && <div className="alert alert-success">{message}</div>}
    {data.aviso && <div className="alert alert-error">{data.aviso}</div>}

    <section className="market-summary focus-summary">
      <article><span>Meta</span><strong>{num.format(totals.meta)}</strong><small>unidades</small></article>
      <article><span>Realizado</span><strong>{num.format(totals.realizado)}</strong><small>quantidade faturada</small></article>
      <article><span>Cobertura</span><strong>{pct.format(totalCoverage)}%</strong><small>realizado ÷ meta</small></article>
      <article><span>CNPJ positivado</span><strong>{num.format(totals.cnpj)}</strong><small>por produto e consultor</small></article>
      <article><span>Faturamento</span><strong>{money.format(totals.faturamento)}</strong></article>
    </section>

    <section className="operations-list focus-results">
      <div className="operations-heading focus-section-heading">
        <h2>Resultado por consultor e produto</h2>
        <span>{data.linhas.length} linhas</span>
      </div>
      <div className="market-table-wrap focus-table-wrap">
        <table className="market-table focus-consultant-table">
          <thead>
            <tr>
              <th className="focus-head-blue">Setor</th>
              <th className="focus-head-blue">Consultor</th>
              <th className="focus-head-orange">Produto</th>
              <th className="focus-head-orange number-column">Meta</th>
              <th className="focus-head-orange number-column">Realizado</th>
              <th className="focus-head-orange number-column">% cobertura</th>
              <th className="focus-head-green number-column">CNPJ positivado</th>
              <th className="focus-head-green money-column">Faturamento</th>
              <th className="focus-head-action" aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {data.linhas.map(item => <tr key={item.id}>
              <td className="focus-sector">{item.setor || '—'}</td>
              <td className="focus-consultant"><strong>{item.consultor}</strong></td>
              <td className="focus-product-cell"><strong>{item.descricao}</strong><small>{item.ean}{item.observacoes ? ` · ${item.observacoes}` : ''}</small></td>
              <td className="number-column">{num.format(item.meta_quantidade)}</td>
              <td className="number-column focus-realized">{num.format(item.realizado_quantidade)}</td>
              <td className={`number-column focus-coverage ${coverageClass(item.cobertura_percentual)}`}><b>{pct.format(item.cobertura_percentual)}%</b></td>
              <td className="number-column">{num.format(item.cnpj_positivados)}</td>
              <td className="money-column">{money.format(item.faturamento)}</td>
              <td className="focus-action-cell"><button className="danger-button focus-remove" title="Remover produto foco" onClick={() => void remove(item.foco_id)}>Remover</button></td>
            </tr>)}
            {!data.linhas.length && <tr><td colSpan={9} className="focus-empty-row">Nenhum produto foco nesse período.</td></tr>}
          </tbody>
          {!!data.linhas.length && <tfoot>
            <tr>
              <td colSpan={3}>TOTAL</td>
              <td className="number-column">{num.format(totals.meta)}</td>
              <td className="number-column">{num.format(totals.realizado)}</td>
              <td className={`number-column focus-coverage ${coverageClass(totalCoverage)}`}>{pct.format(totalCoverage)}%</td>
              <td className="number-column">{num.format(totals.cnpj)}</td>
              <td className="money-column">{money.format(totals.faturamento)}</td>
              <td />
            </tr>
          </tfoot>}
        </table>
      </div>
    </section>

    <form className="operations-list focus-form focus-form-compact" onSubmit={event => void save(event)}>
      <div className="operations-heading focus-section-heading">
        <div>
          <h2>Cadastrar produto e metas</h2>
          <small>Pesquise no catálogo pelo nome ou EAN e informe a meta em unidades.</small>
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
              {produtosFiltrados.map(product => <button
                type="button"
                key={product.id}
                className={product.id === produtoId ? 'selected' : ''}
                onMouseDown={event => event.preventDefault()}
                onClick={() => selecionarProduto(product)}
              >
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
          <thead><tr><th>Setor</th><th>Consultor</th><th>Meta em unidades</th></tr></thead>
          <tbody>{data.filtros.consultores.map(item => <tr key={item.id}>
            <td>{item.setor || '—'}</td>
            <td><strong>{item.nome}</strong></td>
            <td><input type="number" min="0" step="1" value={metas[item.id] || '0'} onChange={event => setMetas(current => ({ ...current, [item.id]: event.target.value }))} /></td>
          </tr>)}</tbody>
        </table>
      </div>

      <div className="focus-submit">
        <button className="primary-action" disabled={busy}>{busy ? 'Salvando…' : 'Salvar metas do produto'}</button>
      </div>
    </form>
  </main>
}
