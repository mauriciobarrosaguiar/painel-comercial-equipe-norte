import { useEffect, useMemo, useState } from 'react'
import type { SipClient, SipGoalSummary } from './SipDetailView'
import './sip-summary.css'

export type SipSummaryData = {
  sip: { id: string; nome: string; meta_mes: number }
  periodo: { inicio: string; fim: string }
  clientes: SipClient[]
  resumo_sip: SipGoalSummary
  link_resumo_excel: string
  link_resumo_pdf: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
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
const summarize = (clients: SipClient[], fallbackObjective = 0): SipGoalSummary => {
  const clientObjective = clients.reduce((total, client) => total + Number(client.objetivo || 0), 0)
  const objective = clientObjective > 0 ? clientObjective : Number(fallbackObjective || 0)
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

export default function SipSummaryReport({
  data,
  onUpdated,
}: {
  data: SipSummaryData
  onUpdated?: (updated: SipSummaryData) => void
}) {
  const [clients, setClients] = useState(() => data.clientes.map((client) => withGaps(client)))
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setClients(data.clientes.map((client) => withGaps(client)))
    setEditing(false)
    setDrafts({})
    setError('')
    setMessage('')
  }, [data])

  const displayedClients = useMemo(() => clients.map((client) => withGaps(
    client,
    editing ? Number(drafts[client.cnpj] ?? client.objetivo) : client.objetivo,
  )), [clients, drafts, editing])
  const summary = useMemo(
    () => summarize(displayedClients, data.sip.meta_mes),
    [displayedClients, data.sip.meta_mes],
  )

  const beginEditing = () => {
    setDrafts(Object.fromEntries(clients.map((client) => [client.cnpj, Number(client.objetivo || 0)])))
    setError('')
    setMessage('')
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setDrafts({})
    setError('')
  }

  const saveObjectives = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const objectives = clients.map((client) => ({
        cnpj: client.cnpj,
        objetivo: Math.max(0, Number(drafts[client.cnpj] ?? client.objetivo)),
      }))
      const response = await fetch('/api/sips/objetivos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sip_id: data.sip.id, objetivos: objectives }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao salvar os objetivos.')

      const updatedClients = clients.map((client) => withGaps(
        client,
        Math.max(0, Number(drafts[client.cnpj] ?? client.objetivo)),
      ))
      const updatedSummary = summarize(updatedClients, Number(result.objetivo_total || 0))
      const updatedData: SipSummaryData = {
        ...data,
        sip: { ...data.sip, meta_mes: updatedSummary.objetivo },
        clientes: updatedClients,
        resumo_sip: updatedSummary,
      }
      setClients(updatedClients)
      setEditing(false)
      setDrafts({})
      setMessage(`Objetivos salvos. Total: ${money.format(updatedSummary.objetivo)}`)
      onUpdated?.(updatedData)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="sip-goal-report">
      <div className="sip-goal-report-heading">
        <div>
          <span>RESUMO SIP</span>
          <h2>{data.sip.nome}</h2>
          <small>{monthLabel(data.periodo.inicio)} · OBJETIVO PREÇO LÍQUIDO</small>
        </div>
        <div className="sip-goal-actions">
          {!editing && (
            <button type="button" className="outline-button" onClick={beginEditing}>Editar objetivos</button>
          )}
          {editing && (
            <>
              <button type="button" className="outline-button" onClick={cancelEditing} disabled={saving}>Cancelar</button>
              <button type="button" className="primary-action" onClick={() => void saveObjectives()} disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar objetivos'}
              </button>
            </>
          )}
          <a className="secondary-button sip-goal-download" href={data.link_resumo_excel}>Baixar Excel</a>
          <a className="secondary-button sip-goal-download" href={data.link_resumo_pdf}>Baixar PDF</a>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}
      <div className="sip-goal-table-wrap">
        <table className="sip-goal-table">
          <thead>
            <tr>
              <th>CLIENTE</th>
              <th>OBJETIVO</th>
              <th>REALIZADO</th>
              <th>COBERTURA</th>
              <th>GAP 100%</th>
              <th>GAP 90%</th>
              <th>GAP 80%</th>
            </tr>
          </thead>
          <tbody>
            {displayedClients.length ? displayedClients.map((client) => (
              <tr key={client.cnpj || client.id}>
                <td className="sip-goal-client">
                  <strong>{client.nome}</strong>
                  <small>{client.cnpj}</small>
                </td>
                <td>
                  {editing ? (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={drafts[client.cnpj] ?? client.objetivo}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [client.cnpj]: Math.max(0, Number(event.target.value || 0)),
                      }))}
                      aria-label={`Objetivo de ${client.nome}`}
                    />
                  ) : money.format(client.objetivo)}
                </td>
                <td>{money.format(client.ol_sem_combate)}</td>
                <td className={coverageClass(client.cobertura)}>{pct.format(client.cobertura)}%</td>
                <td className={client.gap_100 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(client.gap_100)}</td>
                <td className={client.gap_90 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(client.gap_90)}</td>
                <td className={client.gap_80 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(client.gap_80)}</td>
              </tr>
            )) : (
              <tr>
                <td className="sip-goal-empty" colSpan={7}>Nenhum cliente vinculado a esta SIP.</td>
              </tr>
            )}
            <tr className="sip-goal-total">
              <td>TOTAL DISTRITAL</td>
              <td>{money.format(summary.objetivo)}</td>
              <td>{money.format(summary.realizado)}</td>
              <td className={coverageClass(summary.cobertura)}>{pct.format(summary.cobertura)}%</td>
              <td className={summary.gap_100 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(summary.gap_100)}</td>
              <td className={summary.gap_90 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(summary.gap_90)}</td>
              <td className={summary.gap_80 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(summary.gap_80)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <small className="sip-goal-help">GAP negativo indica quanto falta para atingir a faixa. GAP positivo indica valor acima da faixa.</small>
    </section>
  )
}
