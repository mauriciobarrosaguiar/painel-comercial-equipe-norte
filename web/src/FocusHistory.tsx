import { Fragment, useEffect, useMemo, useState } from 'react'

type HistoryLine = {
  foco_id: string
  produto_id: string
  ean: string
  descricao: string
  consultor_id: string
  consultor: string
  setor: string
  meta_quantidade: number
  realizado_quantidade: number
}

type HistoryProduct = {
  foco_id: string
  produto_id: string
  ean: string
  descricao: string
  observacoes?: string
}

type HistoryConsultant = {
  consultor_id: string
  consultor: string
  setor: string
}

type HistorySnapshot = {
  id: string
  periodo: { inicio: string; fim: string }
  produtos: HistoryProduct[]
  consultores: HistoryConsultant[]
  linhas: HistoryLine[]
  fechado_em: string
}

const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })

const dateLabel = (value: string) => {
  const [year, month, day] = String(value || '').split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

function coverageClass(value: number) {
  if (value >= 100) return 'coverage-complete'
  if (value > 0) return 'coverage-progress'
  return 'coverage-zero'
}

function HistoryMission({ snapshot }: { snapshot: HistorySnapshot }) {
  const lineMap = useMemo(
    () => new Map(snapshot.linhas.map(line => [`${line.consultor_id}|${line.foco_id}`, line])),
    [snapshot.linhas],
  )
  const totals = useMemo(() => {
    const result = new Map<string, { meta: number; realizado: number }>()
    for (const line of snapshot.linhas) {
      const current = result.get(line.foco_id) || { meta: 0, realizado: 0 }
      current.meta += Number(line.meta_quantidade || 0)
      current.realizado += Number(line.realizado_quantidade || 0)
      result.set(line.foco_id, current)
    }
    return result
  }, [snapshot.linhas])
  const width = Math.max(720, 330 + snapshot.produtos.length * 300)
  const params = new URLSearchParams({ inicio: snapshot.periodo.inicio, fim: snapshot.periodo.fim }).toString()

  return <div className="focus-history-content">
    <div className="focus-history-actions">
      <span>Resultado fechado em {new Date(snapshot.fechado_em).toLocaleString('pt-BR')}</span>
      <a className="secondary-button" href={`/api/foco-planilha?${params}`}>Baixar planilha</a>
    </div>
    <div className="focus-mission-table-wrap">
      <table className="focus-mission-table" style={{ minWidth: `${width}px` }}>
        <thead>
          <tr>
            <th rowSpan={2} className="focus-fixed-head focus-head-blue">SETOR</th>
            <th rowSpan={2} className="focus-consultant-head focus-head-blue">CONSULTOR</th>
            {snapshot.produtos.map((product, index) => <th key={product.foco_id} colSpan={3} className={`focus-product-head focus-group-${index % 2}`}>
              <div><span>{product.descricao}</span><small>EAN {product.ean}</small></div>
            </th>)}
          </tr>
          <tr>
            {snapshot.produtos.map((product, index) => <Fragment key={product.foco_id}>
              <th className={`focus-subhead focus-group-${index % 2}`}>META DO PRODUTO</th>
              <th className={`focus-subhead focus-group-${index % 2}`}>QTDE FATURADA</th>
              <th className={`focus-subhead focus-group-${index % 2}`}>% ATINGIMENTO</th>
            </Fragment>)}
          </tr>
        </thead>
        <tbody>
          {snapshot.consultores.map(consultant => <tr key={consultant.consultor_id}>
            <td className="focus-sector-cell">{consultant.setor || '—'}</td>
            <td className="focus-consultant-cell"><strong>{consultant.consultor}</strong></td>
            {snapshot.produtos.map(product => {
              const line = lineMap.get(`${consultant.consultor_id}|${product.foco_id}`)
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
        </tbody>
        <tfoot><tr>
          <td colSpan={2}>TOTAL</td>
          {snapshot.produtos.map(product => {
            const total = totals.get(product.foco_id) || { meta: 0, realizado: 0 }
            const coverage = total.meta > 0 ? total.realizado / total.meta * 100 : 0
            return <Fragment key={product.foco_id}>
              <td>{num.format(total.meta)}</td>
              <td>{num.format(total.realizado)}</td>
              <td className={coverageClass(coverage)}>{pct.format(coverage)}%</td>
            </Fragment>
          })}
        </tr></tfoot>
      </table>
    </div>
  </div>
}

export default function FocusHistory() {
  const [historicos, setHistoricos] = useState<HistorySnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const response = await fetch('/api/foco-historico', { cache: 'no-store' })
        const result = await response.json()
        if (!response.ok) throw new Error(result.detalhe || result.erro)
        if (active) setHistoricos(result.historicos || [])
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  return <section className="operations-list focus-history-section">
    <div className="operations-heading focus-section-heading">
      <div>
        <h2>Histórico das missões</h2>
        <small>Ao terminar o período, meta, quantidade faturada e atingimento ficam salvos para consulta.</small>
      </div>
      <span>{historicos.length} períodos fechados</span>
    </div>

    {loading && <div className="focus-history-empty">Carregando histórico…</div>}
    {error && <div className="alert alert-error focus-history-error">{error}</div>}
    {!loading && !error && !historicos.length && <div className="focus-history-empty">Nenhuma missão encerrada ainda.</div>}

    <div className="focus-history-list">
      {historicos.map((snapshot, index) => <details className="focus-history-card" key={snapshot.id} open={index === 0}>
        <summary>
          <div>
            <strong>{dateLabel(snapshot.periodo.inicio)} a {dateLabel(snapshot.periodo.fim)}</strong>
            <span>{snapshot.produtos.map(product => product.descricao).join(' & ')}</span>
          </div>
          <b>{snapshot.produtos.length} produto{snapshot.produtos.length === 1 ? '' : 's'}</b>
        </summary>
        <HistoryMission snapshot={snapshot} />
      </details>)}
    </div>
  </section>
}
