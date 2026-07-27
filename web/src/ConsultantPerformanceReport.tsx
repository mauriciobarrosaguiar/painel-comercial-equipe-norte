import './consultant-performance.css'

type ReportRow = {
  id: string
  nome: string
  setor: string
  ol_total_faturado: number
  ol_sem_combate: number
  ol_prioritarios: number
  ol_lancamentos: number
  meta_ol_sem_combate: number
  meta_ol_prioritarios: number
  meta_ol_lancamentos: number
  valor_nao_faturado: number
  valor_nao_faturado_sem_combate: number
  valor_nao_faturado_prioritarios: number
  valor_nao_faturado_lancamentos: number
  valor_nao_faturado_combate: number
}

type Props = {
  rows: ReportRow[]
  totals: Record<string, any>
  periodLabel: string
  xlsxUrl: string
  pdfUrl: string
  loading?: boolean
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const ratio = (value: number, goal: number) => goal > 0 ? value / goal * 100 : 0
const delta = (value: number, goal: number) => Number(value || 0) - Number(goal || 0)
const statusClass = (value: number) => value >= 100
  ? 'consultant-report-good'
  : value >= 80 ? 'consultant-report-warning' : 'consultant-report-low'
const statusIcon = (value: number) => value >= 100 ? '✓' : value >= 80 ? '!' : '×'

function DeltaCell({ value }: { value: number }) {
  return <td className={value >= 0 ? 'consultant-report-positive' : 'consultant-report-negative'}>{money.format(value)}</td>
}

function PercentCell({ value }: { value: number }) {
  return (
    <td>
      <span className={`consultant-report-percent ${statusClass(value)}`}>
        <b>{statusIcon(value)}</b>{pct.format(value)}%
      </span>
    </td>
  )
}

export default function ConsultantPerformanceReport({ rows, totals, periodLabel, xlsxUrl, pdfUrl, loading }: Props) {
  const managerGoal = totals.meta_gerente || {}
  const compatibleXlsxUrl = xlsxUrl.replace('/resumo-xlsx', '/resumo-excel')
  const totalRow: ReportRow = {
    id: 'total-equipe',
    nome: 'TOTAL EQUIPE NORTE',
    setor: '',
    ol_total_faturado: Number(totals.ol_total_faturado || 0),
    ol_sem_combate: Number(totals.ol_sem_combate || 0),
    ol_prioritarios: Number(totals.ol_prioritarios || 0),
    ol_lancamentos: Number(totals.ol_lancamentos || 0),
    meta_ol_sem_combate: Number(managerGoal.ol_sem_combate || 0),
    meta_ol_prioritarios: Number(managerGoal.ol_prioritarios || 0),
    meta_ol_lancamentos: Number(managerGoal.ol_lancamentos || 0),
    valor_nao_faturado: Number(totals.valor_nao_faturado || 0),
    valor_nao_faturado_sem_combate: Number(totals.valor_nao_faturado_sem_combate || 0),
    valor_nao_faturado_prioritarios: Number(totals.valor_nao_faturado_prioritarios || 0),
    valor_nao_faturado_lancamentos: Number(totals.valor_nao_faturado_lancamentos || 0),
    valor_nao_faturado_combate: Number(totals.valor_nao_faturado_combate || 0),
  }

  const renderRow = (row: ReportRow, total = false) => {
    const sc = ratio(row.ol_sem_combate, row.meta_ol_sem_combate)
    const prioritarios = ratio(row.ol_prioritarios, row.meta_ol_prioritarios)
    const lancamentos = ratio(row.ol_lancamentos, row.meta_ol_lancamentos)
    return (
      <tr className={total ? 'consultant-report-total' : ''} key={row.id}>
        <td className="consultant-report-name">
          <strong>{row.nome}</strong>
          {!total && <small>Setor {row.setor || 'não informado'}</small>}
        </td>
        <td className="consultant-report-setor">{row.setor || '—'}</td>
        <td>{money.format(row.ol_total_faturado)}</td>

        <td>{money.format(row.meta_ol_sem_combate)}</td>
        <td>{money.format(row.ol_sem_combate)}</td>
        <DeltaCell value={delta(row.ol_sem_combate, row.meta_ol_sem_combate)} />
        <PercentCell value={sc} />

        <td>{money.format(row.meta_ol_prioritarios)}</td>
        <td>{money.format(row.ol_prioritarios)}</td>
        <DeltaCell value={delta(row.ol_prioritarios, row.meta_ol_prioritarios)} />
        <PercentCell value={prioritarios} />

        <td>{money.format(row.meta_ol_lancamentos)}</td>
        <td>{money.format(row.ol_lancamentos)}</td>
        <DeltaCell value={delta(row.ol_lancamentos, row.meta_ol_lancamentos)} />
        <PercentCell value={lancamentos} />

        <td>{money.format(row.valor_nao_faturado)}</td>
        <td>{money.format(row.valor_nao_faturado_sem_combate)}</td>
        <td>{money.format(row.valor_nao_faturado_prioritarios)}</td>
        <td>{money.format(row.valor_nao_faturado_lancamentos)}</td>
        <td>{money.format(row.valor_nao_faturado_combate)}</td>
      </tr>
    )
  }

  return (
    <section className="consultant-report">
      <div className="consultant-report-heading">
        <div>
          <span className="eyebrow">Visão comparativa</span>
          <h2>Desempenho completo dos consultores</h2>
          <p>Metas, realizado, diferença, atingimento e pedidos atendidos ainda não faturados.</p>
        </div>
        <div className="consultant-report-actions">
          <span>{periodLabel}</span>
          <a href={compatibleXlsxUrl}>Baixar Excel</a>
          <a href={pdfUrl}>Baixar PDF</a>
        </div>
      </div>

      <div className="consultant-report-scroll">
        <table className="consultant-report-table">
          <thead>
            <tr className="consultant-report-groups">
              <th rowSpan={2}>CONSULTOR</th>
              <th rowSpan={2}>SETOR</th>
              <th rowSpan={2}>REAL OL TOTAL</th>
              <th colSpan={4} className="group-sc">OL SEM COMBATE</th>
              <th colSpan={4} className="group-priority">PRIORITÁRIOS</th>
              <th colSpan={4} className="group-launch">LANÇAMENTOS</th>
              <th colSpan={5} className="group-pending">ATENDIDOS E AINDA NÃO FATURADOS</th>
            </tr>
            <tr className="consultant-report-columns">
              <th className="group-sc">META</th><th className="group-sc">REAL</th><th className="group-sc">Δ META</th><th className="group-sc">%</th>
              <th className="group-priority">META</th><th className="group-priority">REAL</th><th className="group-priority">Δ META</th><th className="group-priority">%</th>
              <th className="group-launch">META</th><th className="group-launch">REAL</th><th className="group-launch">Δ META</th><th className="group-launch">%</th>
              <th className="group-pending">TOTAL</th><th className="group-pending">SEM COMBATE</th><th className="group-pending">PRIORITÁRIOS</th><th className="group-pending">LANÇAMENTOS</th><th className="group-pending">COMBATE</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td className="consultant-report-empty" colSpan={20}>Carregando visão comparativa…</td></tr>
            )}
            {!loading && rows.map((row) => renderRow(row))}
            {!loading && !rows.length && (
              <tr><td className="consultant-report-empty" colSpan={20}>Nenhum consultor encontrado neste período.</td></tr>
            )}
            {!loading && renderRow(totalRow, true)}
          </tbody>
        </table>
      </div>
      <small className="consultant-report-note">
        Prioritários e lançamentos fazem parte do OL Sem Combate. A base atual não possui o realizado de Demanda Sem Combate; por isso o último bloco apresenta os atendidos ainda não faturados, sem criar valores estimados.
      </small>
    </section>
  )
}
