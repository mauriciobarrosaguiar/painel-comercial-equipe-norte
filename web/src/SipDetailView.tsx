import { useEffect, useMemo, useState } from 'react'
import './sip-pending.css'
import './sip-summary.css'

export type SipProduct = {
  ean: string
  produto: string
  tipo_mix: string
  quantidade: number
  faturamento: number
  pedidos: number
}

export type SipClient = {
  id: string
  cnpj: string
  nome: string
  cidade: string
  uf: string
  consultor: string
  objetivo: number
  cobertura: number
  gap_80: number
  gap_90: number
  gap_100: number
  ol_total: number
  ol_sem_combate: number
  prioritarios: number
  lancamentos: number
  ultima_compra: string | null
  notas_faturadas: number
  notas_canceladas: number
  notas_a_faturar: number
  valor_a_faturar: number
}

export type SipPendingConsultant = {
  id: string
  nome: string
  setor: string
  pedidos_nao_faturados: number
  valor_nao_faturado: number
}

export type SipGoalSummary = {
  objetivo: number
  realizado: number
  cobertura: number
  gap_80: number
  gap_90: number
  gap_100: number
}

export type SipDetail = {
  sip: { id?: string; nome: string; meta_mes: number }
  periodo: { inicio: string; fim: string }
  totais: {
    clientes_ativos: number
    clientes_com_venda: number
    clientes_sem_venda: number
    pedidos: number
    ol_total: number
    ol_sem_combate: number
    prioritarios: number
    resultado_meta: number
    projecao_ol_sem_combate?: number
    projecao_meta?: number
    notas_faturadas: number
    notas_canceladas: number
    notas_a_faturar: number
    valor_a_faturar: number
  }
  resumo_sip: SipGoalSummary
  clientes: SipClient[]
  produtos: SipProduct[]
  pendentes_por_consultor: SipPendingConsultant[]
  link_exportacao: string
  link_resumo_excel: string
  link_resumo_pdf: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
const date = (value: string | null) => value
  ? value.slice(0, 10).split('-').reverse().join('/')
  : 'Sem compra'
const monthLabel = (value: string) => {
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const [year, month] = value.split('-').map(Number)
  return year && month ? `${months[month - 1]}/${String(year).slice(-2)}` : value
}
const coverageClass = (value: number) => value >= 90
  ? 'sip-coverage-high'
  : value >= 80 ? 'sip-coverage-mid' : 'sip-coverage-low'
const withGaps = (client: SipClient, objective = Number(client.objetivo || 0)): SipClient => {
  const realized = Number(client.ol_sem_combate || 0)
  return {
    ...client,
    objetivo: objective,
    cobertura: objective > 0 ? realized / objective * 100 : 0,
    gap_80: realized - objective * 0.8,
    gap_90: realized - objective * 0.9,
    gap_100: realized - objective,
  }
}
const summarize = (clients: SipClient[]): SipGoalSummary => {
  const objective = clients.reduce((total, client) => total + Number(client.objetivo || 0), 0)
  const realized = clients.reduce((total, client) => total + Number(client.ol_sem_combate || 0), 0)
  return {
    objetivo: objective,
    realizado: realized,
    cobertura: objective > 0 ? realized / objective * 100 : 0,
    gap_80: realized - objective * 0.8,
    gap_90: realized - objective * 0.9,
    gap_100: realized - objective,
  }
}

export default function SipDetailView({
  detail,
  publicView = false,
}: {
  detail: SipDetail
  publicView?: boolean
}) {
  const totals = detail.totais
  const projection = totals.projecao_ol_sem_combate ?? totals.ol_sem_combate
  const projectionPercent = totals.projecao_meta ?? totals.resultado_meta
  const pendingConsultants = detail.pendentes_por_consultor || []
  const [clients, setClients] = useState(() => detail.clientes.map((client) => withGaps(client)))
  const [editingObjectives, setEditingObjectives] = useState(false)
  const [draftObjectives, setDraftObjectives] = useState<Record<string, number>>({})
  const [savingObjectives, setSavingObjectives] = useState(false)
  const [objectiveError, setObjectiveError] = useState('')
  const [objectiveMessage, setObjectiveMessage] = useState('')

  useEffect(() => {
    setClients(detail.clientes.map((client) => withGaps(client)))
    setEditingObjectives(false)
    setDraftObjectives({})
    setObjectiveError('')
    setObjectiveMessage('')
  }, [detail])

  const displayedClients = useMemo(() => clients.map((client) => withGaps(
    client,
    editingObjectives ? Number(draftObjectives[client.cnpj] ?? client.objetivo) : client.objetivo,
  )), [clients, draftObjectives, editingObjectives])
  const goalSummary = useMemo(() => summarize(displayedClients), [displayedClients])
  const displayedProjectionPercent = goalSummary.objetivo > 0
    ? projection / goalSummary.objetivo * 100
    : projectionPercent

  const beginObjectiveEditing = () => {
    setDraftObjectives(Object.fromEntries(clients.map((client) => [client.cnpj, Number(client.objetivo || 0)])))
    setObjectiveError('')
    setObjectiveMessage('')
    setEditingObjectives(true)
  }

  const cancelObjectiveEditing = () => {
    setEditingObjectives(false)
    setDraftObjectives({})
    setObjectiveError('')
  }

  const saveObjectives = async () => {
    const sipId = detail.sip.id
    if (!sipId) {
      setObjectiveError('Identificação da SIP não encontrada.')
      return
    }
    setSavingObjectives(true)
    setObjectiveError('')
    setObjectiveMessage('')
    try {
      const response = await fetch('/api/sips/objetivos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sip_id: sipId,
          objetivos: clients.map((client) => ({
            cnpj: client.cnpj,
            objetivo: Math.max(0, Number(draftObjectives[client.cnpj] ?? client.objetivo)),
          })),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao salvar os objetivos.')
      setClients((current) => current.map((client) => withGaps(
        client,
        Math.max(0, Number(draftObjectives[client.cnpj] ?? client.objetivo)),
      )))
      setEditingObjectives(false)
      setDraftObjectives({})
      setObjectiveMessage(`Objetivos salvos. Total: ${money.format(Number(result.objetivo_total || 0))}`)
    } catch (reason) {
      setObjectiveError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSavingObjectives(false)
    }
  }

  return (
    <div className="sip-detail-content">
      <section className="sips-summary sip-detail-summary">
        <article>
          <span>CNPJs com vendas</span>
          <strong>{num.format(totals.clientes_com_venda)}</strong>
          <small>
            {num.format(totals.clientes_ativos)} vinculados · {num.format(totals.clientes_sem_venda)} sem vendas
          </small>
        </article>
        <article className="sip-primary-result">
          <span>OL Sem Combate</span>
          <strong>{money.format(totals.ol_sem_combate)}</strong>
          <small>
            <b>{pct.format(goalSummary.cobertura)}% atingido</b> · Meta {money.format(goalSummary.objetivo)}
          </small>
          <small>Projeção {money.format(projection)} · {pct.format(displayedProjectionPercent)}%</small>
        </article>
        <article>
          <span>Notas faturadas</span>
          <strong>{num.format(totals.notas_faturadas)}</strong>
          <small>OL Total {money.format(totals.ol_total)} · {num.format(totals.pedidos)} pedidos</small>
        </article>
        <article>
          <span>Notas canceladas</span>
          <strong>{num.format(totals.notas_canceladas)}</strong>
        </article>
        <article className="sip-pending-summary">
          <span>Pedidos ainda não faturados</span>
          <strong>{num.format(totals.notas_a_faturar)}</strong>
          <small>{money.format(totals.valor_a_faturar || 0)}</small>
        </article>
      </section>

      <section className="sip-goal-report">
        <div className="sip-goal-report-heading">
          <div>
            <span>RESUMO SIP</span>
            <h2>{monthLabel(detail.periodo.inicio)}</h2>
            <small>OBJETIVO PREÇO LÍQUIDO</small>
          </div>
          <div className="sip-goal-actions">
            {!publicView && !editingObjectives && (
              <button type="button" className="outline-button" onClick={beginObjectiveEditing}>Editar objetivos</button>
            )}
            {editingObjectives && (
              <>
                <button type="button" className="outline-button" onClick={cancelObjectiveEditing} disabled={savingObjectives}>Cancelar</button>
                <button type="button" className="primary-action" onClick={() => void saveObjectives()} disabled={savingObjectives}>
                  {savingObjectives ? 'Salvando…' : 'Salvar objetivos'}
                </button>
              </>
            )}
            <a className="secondary-button sip-goal-download" href={detail.link_resumo_excel}>Baixar Excel</a>
            <a className="secondary-button sip-goal-download" href={detail.link_resumo_pdf}>Baixar PDF</a>
          </div>
        </div>
        {objectiveError && <div className="alert alert-error">{objectiveError}</div>}
        {objectiveMessage && <div className="alert alert-success">{objectiveMessage}</div>}
        <div className="sip-goal-table-wrap">
          <table className="sip-goal-table">
            <thead>
              <tr>
                <th>CLIENTE</th>
                <th>OBJETIVO</th>
                <th>REALIZADO</th>
                <th>COBERTURA</th>
                <th>GAP 80%</th>
                <th>GAP 90%</th>
                <th>GAP 100%</th>
              </tr>
            </thead>
            <tbody>
              {displayedClients.map((client) => (
                <tr key={client.cnpj || client.id}>
                  <td className="sip-goal-client">
                    <strong>{client.nome}</strong>
                    {!publicView && <small>{client.cnpj}</small>}
                  </td>
                  <td>
                    {editingObjectives ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draftObjectives[client.cnpj] ?? client.objetivo}
                        onChange={(event: { target: { value: string } }) => setDraftObjectives((current) => ({
                          ...current,
                          [client.cnpj]: Math.max(0, Number(event.target.value || 0)),
                        }))}
                        aria-label={`Objetivo de ${client.nome}`}
                      />
                    ) : money.format(client.objetivo)}
                  </td>
                  <td>{money.format(client.ol_sem_combate)}</td>
                  <td className={coverageClass(client.cobertura)}>{pct.format(client.cobertura)}%</td>
                  <td className={client.gap_80 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(client.gap_80)}</td>
                  <td className={client.gap_90 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(client.gap_90)}</td>
                  <td className={client.gap_100 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(client.gap_100)}</td>
                </tr>
              ))}
              <tr className="sip-goal-total">
                <td>TOTAL DISTRITAL</td>
                <td>{money.format(goalSummary.objetivo)}</td>
                <td>{money.format(goalSummary.realizado)}</td>
                <td>{pct.format(goalSummary.cobertura)}%</td>
                <td className={goalSummary.gap_80 < 0 ? 'sip-gap-negative' : ''}>{money.format(goalSummary.gap_80)}</td>
                <td className={goalSummary.gap_90 < 0 ? 'sip-gap-negative' : ''}>{money.format(goalSummary.gap_90)}</td>
                <td className={goalSummary.gap_100 < 0 ? 'sip-gap-negative' : ''}>{money.format(goalSummary.gap_100)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <small className="sip-goal-help">GAP negativo indica quanto falta para atingir a faixa. GAP positivo indica valor acima da faixa.</small>
      </section>

      <section className="sip-pending-list">
        <div className="sips-heading">
          <div>
            <h2>Não faturados por consultor</h2>
            <small>Atendidos, atendidos parcialmente ou enviados no período</small>
          </div>
          <strong>{money.format(totals.valor_a_faturar || 0)}</strong>
        </div>
        {pendingConsultants.length ? pendingConsultants.map((item) => (
          <article key={item.id}>
            <div>
              <strong>{item.nome}</strong>
              <small>{item.setor ? `Setor ${item.setor}` : 'Setor não informado'}</small>
            </div>
            <div>
              <span>Pedidos/notas</span>
              <b>{num.format(item.pedidos_nao_faturados)}</b>
            </div>
            <div>
              <span>Valor sem imposto</span>
              <b>{money.format(item.valor_nao_faturado)}</b>
            </div>
          </article>
        )) : (
          <p className="sips-empty">Nenhum pedido ainda não faturado neste período.</p>
        )}
      </section>

      <section className="sip-client-list">
        <h2>Resultado por cliente</h2>
        {displayedClients.map((client) => (
          <article key={client.id}>
            <div>
              <strong>{client.nome}</strong>
              <small>
                {publicView ? '' : `${client.cnpj} · `}
                {client.cidade}/{client.uf} · {client.consultor || 'Sem consultor'}
              </small>
            </div>
            <div>
              <span>OL Sem Combate</span>
              <b>{money.format(client.ol_sem_combate || 0)}</b>
              <small>OL Total {money.format(client.ol_total)}</small>
            </div>
            <div>
              <span>Notas</span>
              <b>{num.format(client.notas_faturadas)} faturadas</b>
              <small>
                {num.format(client.notas_canceladas)} canceladas · {num.format(client.notas_a_faturar)} a faturar
              </small>
              {client.notas_a_faturar > 0 && (
                <small>{money.format(client.valor_a_faturar || 0)} ainda não faturado</small>
              )}
            </div>
            <div>
              <span>Prioritários</span>
              <b>{money.format(client.prioritarios)}</b>
            </div>
            <div>
              <span>Lançamentos</span>
              <b>{money.format(client.lancamentos)}</b>
            </div>
            <div>
              <span>Última compra</span>
              <b>{date(client.ultima_compra)}</b>
            </div>
          </article>
        ))}
      </section>

      <section className="sip-product-list">
        <div className="sips-heading">
          <h2>Resultado por produto</h2>
          <span>{detail.produtos.length} produtos</span>
        </div>
        {detail.produtos.map((item) => (
          <article key={`${item.ean}-${item.produto}`}>
            <div>
              <strong>{item.produto}</strong>
              <small>{item.ean} · {item.tipo_mix}</small>
            </div>
            <div>
              <span>Quantidade</span>
              <b>{num.format(item.quantidade)}</b>
            </div>
            <div>
              <span>Pedidos</span>
              <b>{num.format(item.pedidos)}</b>
            </div>
            <div>
              <span>Faturamento</span>
              <b>{money.format(item.faturamento)}</b>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
