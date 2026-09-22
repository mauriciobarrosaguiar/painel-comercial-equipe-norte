import { FormEvent, useEffect, useState } from 'react'

type IntegrationStatus = {
  configurada: boolean
  usuario_mascarado: string
  status: string
  mensagem: string
  atualizado_em: string | null
}

const formatDate = (value: string | null) => {
  if (!value) return 'Ainda não registrado'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

export default function MarketFarmaCredentials() {
  const [userId, setUserId] = useState('')
  const [accessSecret, setAccessSecret] = useState('')
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function request(method: 'GET' | 'POST' | 'DELETE', body?: object) {
    const response = await fetch('/api/admin/mercado-farma-credencial', {
      method, cache: 'no-store', headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await response.json() as IntegrationStatus & { erro?: string; detalhe?: string }
    if (!response.ok) throw new Error(data.detalhe || data.erro || 'Não foi possível concluir a operação.')
    return data
  }

  async function load() {
    setLoading(true)
    try { setStatus(await request('GET')); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setLoading(true); setError(''); setMessage('')
    try {
      setStatus(await request('POST', { usuario: userId, segredo: accessSecret }))
      setUserId(''); setAccessSecret('')
      setMessage('Seu acesso pessoal do Mercado Farma foi salvo e será usado nas automações.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setLoading(false) }
  }

  async function remove() {
    if (!window.confirm('Remover seu acesso pessoal do Mercado Farma?')) return
    setLoading(true); setError(''); setMessage('')
    try {
      await request('DELETE')
      setStatus({ configurada:false, usuario_mascarado:'', status:'nao_configurada', mensagem:'Acesso pessoal removido.', atualizado_em:null })
      setMessage('Acesso pessoal do Mercado Farma removido.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setLoading(false) }
  }

  return <section className="admin-grid">
    <article className="admin-card">
      <div className="integration-heading">
        <div className="integration-icon">MF</div>
        <div><h2>Mercado Farma</h2><p>Seu acesso pessoal será usado nas consultas automatizadas.</p></div>
        <span className="status-pill">{status?.configurada ? 'Acesso pessoal configurado' : loading ? 'Carregando' : 'Aguardando seu acesso'}</span>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}
      {status && <>
        <div className="integration-status-grid">
          <div><span>Seu usuário salvo</span><strong>{status.usuario_mascarado || 'Nenhum'}</strong></div>
          <div><span>Última alteração</span><strong>{formatDate(status.atualizado_em)}</strong></div>
          <div className="wide"><span>Situação</span><strong>{status.mensagem}</strong></div>
        </div>
        <form className="credentials-form" onSubmit={(event) => void save(event)}>
          <div className="form-heading">
            <h3>{status.configurada ? 'Substituir meu acesso' : 'Cadastrar meu acesso'}</h3>
            <p>A automação usará somente esta credencial pessoal e somente clientes da sua carteira.</p>
          </div>
          <label><span>Meu usuário do Mercado Farma</span><input value={userId} onChange={(event) => setUserId(event.target.value)} required /></label>
          <label><span>Minha senha/código de acesso</span><input type="password" value={accessSecret} onChange={(event) => setAccessSecret(event.target.value)} required /></label>
          <div className="form-actions">
            <button className="primary-action" disabled={loading}>Salvar meu acesso</button>
            {status.configurada && <button className="danger-button" type="button" onClick={() => void remove()} disabled={loading}>Remover meu acesso</button>}
          </div>
        </form>
      </>}
    </article>
    <aside className="security-card">
      <span className="security-icon">✓</span>
      <h2>Modo pessoal</h2>
      <p>O Mercado Farma será executado com seu usuário e apenas com CNPJs da sua carteira.</p>
    </aside>
  </section>
}
