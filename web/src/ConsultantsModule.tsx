import { useEffect, useMemo, useState } from 'react'
import './consultants.css'

type Period = 'mes-atual' | 'mes-anterior' | 'todo-periodo' | 'personalizado'
type Row = {
  id: string
  nome: string
  setor: string
  clientes_ativos: number
  clientes_com_venda: number
  clientes_sem_venda: number
  pedidos_faturados: number
  pedidos_nao_faturados: number
  valor_nao_faturado: number
  ol_total_faturado: number
  ol_sem_combate: number
  ol_prioritarios: number
  ol_lancamentos: number
  meta_ol_sem_combate: number
  meta_ol_prioritarios: number
  meta_ol_lancamentos: number
  resultado_meta_ol: number
}
type Data = {
  periodo: { tipo: Period; inicio: string | null; fim: string | null; rotulo: string }
  uf: string
  ufs: string[]
  consultores: Row[]
  totais: Record<string, any>
  atualizado_em: string
}
type OrderDetail = {
  id: string
  tipo: 'FATURADO' | 'NAO_FATURADO'
  pedido: string
  nota_fiscal: string
  status: string
  data_pedido: string
  data_faturamento: string
  cnpj: string
  cliente: string
  cidade: string
  uf: string
  centro_distribuicao: string
  uf_centro_distribuicao: string
  itens: number
  quantidade_solicitada: number
  quantidade_atendida: number
  quantidade_faturada: number
  valor_solicitado_sem_imposto: number
  valor_atendido_sem_imposto: number
  valor_faturado: number
  valor_considerado: number
}
type ConsultantDetails = {
  consultor: { id: string; nome: string; setor: string }
  periodo: { inicio: string | null; fim: string | null; rotulo: string; uf: string }
  resumo: {
    pedidos_faturados: number
    valor_faturado: number
    pedidos_nao_faturados: number
    valor_nao_faturado: number
  }
  faturados: OrderDetail[]
  nao_faturados: OrderDetail[]
  regra: string
}
type OrdersGroupProps = {
  title: string
  rows: OrderDetail[]
  pending?: boolean
  deletingOrderId?: string
  onDelete?: (order: OrderDetail) => void
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const ratio = (value: number, meta: number) => meta > 0 ? value / meta * 100 : 0
const cls = (value: number) => value >= 100 ? 'result-good' : value >= 80 ? 'result-warning' : 'result-low'
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const bounds = (offset: number) => {
  const now = new Date()
  return {
    inicio: iso(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
    fim: iso(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)),
  }
}
const current = bounds(0)
const dateLabel = (value: string) => {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}
const safeFileName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'consultor'
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
const csvNumber = (value: number) => Number(value || 0).toFixed(2).replace('.', ',')

function OrdersGroup({ title, rows, pending, deletingOrderId, onDelete }: OrdersGroupProps) {
  return (
    <section className="consultant-orders-group">
      <div className="consultant-orders-group-heading">
        <h5>{title}</h5>
        <span>{num.format(rows.length)}</span>
      </div>
      {!rows.length ? (
        <p className="consultant-orders-empty">Nenhum pedido neste período.</p>
      ) : (
        <div className="consultant-order-list">
          {rows.map((order) => {
            const deleting = deletingOrderId === order.id
            return (
              <article className={`consultant-order-row${pending ? ' has-actions' : ''}`} key={`${order.tipo}-${order.id}`}>
                <div className="consultant-order-main">
                  <strong>Pedido {order.pedido || order.id}</strong>
                  <span>{order.nota_fiscal ? `NF ${order.nota_fiscal} · ` : ''}{order.status}</span>
                </div>
                <div>
                  <span>Cliente</span>
                  <b>{order.cliente}</b>
                  <small>{order.cnpj || `${order.cidade}${order.uf ? `/${order.uf}` : ''}`}</small>
                </div>
                <div>
                  <span>{pending ? 'Data do pedido' : 'Faturamento'}</span>
                  <b>{dateLabel(pending ? order.data_pedido : (order.data_faturamento || order.data_pedido))}</b>
                  <small>{num.format(order.itens)} itens</small>
                </div>
                <div className="consultant-order-value">
                  <span>{pending ? 'A faturar' : 'Faturado'}</span>
                  <b>{money.format(pending ? order.valor_considerado : order.valor_faturado)}</b>
                </div>
                {pending && onDelete && (
                  <button
                    type="button"
                    className="consultant-order-delete"
                    disabled={Boolean(deletingOrderId)}
                    onClick={() => onDelete(order)}
                    aria-label={`Excluir pedido ${order.pedido || order.id}`}
                  >
                    {deleting ? 'Excluindo…' : 'Excluir'}
                  </button>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default function ConsultantsModule({ onBack }: { onBack: () => void }) {
  const [period, setPeriod] = useState<Period>('mes-atual')
  const [uf, setUf] = useState('')
  const [start, setStart] = useState(current.inicio)
  const [end, setEnd] = useState(current.fim)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState('')
  const [details, setDetails] = useState<Record<string, ConsultantDetails>>({})
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({})
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({})
  const [detailMessages, setDetailMessages] = useState<Record<string, string>>({})
  const [deletingOrderId, setDeletingOrderId] = useState('')

  const selected = useMemo(() => period === 'mes-atual'
    ? bounds(0)
    : period === 'mes-anterior'
      ? bounds(-1)
      : period === 'personalizado'
        ? { inicio: start, fim: end }
        : { inicio: '', fim: '' }, [period, start, end])

  useEffect(() => {
    if (period === 'personalizado' && (!start || !end)) return undefined
    const controller = new AbortController()
    const params = new URLSearchParams({ periodo: period })
    if (selected.inicio && selected.fim) {
      params.set('inicio', selected.inicio)
      params.set('fim', selected.fim)
    }
    if (uf) params.set('uf', uf)
    setLoading(true)
    setExpanded('')
    setDetails({})
    setDetailErrors({})
    setDetailMessages({})
    fetch(`/api/consultores?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao carregar consultores')
        setData(result)
        setError('')
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [period, uf, start, end, selected.inicio, selected.fim])

  const detailParams = (consultantId: string) => {
    const params = new URLSearchParams({ periodo: period, consultor: consultantId })
    if (selected.inicio && selected.fim) {
      params.set('inicio', selected.inicio)
      params.set('fim', selected.fim)
    }
    if (uf) params.set('uf', uf)
    return params
  }

  const loadDetails = async (consultantId: string) => {
    if (details[consultantId]) return details[consultantId]
    setDetailLoading((currentState) => ({ ...currentState, [consultantId]: true }))
    setDetailErrors((currentState) => ({ ...currentState, [consultantId]: '' }))
    try {
      const response = await fetch(`/api/consultor-pedidos?${detailParams(consultantId)}`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao carregar pedidos')
      setDetails((currentState) => ({ ...currentState, [consultantId]: result }))
      return result as ConsultantDetails
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setDetailErrors((currentState) => ({ ...currentState, [consultantId]: message }))
      throw reason
    } finally {
      setDetailLoading((currentState) => ({ ...currentState, [consultantId]: false }))
    }
  }

  const toggleConsultant = async (consultantId: string) => {
    if (expanded === consultantId) {
      setExpanded('')
      return
    }
    setExpanded(consultantId)
    if (!details[consultantId]) {
      try { await loadDetails(consultantId) } catch { /* erro aparece dentro do card */ }
    }
  }

  const deletePendingOrder = async (consultant: Row, order: OrderDetail) => {
    const orderLabel = order.pedido || order.id
    const confirmed = window.confirm(
      `Excluir o pedido ${orderLabel} de ${order.cliente}?\n\nEle deixará de aparecer nos resultados e não voltará na próxima atualização.`,
    )
    if (!confirmed) return

    setDeletingOrderId(order.id)
    setDetailErrors((currentState) => ({ ...currentState, [consultant.id]: '' }))
    setDetailMessages((currentState) => ({ ...currentState, [consultant.id]: '' }))
    try {
      const params = new URLSearchParams({ consultor: consultant.id, pedido: order.id })
      const response = await fetch(`/api/consultor-pedidos?${params}`, { method: 'DELETE', cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao excluir pedido')

      const removedValue = Number(order.valor_considerado || 0)
      setDetails((currentState) => {
        const currentDetail = currentState[consultant.id]
        if (!currentDetail) return currentState
        return {
          ...currentState,
          [consultant.id]: {
            ...currentDetail,
            resumo: {
              ...currentDetail.resumo,
              pedidos_nao_faturados: Math.max(0, currentDetail.resumo.pedidos_nao_faturados - 1),
              valor_nao_faturado: Math.max(0, currentDetail.resumo.valor_nao_faturado - removedValue),
            },
            nao_faturados: currentDetail.nao_faturados.filter((item) => item.id !== order.id),
          },
        }
      })
      setData((currentData) => currentData ? {
        ...currentData,
        consultores: currentData.consultores.map((item) => item.id === consultant.id ? {
          ...item,
          pedidos_nao_faturados: Math.max(0, item.pedidos_nao_faturados - 1),
          valor_nao_faturado: Math.max(0, item.valor_nao_faturado - removedValue),
        } : item),
      } : currentData)
      setDetailMessages((currentState) => ({
        ...currentState,
        [consultant.id]: result.mensagem || `Pedido ${orderLabel} excluído.`,
      }))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setDetailErrors((currentState) => ({ ...currentState, [consultant.id]: message }))
    } finally {
      setDeletingOrderId('')
    }
  }

  const downloadDetails = async (consultant: Row) => {
    let result = details[consultant.id]
    if (!result) {
      try { result = await loadDetails(consultant.id) } catch { return }
    }
    const rows = [...result.faturados, ...result.nao_faturados]
    const headers = [
      'Tipo', 'Consultor', 'Setor', 'Pedido', 'Nota fiscal', 'Status', 'Data do pedido',
      'Data de faturamento', 'CNPJ', 'Cliente', 'Cidade', 'UF', 'Centro de distribuição',
      'UF do CD', 'Itens', 'Qtde solicitada', 'Qtde atendida', 'Qtde faturada',
      'Valor solicitado sem imposto', 'Valor atendido sem imposto', 'Valor faturado',
      'Valor considerado como não faturado',
    ]
    const content = [
      headers.map(csvCell).join(';'),
      ...rows.map((order) => [
        order.tipo === 'FATURADO' ? 'Faturado' : 'Ainda não faturado', result.consultor.nome,
        result.consultor.setor, order.pedido, order.nota_fiscal, order.status,
        dateLabel(order.data_pedido), dateLabel(order.data_faturamento), order.cnpj, order.cliente,
        order.cidade, order.uf, order.centro_distribuicao, order.uf_centro_distribuicao,
        order.itens, order.quantidade_solicitada, order.quantidade_atendida, order.quantidade_faturada,
        csvNumber(order.valor_solicitado_sem_imposto), csvNumber(order.valor_atendido_sem_imposto),
        csvNumber(order.valor_faturado), csvNumber(order.tipo === 'NAO_FATURADO' ? order.valor_considerado : 0),
      ].map(csvCell).join(';')),
    ].join('\r\n')
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const periodName = result.periodo.inicio && result.periodo.fim
      ? `${result.periodo.inicio}-a-${result.periodo.fim}` : 'todo-periodo'
    link.href = url
    link.download = `pedidos-${safeFileName(result.consultor.nome)}-${periodName}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const totals = data?.totais || {}
  const managerGoal = totals.meta_gerente || {}

  return (
    <main className="content consultants-page">
      <button className="back-button" onClick={onBack}>← Voltar ao painel</button>
      <section className="consultants-hero">
        <div><h1>Consultores</h1></div>
        <span className="consultants-period">{data?.periodo.rotulo || 'Carregando período…'}</span>
      </section>

      <section className="filters consultants-filters">
        <label>
          <span>Período</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
            <option value="mes-atual">Mês atual</option>
            <option value="mes-anterior">Mês anterior</option>
            <option value="todo-periodo">Todo o período</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </label>
        <label>
          <span>UF da carteira</span>
          <select value={uf} onChange={(event) => setUf(event.target.value)}>
            <option value="">Todas as UFs</option>
            {(data?.ufs || []).map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        {period === 'personalizado' && (
          <>
            <label><span>Data inicial</span><input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
            <label><span>Data final</span><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
          </>
        )}
      </section>

      {error && <div className="alert alert-error consultants-alert">{error}</div>}

      <section className="consultants-summary">
        <article>
          <span>OL sem combate</span>
          <strong>{loading ? '—' : money.format(totals.ol_sem_combate || 0)}</strong>
          <small>Meta GD: {money.format(managerGoal.ol_sem_combate || 0)} · <b className={cls(ratio(totals.ol_sem_combate || 0, managerGoal.ol_sem_combate || 0))}>{pct.format(ratio(totals.ol_sem_combate || 0, managerGoal.ol_sem_combate || 0))}%</b></small>
        </article>
        <article>
          <span>OL prioritários</span>
          <strong>{loading ? '—' : money.format(totals.ol_prioritarios || 0)}</strong>
          <small>Meta: {money.format(managerGoal.ol_prioritarios || 0)} · <b className={cls(ratio(totals.ol_prioritarios || 0, managerGoal.ol_prioritarios || 0))}>{pct.format(ratio(totals.ol_prioritarios || 0, managerGoal.ol_prioritarios || 0))}%</b></small>
        </article>
        <article>
          <span>OL lançamentos</span>
          <strong>{loading ? '—' : money.format(totals.ol_lancamentos || 0)}</strong>
          <small>Meta: {money.format(managerGoal.ol_lancamentos || 0)} · <b className={cls(ratio(totals.ol_lancamentos || 0, managerGoal.ol_lancamentos || 0))}>{pct.format(ratio(totals.ol_lancamentos || 0, managerGoal.ol_lancamentos || 0))}%</b></small>
        </article>
        <article>
          <span>CNPJs com vendas</span>
          <strong>{loading ? '—' : num.format(totals.clientes_com_venda || 0)}</strong>
          <small>{num.format(totals.clientes_sem_venda || 0)} sem venda</small>
        </article>
      </section>

      <section className="consultants-ranking">
        <div className="ranking-heading">
          <div><h2>Ranking de resultados</h2><small>Clique no consultor para abrir os pedidos.</small></div>
          <span>{data?.consultores.length || 0} consultores</span>
        </div>
        <div className="consultant-card-list">
          {loading && <div className="ranking-empty">Carregando resultados…</div>}
          {!loading && (data?.consultores || []).map((consultant, index) => {
            const isExpanded = expanded === consultant.id
            const detail = details[consultant.id]
            return (
              <article className={`consultant-result-card${isExpanded ? ' is-expanded' : ''}`} key={consultant.id}>
                <button
                  type="button"
                  className="consultant-card-toggle"
                  onClick={() => void toggleConsultant(consultant.id)}
                  aria-expanded={isExpanded}
                  aria-controls={`consultant-orders-${consultant.id}`}
                >
                  <div className="consultant-identity">
                    <span className="ranking-position">{index + 1}</span>
                    <div>
                      <h3>{consultant.nome}</h3>
                      <small>Setor {consultant.setor || 'não informado'} · {num.format(consultant.clientes_com_venda)}/{num.format(consultant.clientes_ativos)} CNPJs com vendas</small>
                    </div>
                  </div>
                  <div className="consultant-metric">
                    <span>Sem combate</span>
                    <strong>{money.format(consultant.ol_sem_combate)}</strong>
                    <small>Meta {money.format(consultant.meta_ol_sem_combate)} · <b className={cls(consultant.resultado_meta_ol)}>{pct.format(consultant.resultado_meta_ol)}%</b></small>
                  </div>
                  <div className="consultant-metric">
                    <span>Prioritários</span>
                    <strong>{money.format(consultant.ol_prioritarios)}</strong>
                    <small>Meta {money.format(consultant.meta_ol_prioritarios)} · <b className={cls(ratio(consultant.ol_prioritarios, consultant.meta_ol_prioritarios))}>{pct.format(ratio(consultant.ol_prioritarios, consultant.meta_ol_prioritarios))}%</b></small>
                  </div>
                  <div className="consultant-metric">
                    <span>Lançamentos</span>
                    <strong>{money.format(consultant.ol_lancamentos)}</strong>
                    <small>Meta {money.format(consultant.meta_ol_lancamentos)} · <b className={cls(ratio(consultant.ol_lancamentos, consultant.meta_ol_lancamentos))}>{pct.format(ratio(consultant.ol_lancamentos, consultant.meta_ol_lancamentos))}%</b></small>
                  </div>
                  <div className="consultant-metric consultant-pending-metric">
                    <span>Atendido e ainda não faturado</span>
                    <strong>{num.format(consultant.pedidos_nao_faturados)} · {money.format(consultant.valor_nao_faturado)}</strong>
                    <small>pedidos/notas · clique para detalhar</small>
                  </div>
                  <span className="consultant-expand-icon" aria-hidden="true">{isExpanded ? '−' : '+'}</span>
                </button>

                {isExpanded && (
                  <div className="consultant-order-details" id={`consultant-orders-${consultant.id}`}>
                    {detailLoading[consultant.id] && <div className="consultant-orders-loading">Carregando pedidos…</div>}
                    {detailErrors[consultant.id] && <div className="alert alert-error">{detailErrors[consultant.id]}</div>}
                    {detailMessages[consultant.id] && <div className="alert alert-success">{detailMessages[consultant.id]}</div>}
                    {detail && (
                      <>
                        <div className="consultant-order-details-heading">
                          <div>
                            <h4>Pedidos de {consultant.nome}</h4>
                            <small>{detail.periodo.rotulo}{detail.periodo.uf ? ` · UF ${detail.periodo.uf}` : ''}</small>
                          </div>
                          <button type="button" className="consultant-download-button" onClick={() => void downloadDetails(consultant)}>
                            Baixar detalhes
                          </button>
                        </div>
                        <div className="consultant-order-summary">
                          <article>
                            <span>Pedidos faturados</span>
                            <strong>{num.format(detail.resumo.pedidos_faturados)}</strong>
                            <b>{money.format(detail.resumo.valor_faturado)}</b>
                          </article>
                          <article className="pending">
                            <span>Ainda não faturados</span>
                            <strong>{num.format(detail.resumo.pedidos_nao_faturados)}</strong>
                            <b>{money.format(detail.resumo.valor_nao_faturado)}</b>
                          </article>
                        </div>
                        <div className="consultant-orders-columns">
                          <OrdersGroup title="Pedidos faturados" rows={detail.faturados} />
                          <OrdersGroup
                            title="Pedidos ainda não faturados"
                            rows={detail.nao_faturados}
                            pending
                            deletingOrderId={deletingOrderId}
                            onDelete={(order) => void deletePendingOrder(consultant, order)}
                          />
                        </div>
                        <small className="consultant-order-rule">{detail.regra}</small>
                      </>
                    )}
                  </div>
                )}
              </article>
            )
          })}
          {!loading && !data?.consultores.length && <div className="ranking-empty">Nenhum consultor encontrado.</div>}
        </div>
      </section>
    </main>
  )
}
