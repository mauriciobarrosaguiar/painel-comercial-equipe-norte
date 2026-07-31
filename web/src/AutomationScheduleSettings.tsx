import { useEffect, useState } from 'react'
import './automation-schedules.css'

type Schedule = {
  tipo: string
  nome: string
  descricao: string
  ativo: boolean
  intervalo_minutos: number
  ultima_execucao_em: string | null
  proxima_execucao_em: string | null
  atualizado_por: string
  atualizado_em: string | null
}

type Payload = {
  configuracoes: Schedule[]
  verificador_minutos: number
}

const options = [5, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080]
const dateTime = (value: string | null) => {
  if (!value) return 'Ainda não executada'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('pt-BR')
}
const intervalLabel = (minutes: number) => {
  if (minutes < 60) return `${minutes} minutos`
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return days === 1 ? '1 dia' : `${days} dias`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return hours === 1 ? '1 hora' : `${hours} horas`
  }
  return `${minutes} minutos`
}

export default function AutomationScheduleSettings() {
  const [settings, setSettings] = useState<Schedule[]>([])
  const [verifierMinutes, setVerifierMinutes] = useState(5)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    try {
      const response = await fetch('/api/configuracoes-automacao', { cache: 'no-store' })
      const result: Payload & { erro?: string; detalhe?: string } = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao carregar os intervalos.')
      setSettings(result.configuracoes || [])
      setVerifierMinutes(result.verificador_minutos || 5)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const update = (tipo: string, patch: Partial<Schedule>) => {
    setSettings(current => current.map(item => item.tipo === tipo ? { ...item, ...patch } : item))
  }

  async function save(item: Schedule) {
    setSaving(item.tipo)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/configuracoes-automacao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tipo: item.tipo,
          ativo: item.ativo,
          intervalo_minutos: item.intervalo_minutos,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao salvar o intervalo.')
      update(item.tipo, result.configuracao)
      setMessage(result.mensagem || 'Intervalo atualizado.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving('')
    }
  }

  return <section className="automation-schedule-panel">
    <div className="automation-schedule-heading">
      <div>
        <span className="eyebrow">Agendamento automático</span>
        <h2>Intervalo de cada automação</h2>
        <p>O verificador consulta os agendamentos a cada {verifierMinutes} minutos e inicia as rotinas vencidas sem sobrepor uma execução em andamento.</p>
      </div>
      <button className="outline-button" type="button" onClick={() => void load()} disabled={loading}>
        {loading ? 'Atualizando…' : 'Atualizar'}
      </button>
    </div>

    {error && <div className="alert alert-error"><strong>Não foi possível atualizar:</strong> {error}</div>}
    {message && <div className="alert alert-success">{message}</div>}

    {loading && !settings.length ? <div className="operations-empty">Carregando intervalos…</div> : (
      <div className="automation-schedule-grid">
        {settings.map(item => <article className={`automation-schedule-card ${item.ativo ? 'is-active' : ''}`} key={item.tipo}>
          <div className="automation-schedule-title">
            <div>
              <h3>{item.nome}</h3>
              <p>{item.descricao}</p>
            </div>
            <label className="automation-toggle">
              <input
                type="checkbox"
                checked={item.ativo}
                onChange={event => update(item.tipo, { ativo: event.target.checked })}
              />
              <span>{item.ativo ? 'Ativa' : 'Desativada'}</span>
            </label>
          </div>

          <label className="automation-interval-field">
            <span>Executar a cada</span>
            <select
              value={item.intervalo_minutos}
              onChange={event => update(item.tipo, { intervalo_minutos: Number(event.target.value) })}
            >
              {!options.includes(item.intervalo_minutos) && (
                <option value={item.intervalo_minutos}>{intervalLabel(item.intervalo_minutos)}</option>
              )}
              {options.map(value => <option value={value} key={value}>{intervalLabel(value)}</option>)}
            </select>
          </label>

          <div className="automation-schedule-times">
            <div><span>Último disparo</span><b>{dateTime(item.ultima_execucao_em)}</b></div>
            <div><span>Próximo disparo</span><b>{item.ativo ? dateTime(item.proxima_execucao_em) : 'Automação desativada'}</b></div>
          </div>

          <button
            className="primary-action"
            type="button"
            disabled={saving === item.tipo}
            onClick={() => void save(item)}
          >
            {saving === item.tipo ? 'Salvando…' : 'Salvar intervalo'}
          </button>
        </article>)}
      </div>
    )}

    <small className="automation-schedule-note">
      Fechamento mensal e migração de bases continuam manuais para evitar reprocessamentos automáticos indevidos.
    </small>
  </section>
}
