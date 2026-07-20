import { useEffect, useMemo, useState } from 'react'
import './calculation-audit.css'

type PeriodOption = 'todo-periodo' | 'mes-atual' | 'mes-anterior' | 'personalizado'
type AuditResult = {
  id?: string
  periodo: { inicio: string | null; fim: string | null }
  status: 'ok' | 'atencao' | 'critico'
  total_alertas: number
  executado_em: string
  volume: { pedidos_faturados: number; itens_faturados: number; valor_total: number; primeira_data: string | null; ultima_data: string | null }
  conciliacao: { ol_total: number; ol_sem_combate: number; ol_combate: number; ol_prioritarios: number; ol_lancamentos: number; ol_sem_classificacao: number; diferenca: number }
  vinculos: { pedidos_sem_cnpj_vinculado: number; pedidos_fora_carteira: number; pedidos_sem_consultor: number; itens_sem_ean: number; itens_sem_produto: number; itens_sem_classificacao: number }
  qualidade: { clientes_sem_cnpj: number; clientes_sem_consultor: number; clientes_sem_uf: number; datas_invalidas: number; datas_futuras: number; duplicatas_pedidos: number; duplicatas_itens: number; pedidos_valor_divergente: number; itens_valor_negativo: number; valor_negativo: number; status_faturado_excluido: number; valor_status_excluido: number }
}

type AuditHistory = { id: string; criado_em: string; resultado: AuditResult }
type Props = { adminKey: string; enabled: boolean }

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const number = new Intl.NumberFormat('pt-BR')

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

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

function statusLabel(status: AuditResult['status']) {
  if (status === 'ok') return 'Sem divergências'
  if (status === 'critico') return 'Divergências críticas'
  return 'Requer atenção'
}

export default function CalculationAudit({ adminKey, enabled }: Props) {
  const [period, setPeriod] = useState<PeriodOption>('todo-periodo')
  const [customStart, setCustomStart] = useState(monthBounds(0).inicio)
  const [customEnd, setCustomEnd] = useState(monthBounds(0).fim)
  const [result, setResult] = useState<AuditResult | null>(null)
  const [history, setHistory] = useState<AuditHistory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selectedPeriod = useMemo(() => {
    if (period === 'mes-atual') return monthBounds(0)
    if (period === 'mes-anterior') return monthBounds(-1)
    if (period === 'personalizado') return { inicio: customStart, fim: customEnd }
    return { inicio: '', fim: '' }
  }, [period, customStart, customEnd])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    async function loadHistory() {
      try {
        const response = await fetch('/api/admin/auditoria', {
          cache: 'no-store',
          headers: { 'x-admin-key': adminKey },
          signal: controller.signal,
        })
        const data = await response.json() as { auditorias?: AuditHistory[]; erro?: string }
        if (!response.ok) throw new Error(data.erro || 'Não foi possível consultar as auditorias.')
        const audits = data.auditorias || []
        setHistory(audits)
        if (audits[0]?.resultado) setResult(audits[0].resultado)
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    void loadHistory()
    return () => controller.abort()
  }, [enabled, adminKey])

  async function runAudit() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (selectedPeriod.inicio && selectedPeriod.fim) {
        params.set('inicio', selectedPeriod.inicio)
        params.set('fim', selectedPeriod.fim)
      }
      const response = await fetch(`/api/admin/auditoria?${params.toString()}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'x-admin-key': adminKey },
      })
      const data = await response.json() as AuditResult & { erro?: string; detalhe?: string }
      if (!response.ok) throw new Error(data.detalhe || data.erro || 'Não foi possível executar a auditoria.')
      setResult(data)
      setHistory((current) => [{ id: data.id || data.executado_em, criado_em: data.executado_em, resultado: data }, ...current].slice(0, 10))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  if (!enabled) return null

  const metrics = result ? [
    ['Pedidos fora da carteira', result.vinculos.pedidos_fora_carteira],
    ['Pedidos sem CNPJ vinculado', result.vinculos.pedidos_sem_cnpj_vinculado],
    ['Pedidos sem consultor', result.vinculos.pedidos_sem_consultor],
    ['Itens sem EAN', result.vinculos.itens_sem_ean],
    ['Itens sem produto', result.vinculos.itens_sem_produto],
    ['Itens sem classificação', result.vinculos.itens_sem_classificacao],
    ['Datas futuras', result.qualidade.datas_futuras],
    ['Datas inválidas', result.qualidade.datas_invalidas],
    ['Pedidos duplicados', result.qualidade.duplicatas_pedidos],
    ['Itens potencialmente duplicados', result.qualidade.duplicatas_itens],
    ['Valor do pedido divergente dos itens', result.qualidade.pedidos_valor_divergente],
    ['Clientes oficiais sem UF', result.qualidade.clientes_sem_uf],
  ] as Array<[string, number]> : []

  return (
    <section className="audit-section">
      <div className="audit-heading">
        <div><span className="eyebrow">Auditoria dos cálculos</span><h2>Conciliação e qualidade dos vínculos</h2><p>Valida faturamento, classificações, CNPJ, EAN, datas, duplicidades e aderência à carteira oficial.</p></div>
        {result && <span className={`audit-status ${result.status}`}>{statusLabel(result.status)}</span>}
      </div>

      <div className="audit-controls">
        <label><span>Período auditado</span><select value={period} onChange={(event) => setPeriod(event.target.value as PeriodOption)}><option value="todo-periodo">Todo o período extraído</option><option value="mes-atual">Mês atual</option><option value="mes-anterior">Mês anterior</option><option value="personalizado">Personalizado</option></select></label>
        {period === 'personalizado' && <><label><span>Data inicial</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label><span>Data final</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></>}
        <button className="primary-action" type="button" disabled={loading} onClick={() => void runAudit()}>{loading ? 'Auditando…' : 'Executar auditoria'}</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {result && <>
        <div className="audit-reconciliation">
          <article><span>OL total faturado</span><strong>{currency.format(result.conciliacao.ol_total)}</strong><small>{number.format(result.volume.pedidos_faturados)} pedidos · {number.format(result.volume.itens_faturados)} itens</small></article>
          <article><span>OL sem combate</span><strong>{currency.format(result.conciliacao.ol_sem_combate)}</strong><small>Prioritários: {currency.format(result.conciliacao.ol_prioritarios)}</small></article>
          <article><span>OL combate</span><strong>{currency.format(result.conciliacao.ol_combate)}</strong><small>Sem classificação: {currency.format(result.conciliacao.ol_sem_classificacao)}</small></article>
          <article><span>Diferença da conciliação</span><strong>{currency.format(result.conciliacao.diferenca)}</strong><small>Total − sem combate − combate − não classificado</small></article>
        </div>

        <div className="audit-metrics">
          {metrics.map(([label, value]) => <article className={value > 0 ? 'has-alert' : ''} key={label}><span>{label}</span><strong>{number.format(value)}</strong></article>)}
        </div>

        <div className="audit-footnote">
          <span>{number.format(result.total_alertas)} sinais de atenção</span>
          <span>Dados de {result.volume.primeira_data || '—'} a {result.volume.ultima_data || '—'}</span>
          <span>Executada em {formatDate(result.executado_em)}</span>
        </div>
      </>}

      {history.length > 0 && <details className="audit-history"><summary>Histórico das auditorias ({history.length})</summary>{history.map((item) => <div key={item.id}><span>{formatDate(item.criado_em)}</span><strong className={item.resultado.status}>{statusLabel(item.resultado.status)}</strong><span>{number.format(item.resultado.total_alertas)} sinais</span></div>)}</details>}
    </section>
  )
}
