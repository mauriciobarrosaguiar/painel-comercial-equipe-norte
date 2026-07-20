import { FormEvent, useState } from 'react'
import BaseManagement from './BaseManagement'
import CalculationAudit from './CalculationAudit'

type IntegrationStatus = {
  configurada: boolean
  usuario_mascarado: string
  status: string
  mensagem: string
  atualizado_em: string | null
}

type Props = { onBack: () => void }

function formatDate(value: string | null) {
  if (!value) return 'Ainda não registrado'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

export default function IntegrationSettings({ onBack }: Props) {
  const [adminKey, setAdminKey] = useState('')
  const [userId, setUserId] = useState('')
  const [accessSecret, setAccessSecret] = useState('')
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function request(method: 'GET' | 'POST' | 'DELETE', body?: object) {
    if (adminKey.trim().length < 12) throw new Error('Informe a chave administrativa com pelo menos 12 caracteres.')
    const response = await fetch('/api/admin/bussola', {
      method,
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await response.json() as IntegrationStatus & { erro?: string }
    if (!response.ok) throw new Error(data.erro || 'Não foi possível concluir a operação.')
    return data
  }

  async function unlock() {
    setLoading(true)
    setError('')
    setMessage('')
    try {
      setStatus(await request('GET'))
      setMessage('Área administrativa liberada enquanto esta página permanecer aberta.')
    } catch (reason) {
      setStatus(null)
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      setStatus(await request('POST', { usuario: userId, segredo: accessSecret }))
      setUserId('')
      setAccessSecret('')
      setMessage('Acesso salvo e protegido com sucesso.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  async function remove() {
    if (!window.confirm('Remover o acesso salvo?')) return
    setLoading(true)
    setError('')
    try {
      await request('DELETE')
      setStatus({ configurada: false, usuario_mascarado: '', status: 'nao_configurada', mensagem: 'Acesso removido.', atualizado_em: null })
      setMessage('Acesso removido.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="content admin-content">
      <button className="back-button" type="button" onClick={onBack}>← Voltar ao painel</button>
      <section className="admin-hero">
        <span className="eyebrow">Administração</span>
        <h1>Integrações e bases do painel</h1>
        <p>Gerencie o acesso do Bússola e as planilhas oficiais usadas nos cálculos comerciais.</p>
      </section>

      <section className="admin-grid">
        <article className="admin-card">
          <div className="integration-heading">
            <div className="integration-icon">B</div>
            <div><h2>Bússola</h2><p>Extração automatizada de pedidos e faturamentos.</p></div>
            <span className="status-pill">{status?.configurada ? 'Configurada' : 'Aguardando acesso'}</span>
          </div>
          <div className="admin-unlock">
            <label><span>Chave administrativa</span><input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} /></label>
            <button className="outline-button" type="button" onClick={() => void unlock()} disabled={loading}>{loading ? 'Verificando…' : 'Acessar configurações'}</button>
            <small>A mesma chave libera as credenciais e a importação das planilhas. Ela não é gravada no navegador.</small>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className="alert alert-success">{message}</div>}
          {status && (
            <>
              <div className="integration-status-grid">
                <div><span>Usuário salvo</span><strong>{status.usuario_mascarado || 'Nenhum'}</strong></div>
                <div><span>Última alteração</span><strong>{formatDate(status.atualizado_em)}</strong></div>
                <div className="wide"><span>Situação</span><strong>{status.mensagem}</strong></div>
              </div>
              <form className="credentials-form" onSubmit={(event) => void save(event)}>
                <div className="form-heading"><h3>{status.configurada ? 'Substituir acesso' : 'Cadastrar acesso'}</h3><p>Preencha os dois campos sempre que o acesso for alterado.</p></div>
                <label><span>Usuário do Bússola</span><input type="text" value={userId} onChange={(event) => setUserId(event.target.value)} required /></label>
                <label><span>Código de acesso do Bússola</span><input type="password" value={accessSecret} onChange={(event) => setAccessSecret(event.target.value)} required /></label>
                <div className="form-actions">
                  <button className="primary-action" type="submit" disabled={loading}>Salvar acesso</button>
                  {status.configurada && <button className="danger-button" type="button" onClick={() => void remove()} disabled={loading}>Remover acesso</button>}
                </div>
              </form>
            </>
          )}
        </article>

        <aside className="security-card">
          <span className="security-icon">✓</span><h2>Regras corrigidas</h2>
          <p>Cada informação agora tem uma única fonte oficial.</p>
          <ul>
            <li>Bússola: pedidos, datas, EANs e valor faturado.</li>
            <li>Painel Equipe Norte: cliente, consultor, GD e UF.</li>
            <li>Metas Comerciais: objetivos por consultor e GD.</li>
            <li>Produtos: classificação do mix e lista do Mercado Farma.</li>
          </ul>
        </aside>
      </section>

      <BaseManagement adminKey={adminKey} enabled={Boolean(status)} />
      <CalculationAudit adminKey={adminKey} enabled={Boolean(status)} />
    </main>
  )
}
