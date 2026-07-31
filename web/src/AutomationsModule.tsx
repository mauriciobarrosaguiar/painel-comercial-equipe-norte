import { useEffect, useMemo, useState } from 'react'
import AutomationScheduleSettings from './AutomationScheduleSettings'
import './operations.css'

type Command = {
  id: string
  tipo: string
  status: string
  mensagem: string
  erro: string
  solicitado_em: string
  iniciado_em: string | null
  finalizado_em: string | null
}

type Extraction = {
  id: string
  tipo: string
  status: string
  total_registros: number
  mensagem: string
  erro: string
  iniciado_em: string | null
  finalizado_em: string | null
  criado_em: string | null
}

type Data = {
  comandos: Command[]
  extracoes: Extraction[]
  em_execucao: number
  atualizado_em: string
  disparo_imediato_configurado?: boolean
  aviso?: string
}

const activeStatuses = new Set(['aguardando', 'encaminhando', 'executando'])
const dateTime = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, item => item.toUpperCase())
const statusLabel = (value: string) => value === 'aguardando'
  ? 'Na fila'
  : value === 'encaminhando'
    ? 'Encaminhando'
    : value === 'executando'
      ? 'Executando'
      : value === 'concluido'
        ? 'Concluído'
        : value === 'erro'
          ? 'Erro'
          : value === 'cancelado'
            ? 'Cancelado'
            : value

function Detail({ item }: { item: { mensagem: string; erro: string } }) {
  const text = item.erro || item.mensagem || 'Sem detalhes registrados.'
  return <details className={`operation-details ${item.erro ? 'has-error' : ''}`}>
    <summary>{item.erro ? 'Abrir erro completo' : 'Ver detalhes'}</summary>
    <pre>{text}</pre>
  </details>
}

export default function AutomationsModule({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<Data>({ comandos: [], extracoes: [], em_execucao: 0, atualizado_em: '' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string[]>([])
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))

  async function load() {
    try {
      const response = await fetch('/api/automacoes', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao atualizar automações')
      setData(result)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(timer)
  }, [])

  const activeTypes = useMemo(
    () => new Set(data.comandos.filter(item => activeStatuses.has(item.status)).map(item => item.tipo)),
    [data.comandos],
  )

  async function run(tipo: string, parametros: Record<string, unknown> = {}) {
    setBusy(current => [...new Set([...current, tipo])])
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/automacoes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tipo, parametros }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao solicitar automação')
      if (result.imediato === false && result.detalhe) {
        setError(`${result.mensagem || 'O disparo imediato falhou.'} ${result.detalhe}`)
      } else {
        setMessage(result.mensagem || 'Solicitação registrada.')
      }
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(current => current.filter(item => item !== tipo))
    }
  }

  const actions = [
    ['BUSSOLA', 'Extrair Bússola', 'Execução manual; o agendamento automático continua ativo.'],
    ['MERCADO_FARMA', 'Extrair Mercado Farma', 'Atualiza preços e estoques das UFs cadastradas.'],
    ['AUDITORIA', 'Auditar cálculos', 'Confere vínculos, EANs, datas, status e conciliação.'],
    ['MIGRAR_BASES', 'Migrar bases legadas', 'Recupera dados preservados do painel anterior.'],
  ]

  const buttonText = (type: string, normal: string) => busy.includes(type)
    ? 'Enviando…'
    : activeTypes.has(type)
      ? 'Em andamento'
      : normal

  return <main className="content operations-page">
    <button className="back-button" onClick={onBack}>← Voltar ao painel</button>
    <section className="operations-hero">
      <div>
        <span className="eyebrow">Processos</span>
        <h1>Central de Automações</h1>
        <p>Execute os processos usando o acesso já confirmado no painel.</p>
      </div>
      <span>{data.em_execucao} em execução</span>
    </section>
    <div className="automation-session-note">
      {data.disparo_imediato_configurado === false
        ? 'A fila de contingência está ativa. O disparo imediato do GitHub ainda precisa ser configurado.'
        : 'Token configurado. O acesso ao repositório será validado quando o processo for enviado.'}
    </div>
    {error && <div className="alert alert-error"><strong>Não foi possível concluir:</strong> {error}</div>}
    {message && <div className="alert alert-success">{message}</div>}
    {data.aviso && <div className="alert alert-error">{data.aviso}</div>}

    <AutomationScheduleSettings />

    <section className="automation-actions">
      {actions.map(([type, title, description]) => <article key={type}>
        <div><h2>{title}</h2><p>{description}</p></div>
        <button
          className="primary-action"
          disabled={busy.includes(type) || activeTypes.has(type)}
          onClick={() => void run(type)}
        >
          {buttonText(type, 'Executar agora')}
        </button>
      </article>)}
      <article>
        <div>
          <h2>Fechamento mensal</h2>
          <p>Grava uma fotografia permanente do mês.</p>
          <input type="month" value={month} onChange={event => setMonth(event.target.value)} />
        </div>
        <button
          className="primary-action"
          disabled={busy.includes('FECHAMENTO_MENSAL') || activeTypes.has('FECHAMENTO_MENSAL')}
          onClick={() => void run('FECHAMENTO_MENSAL', { ano_mes: month })}
        >
          {buttonText('FECHAMENTO_MENSAL', 'Fechar mês')}
        </button>
      </article>
    </section>

    <section className="operations-list">
      <div className="operations-heading">
        <div><h2>Solicitações recentes</h2><small>Atualizado em {dateTime(data.atualizado_em)}</small></div>
        <button className="outline-button" onClick={() => void load()}>Atualizar</button>
      </div>
      {!data.comandos.length && <div className="operations-empty">Nenhuma solicitação registrada.</div>}
      {data.comandos.map(item => <div className="operation-row operation-row-expanded" key={item.id}>
        <div>
          <strong>{label(item.tipo)}</strong>
          <span>{item.erro || item.mensagem || 'Sem mensagem'}</span>
          <Detail item={item} />
        </div>
        <div>
          <b className={`operation-status status-${item.status}`}>{statusLabel(item.status)}</b>
          <small>{dateTime(item.finalizado_em || item.iniciado_em || item.solicitado_em)}</small>
        </div>
      </div>)}
    </section>

    <section className="operations-list">
      <div className="operations-heading"><h2>Últimas extrações</h2></div>
      {!data.extracoes.length && <div className="operations-empty">Nenhuma extração registrada.</div>}
      {data.extracoes.map(item => <div className="operation-row operation-row-expanded" key={item.id}>
        <div>
          <strong>{label(item.tipo)}</strong>
          <span>{item.erro || item.mensagem || `${item.total_registros || 0} registros`}</span>
          <Detail item={item} />
        </div>
        <div>
          <b className={`operation-status status-${item.status}`}>{statusLabel(item.status)}</b>
          <small>{dateTime(item.finalizado_em || item.iniciado_em || item.criado_em)}</small>
        </div>
      </div>)}
    </section>
  </main>
}
