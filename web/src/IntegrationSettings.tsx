import { FormEvent, useEffect, useState } from 'react'
import BaseManagement from './BaseManagement'
import CalculationAudit from './CalculationAudit'
import TemplatesSection from './TemplatesSection'

type ContingencyStatus = {
  disponivel: boolean
  configurada: boolean
  usuario_mascarado: string
  consultor_id: string
  nome: string
  atualizado_em: string | null
}

type CoverageStatus = {
  esperados: number
  configurados: number
  faltantes: string[]
  pronta: boolean
}

type IntegrationStatus = {
  configurada: boolean
  usuario_mascarado: string
  status: string
  mensagem: string
  atualizado_em: string | null
  contingencia: ContingencyStatus
  cobertura_contingencia: CoverageStatus
  mensagem_operacao?: string
}

type Props = { onBack: () => void }

const formatDate = (value: string | null | undefined) => {
  if (!value) return 'Ainda não registrado'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

const emptyContingency: ContingencyStatus = {
  disponivel: false,
  configurada: false,
  usuario_mascarado: '',
  consultor_id: '',
  nome: '',
  atualizado_em: null,
}

const emptyCoverage: CoverageStatus = {
  esperados: 0,
  configurados: 0,
  faltantes: [],
  pronta: false,
}

export default function IntegrationSettings({ onBack }: Props) {
  const [gdUser, setGdUser] = useState('')
  const [gdSecret, setGdSecret] = useState('')
  const [consultantUser, setConsultantUser] = useState('')
  const [consultantSecret, setConsultantSecret] = useState('')
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function request(method: 'GET' | 'POST' | 'DELETE', body?: object, query = '') {
    const response = await fetch(`/api/admin/bussola${query}`, {
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

  async function saveGd(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const result = await request('POST', { escopo: 'gd', usuario: gdUser, segredo: gdSecret })
      setStatus(result)
      setGdUser('')
      setGdSecret('')
      setMessage(result.mensagem_operacao || 'Acesso principal da GD salvo com segurança.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  async function saveConsultant(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const result = await request('POST', {
        escopo: 'consultor',
        usuario: consultantUser,
        segredo: consultantSecret,
      })
      setStatus(result)
      setConsultantUser('')
      setConsultantSecret('')
      setMessage(result.mensagem_operacao || 'Seu acesso de contingência foi salvo com segurança.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  async function remove(scope: 'gd' | 'consultor') {
    const label = scope === 'gd' ? 'o acesso principal da GD' : 'seu acesso de contingência'
    if (!window.confirm(`Remover ${label}?`)) return
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const result = await request('DELETE', undefined, `?escopo=${scope}`)
      setStatus(result)
      setMessage(result.mensagem_operacao || 'Acesso removido.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  const contingency = status?.contingencia || emptyContingency
  const coverage = status?.cobertura_contingencia || emptyCoverage
  const missingText = coverage.faltantes.length
    ? `Ainda faltam: ${coverage.faltantes.join(', ')}.`
    : 'Todos os consultores com carteira já cadastraram o acesso de contingência.'

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
            <p>Credenciais usadas somente pela extração automatizada.</p>
          </div>
          <span className="status-pill">
            {status?.configurada ? 'GD configurada' : loading ? 'Carregando' : 'Aguardando GD'}
          </span>
        </div>

        {status && <>
          <div className="integration-status-grid">
            <div><span>Usuário principal salvo</span><strong>{status.usuario_mascarado || 'Nenhum'}</strong></div>
            <div><span>Última alteração</span><strong>{formatDate(status.atualizado_em)}</strong></div>
            <div className="wide"><span>Situação</span><strong>{status.mensagem}</strong></div>
          </div>

          <form className="credentials-form" onSubmit={(event) => void saveGd(event)}>
            <div className="form-heading">
              <h3>{status.configurada ? 'Substituir acesso da GD' : 'Cadastrar acesso da GD'}</h3>
              <p>Este é o acesso principal. A automação tenta a GD primeiro.</p>
            </div>
            <label>
              <span>Usuário do Bússola da GD</span>
              <input value={gdUser} onChange={(event) => setGdUser(event.target.value)} required />
            </label>
            <label>
              <span>Código de acesso do Bússola da GD</span>
              <input type="password" value={gdSecret} onChange={(event) => setGdSecret(event.target.value)} required />
            </label>
            <div className="form-actions">
              <button className="primary-action" disabled={loading}>Salvar acesso da GD</button>
              {status.configurada && <button
                className="danger-button"
                type="button"
                onClick={() => void remove('gd')}
                disabled={loading}
              >Remover acesso da GD</button>}
            </div>
          </form>

          <div className="integration-status-grid">
            <div>
              <span>Contingência cadastrada</span>
              <strong>{coverage.configurados}/{coverage.esperados || '—'} consultores</strong>
            </div>
            <div>
              <span>Pronta para uso</span>
              <strong>{coverage.pronta ? 'Sim' : 'Ainda não'}</strong>
            </div>
            <div className="wide">
              <span>Regra automática</span>
              <strong>Se a GD falhar ou não trouxer dados do mês atual, o painel extrai cada vendedor.</strong>
            </div>
            <div className="wide">
              <span>Cobertura</span>
              <strong>{missingText}</strong>
            </div>
          </div>

          {contingency.disponivel && <form className="credentials-form" onSubmit={(event) => void saveConsultant(event)}>
            <div className="form-heading">
              <h3>Acesso de contingência — {contingency.nome || 'Consultor'}</h3>
              <p>Cadastre o seu próprio Bússola. Ele só será usado quando a extração da GD não trouxer dados do mês atual.</p>
            </div>
            {contingency.configurada && <div className="integration-status-grid">
              <div><span>Seu usuário salvo</span><strong>{contingency.usuario_mascarado}</strong></div>
              <div><span>Última alteração</span><strong>{formatDate(contingency.atualizado_em)}</strong></div>
            </div>}
            <label>
              <span>Seu usuário do Bússola</span>
              <input value={consultantUser} onChange={(event) => setConsultantUser(event.target.value)} required />
            </label>
            <label>
              <span>Seu código de acesso do Bússola</span>
              <input
                type="password"
                value={consultantSecret}
                onChange={(event) => setConsultantSecret(event.target.value)}
                required
              />
            </label>
            <div className="form-actions">
              <button className="primary-action" disabled={loading}>
                {contingency.configurada ? 'Atualizar meu acesso' : 'Salvar meu acesso'}
              </button>
              {contingency.configurada && <button
                className="danger-button"
                type="button"
                onClick={() => void remove('consultor')}
                disabled={loading}
              >Remover meu acesso</button>}
            </div>
          </form>}
        </>}
      </article>

      <aside className="security-card">
        <span className="security-icon">✓</span>
        <h2>Contingência protegida</h2>
        <p>Os acessos individuais ficam criptografados e só são usados pela automação quando o arquivo da GD falhar ou vier sem dados do mês atual.</p>
      </aside>
    </section>

    <BaseManagement adminKey="" enabled />
    <TemplatesSection />
    <CalculationAudit adminKey="" enabled />
  </main>
}
