import { useEffect, useMemo, useState } from 'react'
import './focus-history-actions.css'

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
  fechado_em?: string
  historico?: boolean
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

function HistoryMission({
  snapshot,
  product,
  deleting,
  onDelete,
}: {
  snapshot: HistorySnapshot
  product: HistoryProduct
  deleting: boolean
  onDelete: () => void
}) {
  const lines = useMemo(
    () => snapshot.linhas.filter(line => line.foco_id === product.foco_id),
    [snapshot.linhas, product.foco_id],
  )
  const consultants = useMemo(() => {
    const map = new Map<string, HistoryConsultant>()
    for (const line of lines) if (!map.has(line.consultor_id)) map.set(line.consultor_id, line)
    return [...map.values()].sort((a, b) => (a.setor || '').localeCompare(b.setor || '') || a.consultor.localeCompare(b.consultor, 'pt-BR'))
  }, [lines])
  const lineMap = useMemo(
    () => new Map(lines.map(line => [line.consultor_id, line])),
    [lines],
  )
  const total = useMemo(() => lines.reduce((result, line) => ({
    meta: result.meta + Number(line.meta_quantidade || 0),
    realizado: result.realizado + Number(line.realizado_quantidade || 0),
  }), { meta: 0, realizado: 0 }), [lines])
  const params = new URLSearchParams({ inicio: snapshot.periodo.inicio, fim: snapshot.periodo.fim }).toString()
  const totalCoverage = total.meta > 0 ? total.realizado / total.meta * 100 : 0

  return <article className="focus-history-card focus-history-single-card">
    <header className="focus-history-single-header">
      <div>
        <span>{dateLabel(snapshot.periodo.inicio)} a {dateLabel(snapshot.periodo.fim)}</span>
        <h3>{product.descricao}</h3>
        <small>EAN {product.ean || 'não informado'}{product.observacoes ? ` · ${product.observacoes}` : ''}</small>
      </div>
      <b className={snapshot.historico ? 'focus-history-status closed' : 'focus-history-status active'}>
        {snapshot.historico ? 'Encerrado' : 'Em acompanhamento'}
      </b>
    </header>

    <div className="focus-history-actions">
      <span>{snapshot.historico && snapshot.fechado_em ? `Resultado fechado em ${new Date(snapshot.fechado_em).toLocaleString('pt-BR')}` : 'Resultado atualizado automaticamente com o Bússola'}</span>
      <div>
        <a className="secondary-button" href={`/api/foco-planilha?${params}`}>Baixar planilha</a>
        <button className="focus-history-delete" type="button" disabled={deleting} onClick={onDelete}>
          {deleting ? 'Excluindo…' : 'Excluir foco'}
        </button>
      </div>
    </div>

    <div className="focus-mission-table-wrap">
      <table className="focus-mission-table focus-history-one-product" style={{ minWidth: '720px' }}>
        <thead>
          <tr>
            <th rowSpan={2} className="focus-fixed-head focus-head-blue">SETOR</th>
            <th rowSpan={2} className="focus-consultant-head focus-head-blue">CONSULTOR</th>
            <th colSpan={3} className="focus-product-head focus-group-0"><div><span>{product.descricao}</span><small>EAN {product.ean}</small></div></th>
          </tr>
          <tr>
            <th className="focus-subhead focus-group-0">META DO PRODUTO</th>
            <th className="focus-subhead focus-group-0">QTDE FATURADA</th>
            <th className="focus-subhead focus-group-0">% ATINGIMENTO</th>
          </tr>
        </thead>
        <tbody>
          {consultants.map(consultant => {
            const line = lineMap.get(consultant.consultor_id)
            const meta = Number(line?.meta_quantidade || 0)
            const realizado = Number(line?.realizado_quantidade || 0)
            const coverage = meta > 0 ? realizado / meta * 100 : 0
            return <tr key={consultant.consultor_id}>
              <td className="focus-sector-cell">{consultant.setor || '—'}</td>
              <td className="focus-consultant-cell"><strong>{consultant.consultor}</strong></td>
              <td className="focus-number-cell">{num.format(meta)}</td>
              <td className="focus-number-cell focus-realized-cell">{num.format(realizado)}</td>
              <td className={`focus-number-cell focus-coverage-cell ${coverageClass(coverage)}`}>{pct.format(coverage)}%</td>
            </tr>
          })}
          {!consultants.length && <tr><td colSpan={5} className="focus-empty-row">Nenhum consultor com meta neste foco.</td></tr>}
        </tbody>
        <tfoot><tr>
          <td colSpan={2}>TOTAL</td>
          <td>{num.format(total.meta)}</td>
          <td>{num.format(total.realizado)}</td>
          <td className={coverageClass(totalCoverage)}>{pct.format(totalCoverage)}%</td>
        </tr></tfoot>
      </table>
    </div>
  </article>
}

export default function FocusHistory() {
  const [historicos, setHistoricos] = useState<HistorySnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState('')

  async function load() {
    setLoading(true)
    try {
      const response = await fetch('/api/foco-historico', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro)
      setHistoricos(result.historicos || [])
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const missions = useMemo(() => historicos.flatMap(snapshot =>
    (snapshot.produtos || []).map(product => ({ snapshot, product })),
  ), [historicos])

  async function remove(snapshot: HistorySnapshot, product: HistoryProduct) {
    if (!confirm(`Excluir o foco ${product.descricao}? Ele será removido da missão atual e também do histórico.`)) return
    setDeleting(product.foco_id)
    setError('')
    try {
      const response = await fetch('/api/foco-historico', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ foco_id: product.foco_id, historico_id: snapshot.id }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDeleting('')
    }
  }

  return <section className="operations-list focus-history-section focus-all-section">
    <div className="operations-heading focus-section-heading">
      <div>
        <h2>Todos os focos semanais</h2>
        <small>As missões aparecem automaticamente, sem precisar selecionar o mês em que foram cadastradas.</small>
      </div>
      <span>{missions.length} foco{missions.length === 1 ? '' : 's'}</span>
    </div>

    {loading && <div className="focus-history-empty">Carregando todos os focos…</div>}
    {error && <div className="alert alert-error focus-history-error">{error}</div>}
    {!loading && !error && !missions.length && <div className="focus-history-empty">Nenhum foco semanal cadastrado.</div>}

    <div className="focus-history-list focus-history-all-list">
      {missions.map(({ snapshot, product }) => <HistoryMission
        key={`${snapshot.id}:${product.foco_id}`}
        snapshot={snapshot}
        product={product}
        deleting={deleting === product.foco_id}
        onDelete={() => void remove(snapshot, product)}
      />)}
    </div>
  </section>
}
