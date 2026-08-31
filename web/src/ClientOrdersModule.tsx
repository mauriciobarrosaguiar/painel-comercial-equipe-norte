import { useEffect, useMemo, useRef, useState } from 'react'
import './operations.css'
import './client-orders.css'

type Summary = {
  pedidos?: number
  clientes_com_pedido?: number
  valor_pedidos?: number
  valor_faturado?: number
  valor_cancelado?: number
  atendimento_pct?: number
  faturamento_pct?: number
  itens?: number
}

type ClientRow = {
  cnpj: string
  cliente_nome: string
  uf: string
  consultor: string
  pedidos: number
  valor_pedidos: number
  valor_faturado: number
  solicitado: number
  atendido: number
  cancelado: number
  faturado: number
}

type OrderRow = {
  id: string
  cnpj: string
  cliente_nome: string
  cliente_uf: string
  consultor_nome: string
  pedido_numero: string
  status: string
  distribuidora: string
  laboratorio: string
  data_criacao: string
  hora_criacao: string
  total_pedido: number
  total_atendido: number
  total_faturado: number
  desconto: number
  qtd_itens: number
}

type Execution = {
  id: string
  uf: string
  inicio_periodo: string
  fim_periodo: string
  status: string
  clientes_total: number
  clientes_processados: number
  clientes_com_erro: number
  pedidos_total: number
  itens_total: number
  mensagem: string
  erro: string
  iniciado_em: string
  finalizado_em: string | null
}

type Data = {
  resumo: Summary
  clientes: ClientRow[]
  pedidos: OrderRow[]
  execucoes: Execution[]
  aviso?: string
  atualizado_em: string
}

