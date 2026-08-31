import { FormEvent, useMemo, useState } from 'react'
import './prestacao-contas.css'

type Category = 'RDV' | 'TRADE'

type ConsultantAccess = {
  login: string
  email: string
  nome: string
  consultor_id: string
}

type Report = {
  id: string
  nome: string
  categoria: Category
  consultor_login: string
  consultor_id: string
  consultor_nome: string
  criado_por: string
  criado_em: string
  atualizado_em: string
  quantidade_despesas: number
  total_centavos: number
}

type Expense = {
  id: string
  relatorio_id: string
  estabelecimento: string
  valor_centavos: number
  tipo_despesa: string
  data_despesa: string
  comprovante_nome: string
  comprovante_tipo: string
  comprovante_tamanho: number
  criado_em: string
}

type ApiData = {
  relatorios: Report[]
  despesas: Expense[]
}

const expenseTypes = [
  'Alimentação',
  'Combustível',
  'Hospedagem',
  'Pedágio',
  'Estacionamento',
  'Táxi / Aplicativo',
  'Passagem / Transporte',
  'Material promocional',
  'Evento / Ação de Trade',
  'Brinde / Amostra',
  'Outros',
]

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' })
const today = () => new Date().toISOString().slice(0, 10)

function formatMoneyFromCents(value: number) {
  return money.format((Number(value) || 0) / 100)
}

function formatDate(value: string) {
  if (!value) return '—'
  const date = value.length === 10 ? new Date(value + 'T12:00:00') : new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR').format(date)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function reportSuggestion(category: Category) {
  return category + ' ' + monthName.format(new Date()).toUpperCase()
}

async function optimizeReceipt(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Envie uma foto do comprovante em formato de imagem.')
  const maxBytes = 1_450_000
  if (file.size <= maxBytes && file.type !== 'image/png') return file

  const bitmap = await createImageBitmap(file)
  let width = bitmap.width
  let height = bitmap.height
  const maxDimension = 1800
  if (Math.max(width, height) > maxDimension) {
    const scale = maxDimension / Math.max(width, height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('Não foi possível preparar a foto do comprovante.')
  }

  let quality = 0.82
  let blob: Blob | null = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    canvas.width = width
    canvas.height = height
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= maxBytes) break
    width = Math.max(900, Math.round(width * 0.84))
    height = Math.max(900, Math.round(height * 0.84))
    quality = Math.max(0.58, quality - 0.07)
  }
  bitmap.close()

  if (!blob || blob.size > 1_600_000) {
    throw new Error('A foto ficou grande demais. Tire a foto mais próxima do comprovante e tente novamente.')
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'comprovante'
  return new File([blob], baseName + '.jpg', { type: 'image/jpeg', lastModified: Date.now() })
}

