import { FormEvent, useEffect, useState } from 'react'
import BaseManagement from './BaseManagement'
import CalculationAudit from './CalculationAudit'
import DesafioGigantesImport from './DesafioGigantesImport'
import TemplatesSection from './TemplatesSection'

type IntegrationStatus = {
  configurada: boolean
  usuario_mascarado: string
  status: string
  mensagem: string
  atualizado_em: string | null
}

type Props = { onBack: () => void }

const formatDate = (value: string | null) => {
  if (!value) return 'Ainda não registrado'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

export default function IntegrationSettings({ onBack }: Props) {
  const [userId, setUserId] = useState('')
  const [accessSecret, setAccessSecret] = useState('')
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function request(method: 'GET' | 'POST' | 'DELETE', body?: object) {
    const response = await fetch('/api/admin/bussola', {
      method,
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await response.json() as IntegrationStatus & { erro?: string; detalhe?: string }
    if (!response.ok) throw new Error(data.detalhe || data.erro || 'Não foi possível concluir a operação.')
    return data
  }

  async function load() {
    setLoading(true)
    try {
      setStatus(await request('GET'))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      setStatus(await request('POST', { usuario: userId, segredo: accessSecret }))
      setUserId('')
      setAccessSecret('')
      setMessage('Acesso da GD salvo e protegido com sucesso.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  async function remove() {
    if (!window.confirm('Remover o acesso da GD salvo?')) return
    setLoading(true)
    setError('')
    setMessage('')
    try {
      await request('DELETE')
      setStatus({
        configurada: false,
        usuario_mascarado: '',
        status: 'nao_configurada',
        mensagem: 'Credencial da GD removida.',
        atualizado_em: null,
      })
      setMessage('Acesso da GD removido.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  return <main className="content admin-content">
    <button className="back-button" onClick={onBack}>← Voltar ao painel</button>
    <section className="admin-hero">
      <span className="eyebrow">Administração</span>
      <h1>Integrações e bases do painel</h1>
      <p>O acesso do colaborador libera todas as configurações e atualizações.</p>
    </section>

    {error && <div className="alert alert-error">{error}</div>}
    {message && <div className="alert alert-success">{message}</div>}

    <section className="admin-grid">
      <article className="admin-card">
        <div className="integration-heading">
          <div className="integration-icon">B</div>
          <div>
            <h2>Bússola</h2>
            <p>Credencial da GD usada somente pela extração automatizada.</p>
          </div>
          <span className="status-pill">
            {status?.configurada ? 'GD configurada' : loading ? 'Carregando' : 'Aguardando acesso da GD'}
          </span>
        </div>

        {status && <>
          <div className="integration-status-grid">
            <div><span>Usuário da GD salvo</span><strong>{status.usuario_mascarado || 'Nenhum'}</strong></div>
            <div><span>Última alteração</span><strong>{formatDate(status.atualizado_em)}</strong></div>
            <div className="wide"><span>Situação</span><strong>{status.mensagem}</strong></div>
          </div>

          <form className="credentials-form" onSubmit={(event) => void save(event)}>
            <div className="form-heading">
              <h3>{status.configurada ? 'Substituir acesso da GD' : 'Cadastrar acesso da GD'}</h3>
              <p>O Bússola será extraído exclusivamente com este acesso. Não são usados logins dos consultores.</p>
            </div>
            <label>
              <span>Usuário do Bússola da GD</span>
              <input value={userId} onChange={(event) => setUserId(event.target.value)} required />
            </label>
            <label>
              <span>Código de acesso do Bússola da GD</span>
              <input type="password" value={accessSecret} onChange={(event) => setAccessSecret(event.target.value)} required />
            </label>
            <div className="form-actions">
              <button className="primary-action" disabled={loading}>Salvar acesso da GD</button>
              {status.configurada && <button
                className="danger-button"
                type="button"
                onClick={() => void remove()}
                disabled={loading}
              >Remover acesso da GD</button>}
            </div>
          </form>
        </>}
      </article>

      <aside className="security-card">
        <span className="security-icon">✓</span>
        <h2>Acesso confirmado</h2>
        <p>As extrações do Bússola usam somente a credencial da GD cadastrada e protegida no painel.</p>
      </aside>
    </section>

    <BaseManagement adminKey="" enabled />
    <DesafioGigantesImport />
    <TemplatesSection />
    <CalculationAudit adminKey="" enabled />
  </main>
}
