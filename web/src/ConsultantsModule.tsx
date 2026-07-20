import { useEffect, useMemo, useState } from 'react'
import './consultants.css'

type PeriodOption = 'mes-atual' | 'mes-anterior' | 'todo-periodo' | 'personalizado'

type ConsultantRow = {
  id: string
  nome: string
  uf: string
  clientes_ativos: number
  clientes_com_venda: number
  clientes_sem_venda: number
  ol_total_faturado: number
  ol_sem_combate: number
  ol_combate: number
  ol_prioritarios: number
  ol_lancamentos: number
  meta_ol_sem_combate: number
  meta_ol_prioritarios: number
  meta_ol_lancamentos: number
  meta_clientes: number
  resultado_meta_ol: number
  participacao_prioritarios: number
  participacao_lancamentos: number
}

type ConsultantsData = {
  periodo: {
    tipo: string
    inicio: string | null
    fim: string | null
    rotulo: string
    ano_mes_meta: string
  }
  uf: string
  ufs: string[]
  consultores: ConsultantRow[]
  totais: {
    ol_total_faturado: number
    ol_sem_combate: number
    ol_combate: number
    ol_prioritarios: number
    ol_lancamentos: number
    clientes_ativos: number
    clientes_com_venda: number
    clientes_sem_venda: number
    meta_gerente: {
      ol_sem_combate: number
      ol_prioritarios: number
      ol_lancamentos: number
      clientes_positivados: number
    }
    resultado_meta_gerente: number
    participacao_prioritarios: number
    participacao_lancamentos: number
  }
  atualizado_em: string
}

type Props = { onBack: () => void }

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const number = new Intl.NumberFormat('pt-BR')
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function localDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthBounds(offset: number) {
  const now = new Date()
  return {
    inicio: localDate(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
    fim: localDate(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)),
  }
}

const currentMonth = monthBounds(0)

function resultClass(value: number) {
  if (value >= 100) return 'result-good'
  if (value >= 80) return 'result-warning'
  return 'result-low'
}

export default function ConsultantsModule({ onBack }: Props) {
  const [period, setPeriod] = useState<PeriodOption>('mes-atual')
  const [uf, setUf] = useState('')
  const [customStart, setCustomStart] = useState(currentMonth.inicio)
  const [customEnd, setCustomEnd] = useState(currentMonth.fim)
  const [data, setData] = useState<ConsultantsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const selectedPeriod = useMemo(() => {
    if (period === 'mes-atual') return monthBounds(0)
    if (period === 'mes-anterior') return monthBounds(-1)
    if (period === 'personalizado') return { inicio: customStart, fim: customEnd }
    return { inicio: '', fim: '' }
  }, [period, customStart, customEnd])

  useEffect(() => {
    if (period === 'personalizado' && (!customStart || !customEnd)) return
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ periodo: period })
        if (selectedPeriod.inicio && selectedPeriod.fim) {
          params.set('inicio', selectedPeriod.inicio)
          params.set('fim', selectedPeriod.fim)
        }
        if (uf) params.set('uf', uf)

        const response = await fetch(`/api/consultores?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const result = await response.json() as ConsultantsData & { erro?: string; detalhe?: string }
        if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível carregar os consultores.')
        setData(result)
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [period, uf, customStart, customEnd, selectedPeriod.inicio, selectedPeriod.fim])

  const totals = data?.totais

  return (
    <main className="content consultants-page">
      <button className="back-button" type="button" onClick={onBack}>← Voltar ao painel</button>

      <section className="consultants-hero">
        <div>
          <span className="eyebrow">Desempenho comercial</span>
          <h1>Consultores</h1>
          <p>Ranking, metas, cobertura da carteira e participação do mix com dados reais do D1.</p>
        </div>
        <span className="consultants-period">{data?.periodo.rotulo || 'Carregando período…'}</span>
      </section>

      <section className="filters consultants-filters" aria-label="Filtros dos consultores">
        <label>
          <span>Período</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value as PeriodOption)}>
            <option value="mes-atual">Mês atual</option>
            <option value="mes-anterior">Mês anterior</option>
            <option value="todo-periodo">Todo o período extraído</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </label>
        <label>
          <span>UF da carteira</span>
          <select value={uf} onChange={(event) => setUf(event.target.value)}>
            <option value="">Todas as UFs</option>
            {(data?.ufs || []).map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        {period === 'personalizado' && (
          <>
            <label><span>Data inicial</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
            <label><span>Data final</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
          </>
        )}
      </section>

      {error && <div className="alert alert-error consultants-alert">{error}</div>}

      <section className="consultants-summary" aria-label="Resumo da equipe">
        <article><span>OL sem combate</span><strong>{loading ? '—' : currency.format(totals?.ol_sem_combate || 0)}</strong><small>Total: {currency.format(totals?.ol_total_faturado || 0)} · Meta GD: {currency.format(totals?.meta_gerente.ol_sem_combate || 0)}</small></article>
        <article><span>Resultado da meta</span><strong className={resultClass(totals?.resultado_meta_gerente || 0)}>{loading ? '—' : `${percent.format(totals?.resultado_meta_gerente || 0)}%`}</strong><small>Realizado ÷ meta da gerência</small></article>
        <article><span>Clientes com venda</span><strong>{loading ? '—' : number.format(totals?.clientes_com_venda || 0)}</strong><small>{number.format(totals?.clientes_sem_venda || 0)} clientes sem venda</small></article>
        <article><span>Mix prioritário</span><strong>{loading ? '—' : `${percent.format(totals?.participacao_prioritarios || 0)}%`}</strong><small>Lançamentos: {percent.format(totals?.participacao_lancamentos || 0)}%</small></article>
      </section>

      <section className="consultants-ranking">
        <div className="ranking-heading">
          <div><span className="eyebrow">Equipe Norte</span><h2>Ranking de resultados</h2></div>
          <span>{data?.consultores.length || 0} consultores</span>
        </div>

        <div className="ranking-table-wrap">
          <table className="ranking-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Consultor</th>
                <th>OL sem combate</th>
                <th>Meta</th>
                <th>Resultado</th>
                <th>Prioritários</th>
                <th>Lançamentos</th>
                <th>Clientes</th>
              </tr>
            </thead>
            <tbody>
              {!loading && data?.consultores.map((item, index) => (
                <tr key={item.id}>
                  <td><span className="ranking-position">{index + 1}</span></td>
                  <td><strong>{item.nome}</strong><small>{item.uf || 'Carteira multirregional'}</small></td>
                  <td>{currency.format(item.ol_sem_combate)}</td>
                  <td>{currency.format(item.meta_ol_sem_combate)}</td>
                  <td><span className={`result-pill ${resultClass(item.resultado_meta_ol)}`}>{percent.format(item.resultado_meta_ol)}%</span></td>
                  <td><strong>{currency.format(item.ol_prioritarios)}</strong><small>{percent.format(item.participacao_prioritarios)}% do OL</small></td>
                  <td><strong>{currency.format(item.ol_lancamentos)}</strong><small>{percent.format(item.participacao_lancamentos)}% do OL</small></td>
                  <td><strong>{number.format(item.clientes_com_venda)}</strong><small>{number.format(item.clientes_sem_venda)} sem venda</small></td>
                </tr>
              ))}
              {loading && <tr><td colSpan={8} className="ranking-empty">Carregando resultados…</td></tr>}
              {!loading && !error && data?.consultores.length === 0 && <tr><td colSpan={8} className="ranking-empty">Nenhum consultor encontrado para os filtros selecionados.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