export default function PrestacaoContasModule({ onBack }: { onBack: () => void }) {
  const [consultant, setConsultant] = useState<ConsultantAccess | null>(null)
  const [accessLogin, setAccessLogin] = useState('')
  const [data, setData] = useState<ApiData>({ relatorios: [], despesas: [] })
  const [selectedId, setSelectedId] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'TODOS' | Category>('TODOS')
  const [newCategory, setNewCategory] = useState<Category>('RDV')
  const [newName, setNewName] = useState(reportSuggestion('RDV'))
  const [estabelecimento, setEstabelecimento] = useState('')
  const [valor, setValor] = useState('')
  const [tipoDespesa, setTipoDespesa] = useState(expenseTypes[0])
  const [dataDespesa, setDataDespesa] = useState(today())
  const [receipt, setReceipt] = useState<File | null>(null)
  const [inputKey, setInputKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const selectedReport = useMemo(
    () => data.relatorios.find(item => item.id === selectedId) || null,
    [data.relatorios, selectedId],
  )

  const visibleReports = useMemo(
    () => categoryFilter === 'TODOS'
      ? data.relatorios
      : data.relatorios.filter(item => item.categoria === categoryFilter),
    [data.relatorios, categoryFilter],
  )

  const summary = useMemo(() => ({
    total: data.relatorios.length,
    rdv: data.relatorios.filter(item => item.categoria === 'RDV').length,
    trade: data.relatorios.filter(item => item.categoria === 'TRADE').length,
    value: data.relatorios.reduce((sum, item) => sum + Number(item.total_centavos || 0), 0),
  }), [data.relatorios])

  async function load(reportId = selectedId, login = consultant?.login || '') {
    if (!login) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ consultor: login })
      if (reportId) params.set('relatorio', reportId)
      const response = await fetch('/api/prestacao-contas?' + params.toString(), { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível carregar a prestação de contas.')
      setData({
        relatorios: result.relatorios || [],
        despesas: result.despesas || [],
      })
      if (result.consultor) setConsultant(result.consultor)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  async function postJson(body: Record<string, unknown>) {
    const response = await fetch('/api/prestacao-contas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível concluir a operação.')
    return result
  }

  async function accessConsultant(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await postJson({ operacao: 'acessar-consultor', login: accessLogin })
      const nextConsultant = result.consultor as ConsultantAccess
      setConsultant(nextConsultant)
      setSelectedId('')
      setData({ relatorios: [], despesas: [] })
      setMessage('Acesso liberado para ' + nextConsultant.nome + '.')
      await load('', nextConsultant.login)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  function switchConsultant() {
    setConsultant(null)
    setAccessLogin('')
    setSelectedId('')
    setData({ relatorios: [], despesas: [] })
    setError('')
    setMessage('')
  }

  async function createReport(event: FormEvent) {
    event.preventDefault()
    if (!consultant) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await postJson({
        operacao: 'criar-relatorio',
        nome: newName,
        categoria: newCategory,
        consultor_login: consultant.login,
      })
      setMessage('Relatório criado para ' + consultant.nome + '. Agora você já pode incluir as despesas.')
      setSelectedId(result.id)
      setNewName(reportSuggestion(newCategory))
      await load(result.id, consultant.login)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function addExpense(event: FormEvent) {
    event.preventDefault()
    if (!selectedReport || !consultant) return
    if (!receipt) {
      setError('Inclua a foto do comprovante.')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')
    try {
      const optimized = await optimizeReceipt(receipt)
      const form = new FormData()
      form.set('operacao', 'salvar-despesa')
      form.set('consultor_login', consultant.login)
      form.set('relatorio_id', selectedReport.id)
      form.set('estabelecimento', estabelecimento)
      form.set('valor', valor)
      form.set('tipo_despesa', tipoDespesa)
      form.set('data_despesa', dataDespesa)
      form.set('comprovante', optimized)

      const response = await fetch('/api/prestacao-contas', { method: 'POST', body: form })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível incluir a despesa.')

      setEstabelecimento('')
      setValor('')
      setTipoDespesa(expenseTypes[0])
      setDataDespesa(today())
      setReceipt(null)
      setInputKey(current => current + 1)
      setMessage('Despesa e comprovante salvos com sucesso.')
      await load(selectedReport.id, consultant.login)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function deleteExpense(expense: Expense) {
    if (!consultant || !confirm('Excluir esta despesa e o comprovante salvo?')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await postJson({ operacao: 'excluir-despesa', id: expense.id, consultor_login: consultant.login })
      setMessage('Despesa excluída.')
      await load(selectedId, consultant.login)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function deleteReport(report: Report) {
    if (!consultant || !confirm('Excluir o relatório "' + report.nome + '" e todas as despesas dele?')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await postJson({ operacao: 'excluir-relatorio', id: report.id, consultor_login: consultant.login })
      if (selectedId === report.id) setSelectedId('')
      setMessage('Relatório excluído.')
      await load('', consultant.login)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  function openReport(report: Report) {
    if (!consultant) return
    setSelectedId(report.id)
    setMessage('')
    setError('')
    void load(report.id, consultant.login)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!consultant) {
    return <main className="content accounting-page">
      <button className="back-button" type="button" onClick={onBack}>← Voltar ao painel</button>

      <section className="accounting-access-shell">
        <div className="accounting-access-icon">▧</div>
        <span className="eyebrow">Prestação de Contas</span>
        <h1>Acessar consultor</h1>
        <p>Digite o mesmo login EMS usado para acessar o Painel. O módulo abrirá somente os relatórios vinculados a esse consultor.</p>

        <form className="accounting-access-form" onSubmit={event => void accessConsultant(event)}>
          <label>
            <span>LOGIN DO CONSULTOR</span>
            <input
              autoFocus
              autoComplete="username"
              value={accessLogin}
              onChange={event => setAccessLogin(event.target.value)}
              placeholder="Ex.: m0043497"
              required
            />
          </label>
          {error && <div className="alert alert-error accounting-alert">{error}</div>}
          <button className="primary-action" type="submit" disabled={busy}>
            {busy ? 'Validando…' : 'Acessar prestação de contas'}
          </button>
        </form>
      </section>
    </main>
  }

  if (selectedReport) {
    const receiptBase = '/api/prestacao-contas?consultor=' + encodeURIComponent(consultant.login) + '&comprovante='

    return <main className="content accounting-page">
      <div className="accounting-nav-actions">
        <button className="back-button" type="button" onClick={() => { setSelectedId(''); setData(current => ({ ...current, despesas: [] })) }}>← Voltar aos relatórios</button>
        <button className="outline-button" type="button" onClick={switchConsultant}>Trocar consultor</button>
      </div>

      <section className="accounting-consultant-bar">
        <div><span>CONSULTOR</span><strong>{consultant.nome}</strong></div>
        <div><span>LOGIN</span><strong>{consultant.login}</strong></div>
      </section>

      <section className="accounting-hero">
        <div>
          <span className="eyebrow">Prestação de contas · {selectedReport.categoria}</span>
          <h1>{selectedReport.nome}</h1>
          <p>Relatório de {consultant.nome}. Inclua cada despesa com a foto do comprovante e depois baixe o arquivo para lançar no Onfly.</p>
        </div>
        <div className="accounting-total">
          <span>Total do relatório</span>
          <strong>{formatMoneyFromCents(selectedReport.total_centavos)}</strong>
          <small>{selectedReport.quantidade_despesas} despesa(s)</small>
        </div>
      </section>

      {error && <div className="alert alert-error accounting-alert">{error}</div>}
      {message && <div className="alert alert-success accounting-alert">{message}</div>}

      <section className="accounting-card">
        <div className="accounting-card-heading">
          <div><span className="eyebrow">Nova despesa</span><h2>Incluir despesa</h2></div>
          <span className={'accounting-badge badge-' + selectedReport.categoria.toLowerCase()}>{selectedReport.categoria}</span>
        </div>

        <form className="accounting-expense-form" onSubmit={event => void addExpense(event)}>
          <label><span>FOTO DO COMPROVANTE</span><input key={inputKey} type="file" accept="image/*" capture="environment" onChange={event => setReceipt(event.target.files?.[0] || null)} required /><small>{receipt ? receipt.name : 'A foto será otimizada automaticamente antes de salvar.'}</small></label>
          <label><span>NOME DO ESTABELECIMENTO</span><input value={estabelecimento} onChange={event => setEstabelecimento(event.target.value)} placeholder="Ex.: Posto Avenida" maxLength={180} required /></label>
          <label><span>VALOR</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={valor} onChange={event => setValor(event.target.value)} placeholder="0,00" required /></label>
          <label><span>TIPO DE DESPESA</span><select value={tipoDespesa} onChange={event => setTipoDespesa(event.target.value)}>{expenseTypes.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>DATA DA DESPESA</span><input type="date" value={dataDespesa} onChange={event => setDataDespesa(event.target.value)} required /></label>
          <div className="accounting-form-action"><button className="primary-action" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar despesa'}</button></div>
        </form>
      </section>

      <section className="accounting-card">
        <div className="accounting-card-heading">
          <div><span className="eyebrow">Despesas lançadas</span><h2>{selectedReport.nome}</h2><p>{data.despesas.length} item(ns) salvo(s)</p></div>
        </div>
        <div className="accounting-table-wrap">
          <table className="accounting-table">
            <thead><tr><th>Data</th><th>Estabelecimento</th><th>Tipo</th><th>Valor</th><th>Comprovante</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="accounting-empty">Carregando despesas…</td></tr>}
              {!loading && data.despesas.map(expense => <tr key={expense.id}>
                <td>{formatDate(expense.data_despesa)}</td>
                <td><strong>{expense.estabelecimento}</strong><small>Salvo em {formatDateTime(expense.criado_em)}</small></td>
                <td><span className="accounting-type">{expense.tipo_despesa}</span></td>
                <td><strong>{formatMoneyFromCents(expense.valor_centavos)}</strong></td>
                <td><div className="accounting-receipt-actions">
                  <a className="outline-button accounting-compact" href={receiptBase + encodeURIComponent(expense.id)} target="_blank" rel="noreferrer">Abrir</a>
                  <a className="outline-button accounting-compact" href={receiptBase + encodeURIComponent(expense.id) + '&download=1'}>Baixar</a>
                </div><small>{expense.comprovante_nome}</small></td>
                <td><button className="danger-button accounting-compact" type="button" disabled={busy} onClick={() => void deleteExpense(expense)}>Excluir</button></td>
              </tr>)}
              {!loading && !data.despesas.length && <tr><td colSpan={6} className="accounting-empty">Ainda não há despesas neste relatório.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  }

  return <main className="content accounting-page">
    <div className="accounting-nav-actions">
      <button className="back-button" type="button" onClick={onBack}>← Voltar ao painel</button>
      <button className="outline-button" type="button" onClick={switchConsultant}>Trocar consultor</button>
    </div>

    <section className="accounting-consultant-bar">
      <div><span>CONSULTOR</span><strong>{consultant.nome}</strong></div>
      <div><span>LOGIN</span><strong>{consultant.login}</strong></div>
    </section>

    <section className="accounting-hero">
      <div>
        <span className="eyebrow">Organização antes do Onfly</span>
        <h1>Prestação de Contas</h1>
        <p>Relatórios de RDV e TRADE vinculados exclusivamente a {consultant.nome}. Cada novo relatório criado nesta tela ficará registrado para este consultor.</p>
      </div>
      <div className="accounting-total">
        <span>Total armazenado</span>
        <strong>{formatMoneyFromCents(summary.value)}</strong>
        <small>{summary.total} relatório(s)</small>
      </div>
    </section>

    {error && <div className="alert alert-error accounting-alert">{error}</div>}
    {message && <div className="alert alert-success accounting-alert">{message}</div>}

    <section className="accounting-summary">
      <article><span>Relatórios</span><strong>{loading ? '—' : summary.total}</strong><small>RDV + TRADE</small></article>
      <article><span>RDV</span><strong>{loading ? '—' : summary.rdv}</strong><small>Relatórios de despesas</small></article>
      <article><span>TRADE</span><strong>{loading ? '—' : summary.trade}</strong><small>Ações e materiais</small></article>
      <article><span>Valor total</span><strong>{loading ? '—' : formatMoneyFromCents(summary.value)}</strong><small>Somatório das despesas</small></article>
    </section>

    <section className="accounting-card">
      <div className="accounting-card-heading"><div><span className="eyebrow">Novo relatório</span><h2>Criar relatório para {consultant.nome}</h2><p>Exemplo: RDV JUNHO ou TRADE CAMPANHA X.</p></div></div>
      <form className="accounting-report-form" onSubmit={event => void createReport(event)}>
        <label><span>TIPO</span><select value={newCategory} onChange={event => { const category = event.target.value as Category; setNewCategory(category); setNewName(reportSuggestion(category)) }}><option value="RDV">RDV</option><option value="TRADE">TRADE</option></select></label>
        <label className="accounting-report-name"><span>NOME DO RELATÓRIO</span><input value={newName} onChange={event => setNewName(event.target.value)} placeholder="Ex.: RDV JUNHO" maxLength={120} required /></label>
        <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar relatório'}</button>
      </form>
    </section>

    <section className="accounting-card">
      <div className="accounting-list-heading">
        <div><span className="eyebrow">Relatórios do consultor</span><h2>{consultant.nome}</h2><p>Login: {consultant.login}</p></div>
        <div className="accounting-tabs">
          {(['TODOS', 'RDV', 'TRADE'] as const).map(item => <button key={item} type="button" className={categoryFilter === item ? 'active' : ''} onClick={() => setCategoryFilter(item)}>{item}</button>)}
        </div>
      </div>

      <div className="accounting-report-grid">
        {loading && <div className="accounting-empty">Carregando relatórios…</div>}
        {!loading && visibleReports.map(report => <article className="accounting-report-card" key={report.id}>
          <div className="accounting-report-top"><span className={'accounting-badge badge-' + report.categoria.toLowerCase()}>{report.categoria}</span><small>{formatDateTime(report.atualizado_em)}</small></div>
          <h3>{report.nome}</h3>
          <small className="accounting-report-owner">{report.consultor_nome || consultant.nome} · {report.consultor_login || consultant.login}</small>
          <div className="accounting-report-value"><strong>{formatMoneyFromCents(report.total_centavos)}</strong><span>{report.quantidade_despesas} despesa(s)</span></div>
          <div className="accounting-report-actions"><button className="primary-action" type="button" onClick={() => openReport(report)}>Abrir relatório</button><button className="danger-button" type="button" disabled={busy} onClick={() => void deleteReport(report)}>Excluir</button></div>
        </article>)}
        {!loading && !visibleReports.length && <div className="accounting-empty">Nenhum relatório encontrado para este consultor. Crie o primeiro acima.</div>}
      </div>
    </section>
  </main>
}
