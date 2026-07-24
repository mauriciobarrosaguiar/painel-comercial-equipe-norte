import { useEffect, useMemo, useState } from 'react'
import './sip-summary.css'

export type SipSummaryRow = {
  id: string
  nome: string
  cnpjs: number
  objetivo: number
  realizado: number
  cobertura: number
  gap_80: number
  gap_90: number
  gap_100: number
}

export type SipSummaryData = {
  periodo: { inicio: string; fim: string }
  linhas: SipSummaryRow[]
  total: {
    cnpjs: number
    objetivo: number
    realizado: number
    cobertura: number
    gap_80: number
    gap_90: number
    gap_100: number
  }
  link_resumo_excel: string
  link_resumo_pdf: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })

const monthLabel = (value: string) => {
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const [year, month] = value.split('-').map(Number)
  return year && month ? `${months[month - 1]}/${String(year).slice(-2)}` : value
}

const calculateRow = (row: SipSummaryRow, objective = Number(row.objetivo || 0)): SipSummaryRow => {
  const realized = Number(row.realizado || 0)
  return {
    ...row,
    objetivo: objective,
    cobertura: objective > 0 ? realized / objective * 100 : 0,
    gap_80: realized - objective * 0.8,
    gap_90: realized - objective * 0.9,
    gap_100: realized - objective,
  }
}

const calculateTotal = (rows: SipSummaryRow[]) => {
  const cnpjs = rows.reduce((total, row) => total + Number(row.cnpjs || 0), 0)
  const objective = rows.reduce((total, row) => total + Number(row.objetivo || 0), 0)
  const realized = rows.reduce((total, row) => total + Number(row.realizado || 0), 0)
  return {
    cnpjs,
    objetivo: objective,
    realizado: realized,
    cobertura: objective > 0 ? realized / objective * 100 : 0,
    gap_80: realized - objective * 0.8,
    gap_90: realized - objective * 0.9,
    gap_100: realized - objective,
  }
}

const coverageClass = (value: number) => value >= 90
  ? 'sip-coverage-high'
  : value >= 80 ? 'sip-coverage-mid' : 'sip-coverage-low'

export default function SipSummaryReport({
  data,
  onUpdated,
}: {
  data: SipSummaryData
  onUpdated?: (updated: SipSummaryData) => void
}) {
  const [rows, setRows] = useState(() => data.linhas.map((row) => calculateRow(row)))
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setRows(data.linhas.map((row) => calculateRow(row)))
    setEditing(false)
    setDrafts({})
    setError('')
    setMessage('')
  }, [data])

  const displayedRows = useMemo(() => rows.map((row) => calculateRow(
    row,
    editing ? Number(drafts[row.id] ?? row.objetivo) : row.objetivo,
  )), [rows, drafts, editing])

  const total = useMemo(() => calculateTotal(displayedRows), [displayedRows])
  const excelQuery = new URLSearchParams()
  if (data.periodo.inicio) excelQuery.set('inicio', data.periodo.inicio)
  if (data.periodo.fim) excelQuery.set('fim', data.periodo.fim)
  const excelLink = `/api/sips/resumo-geral-xlsx${excelQuery.size ? `?${excelQuery.toString()}` : ''}`

  const beginEditing = () => {
    setDrafts(Object.fromEntries(rows.map((row) => [row.id, Number(row.objetivo || 0)])))
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
      const metas = rows.map((row) => ({
        sip_id: row.id,
        objetivo: Math.max(0, Number(drafts[row.id] ?? row.objetivo)),
      }))
      const response = await fetch('/api/sips/objetivos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metas_sip: metas }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao salvar os objetivos.')

      const updatedRows = rows.map((row) => calculateRow(
        row,
        Math.max(0, Number(drafts[row.id] ?? row.objetivo)),
      ))
      const updated: SipSummaryData = {
        ...data,
        linhas: updatedRows,
        total: calculateTotal(updatedRows),
      }
      setRows(updatedRows)
      setEditing(false)
      setDrafts({})
      setMessage(`${num.format(Number(result.metas_atualizadas || updatedRows.length))} objetivos atualizados.`)
      onUpdated?.(updated)
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
          <h2>{monthLabel(data.periodo.inicio)}</h2>
          <small>OBJETIVO PREÇO LÍQUIDO · RESULTADO CONSOLIDADO POR SIP</small>
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
          <a className="secondary-button sip-goal-download" href={excelLink}>Baixar Excel</a>
          <a className="secondary-button sip-goal-download" href={data.link_resumo_pdf}>Baixar PDF</a>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      <div className="sip-goal-table-wrap">
        <table className="sip-goal-table sip-consolidated-table">
          <thead>
            <tr>
              <th>SIP</th>
              <th>CNPJs</th>
              <th>OBJETIVO</th>
              <th>REALIZADO</th>
              <th>COBERTURA</th>
              <th>GAP 100%</th>
              <th>GAP 90%</th>
              <th>GAP 80%</th>
            </tr>
          </thead>
          <tbody>
            {displayedRows.length ? displayedRows.map((row) => (
              <tr key={row.id}>
                <td className="sip-goal-client">
                  <strong>{row.nome}</strong>
                  <small>{num.format(row.cnpjs)} CNPJs vinculados</small>
                </td>
                <td className="sip-goal-count">{num.format(row.cnpjs)}</td>
                <td>
                  {editing ? (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={drafts[row.id] ?? row.objetivo}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [row.id]: Math.max(0, Number(event.target.value || 0)),
                      }))}
                      aria-label={`Objetivo da SIP ${row.nome}`}
                    />
                  ) : money.format(row.objetivo)}
                </td>
                <td>{money.format(row.realizado)}</td>
                <td className={coverageClass(row.cobertura)}>{pct.format(row.cobertura)}%</td>
                <td className={row.gap_100 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(row.gap_100)}</td>
                <td className={row.gap_90 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(row.gap_90)}</td>
                <td className={row.gap_80 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(row.gap_80)}</td>
              </tr>
            )) : (
              <tr>
                <td className="sip-goal-empty" colSpan={8}>Nenhuma SIP cadastrada para exibir.</td>
              </tr>
            )}
            <tr className="sip-goal-total">
              <td>TOTAL DISTRITAL</td>
              <td>{num.format(total.cnpjs)}</td>
              <td>{money.format(total.objetivo)}</td>
              <td>{money.format(total.realizado)}</td>
              <td className={coverageClass(total.cobertura)}>{pct.format(total.cobertura)}%</td>
              <td className={total.gap_100 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(total.gap_100)}</td>
              <td className={total.gap_90 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(total.gap_90)}</td>
              <td className={total.gap_80 < 0 ? 'sip-gap-negative' : 'sip-gap-positive'}>{money.format(total.gap_80)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <small className="sip-goal-help">
        Cada linha soma todos os CNPJs vinculados à SIP. O realizado utiliza OL Sem Combate no período selecionado.
      </small>
    </section>
  )
}