type Command = {
  id: string
  tipo: string
  status: string
  mensagem: string
  erro: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const number = new Intl.NumberFormat('pt-BR')
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const activeStatuses = new Set(['aguardando', 'encaminhando', 'executando'])

function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

const initialToday = today()
const initialStart = `${initialToday.slice(0, 8)}01`

const formatDate = (value: string) => {
  if (!value || value.length < 10) return '—'
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
}

const dateTime = (value: string | null | undefined) => {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('pt-BR')
}

const statusClass = (value: string) => {
  const normalized = String(value || '').toLowerCase()
  if (normalized.includes('faturado') && !normalized.includes('parcial')) return 'is-good'
  if (normalized.includes('cancel')) return 'is-bad'
  if (normalized.includes('parcial') || normalized.includes('process')) return 'is-warning'
  return 'is-neutral'
}

export default function ClientOrdersModule({ onBack }: { onBack: () => void }) {
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialToday)
  const [uf, setUf] = useState('')
  const [data, setData] = useState<Data>({ resumo: {}, clientes: [], pedidos: [], execucoes: [], atualizado_em: '' })
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [command, setCommand] = useState<Command | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const hadActive = useRef(false)

  const query = useMemo(() => {
    const params = new URLSearchParams({ inicio: start, fim: end })
    if (uf) params.set('uf', uf)
    return params.toString()
  }, [start, end, uf])

  async function loadAnalysis() {
    if (!start || !end || start > end) return
    setLoading(true)
    try {
      const response = await fetch(`/api/pedidos-clientes?${query}`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao consultar pedidos.')
      setData(result)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  async function loadCommand() {
    try {
      const response = await fetch('/api/automacoes', { cache: 'no-store' })
      if (!response.ok) return
      const result = await response.json()
      const current = (result.comandos || []).find(
        (item: Command) => item.tipo === 'PEDIDOS_CLIENTES' && activeStatuses.has(String(item.status || '').toLowerCase()),
      ) || null
      setCommand(current)
      setRunning(Boolean(current))
      if (current) {
        hadActive.current = true
      } else if (hadActive.current) {
        hadActive.current = false
        await loadAnalysis()
      }
    } catch {
      // O painel de análise continua funcional mesmo que a consulta de status falhe.
    }
  }

  useEffect(() => {
    void loadAnalysis()
  }, [query])

  useEffect(() => {
    void loadCommand()
    const timer = window.setInterval(() => void loadCommand(), 5000)
    return () => window.clearInterval(timer)
  }, [query])

  async function runExtraction() {
    setError('')
    setMessage('')
    if (!start || !end) {
      setError('Informe a data inicial e a data final.')
      return
    }
    if (start > end) {
      setError('A data inicial não pode ser posterior à data final.')
      return
    }
    setRunning(true)
    try {
      const response = await fetch('/api/automacoes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tipo: 'PEDIDOS_CLIENTES',
          parametros: {
            inicio: start,
            fim: end,
            ufs: uf || 'MA,MT,PA,PI,TO',
          },
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível iniciar a extração.')
      setMessage(result.mensagem || 'Extração de pedidos iniciada.')
      hadActive.current = true
      await loadCommand()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setRunning(false)
    }
  }

  const summary = data.resumo || {}
  const activeExecution = data.execucoes?.find(item => item.status === 'executando')
  const progress = activeExecution && activeExecution.clientes_total > 0
    ? Math.min(100, activeExecution.clientes_processados / activeExecution.clientes_total * 100)
    : 0

  return <main className="content client-orders-page">
    <button className="back-button" type="button" onClick={onBack}>← Voltar ao painel</button>

    <section className="client-orders-hero">
      <div>
        <span className="eyebrow">Mercado Farma</span>
        <h1>Pedidos dos Clientes</h1>
        <p>Extração cliente por cliente, com análise dos pedidos e itens dentro do período escolhido.</p>
      </div>
      <div className="client-orders-hero-badge">
        <span>Período analisado</span>
        <strong>{formatDate(start)} → {formatDate(end)}</strong>
      </div>
    </section>

    <section className="client-orders-controls">
      <label>
        <span>Data inicial</span>
        <input type="date" value={start} onChange={event => setStart(event.target.value)} />
      </label>
      <label>
        <span>Data final</span>
        <input type="date" value={end} onChange={event => setEnd(event.target.value)} />
      </label>
      <label>
        <span>UF</span>
        <select value={uf} onChange={event => setUf(event.target.value)}>
          <option value="">Todas</option>
          {['MA', 'MT', 'PA', 'PI', 'TO'].map(item => <option value={item} key={item}>{item}</option>)}
        </select>
      </label>
      <button className="primary-action client-orders-run" type="button" disabled={running} onClick={() => void runExtraction()}>
        {running ? 'Extração em andamento' : 'Extrair pedidos do período'}
      </button>
    </section>

    <div className="client-orders-note">
      A automação entra em cada CNPJ ativo da carteira, abre <strong>Meus Pedidos</strong>, filtra pela data de criação e percorre automaticamente todas as páginas disponíveis. Dentro de cada pedido, também clica em <strong>Próximo</strong> até extrair todas as páginas de itens.
    </div>

    {error && <div className="alert alert-error"><strong>Não foi possível concluir:</strong> {error}</div>}
    {message && <div className="alert alert-success">{message}</div>}
    {data.aviso && <div className="alert alert-error">{data.aviso}</div>}

    {(command || activeExecution) && <section className="client-orders-progress">
      <div>
        <strong>{command?.status === 'aguardando' ? 'Extração aguardando início' : 'Extração em andamento'}</strong>
        <span>{activeExecution?.mensagem || command?.mensagem || 'Processando clientes no Mercado Farma.'}</span>
      </div>
      {activeExecution && <div className="client-orders-progress-value">
        <b>{activeExecution.clientes_processados}/{activeExecution.clientes_total}</b>
        <small>clientes · {pct.format(progress)}%</small>
      </div>}
    </section>}

    <section className="client-orders-metrics">
      <article><span>Pedidos</span><strong>{loading ? '—' : number.format(summary.pedidos || 0)}</strong><small>no período selecionado</small></article>
      <article><span>Clientes com pedido</span><strong>{loading ? '—' : number.format(summary.clientes_com_pedido || 0)}</strong><small>CNPJs positivados por pedido</small></article>
      <article><span>Valor dos pedidos</span><strong>{loading ? '—' : money.format(summary.valor_pedidos || 0)}</strong><small>valor solicitado no Mercado Farma</small></article>
      <article><span>Valor faturado</span><strong>{loading ? '—' : money.format(summary.valor_faturado || 0)}</strong><small>informado nos detalhes dos pedidos</small></article>
      <article><span>Valor cancelado</span><strong>{loading ? '—' : money.format(summary.valor_cancelado || 0)}</strong><small>estimado pelos itens cancelados</small></article>
      <article><span>Atendimento</span><strong>{loading ? '—' : `${pct.format(summary.atendimento_pct || 0)}%`}</strong><small>{pct.format(summary.faturamento_pct || 0)}% das unidades faturadas</small></article>
    </section>

    <section className="client-orders-section">
      <div className="client-orders-heading">
        <div><span className="eyebrow">Clientes</span><h2>Resultado por cliente</h2></div>
        <span>{data.clientes?.length || 0} clientes com pedidos</span>
      </div>
      <div className="client-orders-table-wrap">
        <table className="client-orders-table">
          <thead><tr><th>Cliente</th><th>UF</th><th>Consultor</th><th>Pedidos</th><th>Solicitado</th><th>Atendido</th><th>Faturado</th><th>Valor pedidos</th><th>Valor faturado</th></tr></thead>
          <tbody>
            {!data.clientes?.length && <tr><td colSpan={9} className="client-orders-empty">{loading ? 'Carregando…' : 'Nenhum pedido extraído para este período.'}</td></tr>}
            {(data.clientes || []).map(item => <tr key={item.cnpj}>
              <td><strong>{item.cliente_nome || 'Cliente sem nome'}</strong><small>{item.cnpj}</small></td>
              <td>{item.uf}</td>
              <td>{item.consultor || '—'}</td>
              <td>{number.format(Number(item.pedidos || 0))}</td>
              <td>{number.format(Number(item.solicitado || 0))}</td>
              <td>{number.format(Number(item.atendido || 0))}</td>
              <td>{number.format(Number(item.faturado || 0))}</td>
              <td>{money.format(Number(item.valor_pedidos || 0))}</td>
              <td>{money.format(Number(item.valor_faturado || 0))}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className="client-orders-section">
      <div className="client-orders-heading">
        <div><span className="eyebrow">Pedidos</span><h2>Pedidos encontrados</h2></div>
        <button className="outline-button" type="button" onClick={() => void loadAnalysis()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button>
      </div>
      <div className="client-orders-table-wrap">
        <table className="client-orders-table">
          <thead><tr><th>Data</th><th>Pedido</th><th>Cliente</th><th>Distribuidora</th><th>Itens</th><th>Total</th><th>Faturado</th><th>Status</th></tr></thead>
          <tbody>
            {!data.pedidos?.length && <tr><td colSpan={8} className="client-orders-empty">{loading ? 'Carregando…' : 'Nenhum pedido encontrado.'}</td></tr>}
            {(data.pedidos || []).map(item => <tr key={item.id}>
              <td>{formatDate(item.data_criacao)}<small>{item.hora_criacao || ''}</small></td>
              <td><strong>#{item.pedido_numero}</strong><small>{item.cliente_uf}</small></td>
              <td><strong>{item.cliente_nome || 'Cliente sem nome'}</strong><small>{item.cnpj}</small></td>
              <td>{item.distribuidora || '—'}</td>
              <td>{number.format(Number(item.qtd_itens || 0))}</td>
              <td>{money.format(Number(item.total_pedido || 0))}</td>
              <td>{money.format(Number(item.total_faturado || 0))}</td>
              <td><span className={`client-order-status ${statusClass(item.status)}`}>{item.status || 'Sem status'}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className="client-orders-section">
      <div className="client-orders-heading">
        <div><span className="eyebrow">Histórico</span><h2>Últimas extrações</h2></div>
        <small>Atualizado em {dateTime(data.atualizado_em)}</small>
      </div>
      <div className="client-orders-executions">
        {!data.execucoes?.length && <div className="client-orders-empty">Nenhuma extração registrada.</div>}
        {(data.execucoes || []).map(item => <article key={item.id}>
          <div>
            <strong>{item.uf} · {formatDate(item.inicio_periodo)} → {formatDate(item.fim_periodo)}</strong>
            <span>{item.mensagem || item.erro || 'Sem detalhes.'}</span>
          </div>
          <div>
            <b className={`client-order-status ${item.status === 'concluido' ? 'is-good' : item.status === 'erro' ? 'is-bad' : 'is-warning'}`}>{item.status}</b>
            <small>{item.clientes_processados}/{item.clientes_total} clientes · {item.pedidos_total} pedidos · {item.itens_total} itens</small>
          </div>
        </article>)}
      </div>
    </section>
  </main>
}
