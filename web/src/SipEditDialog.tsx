import { FormEvent, useEffect, useMemo, useState } from 'react'
import './sip-edit.css'

type SipItem = {
  id: string
  nome: string
  meta_mes: number
  cnpjs_vinculados: number
}

type SipEditClient = {
  cnpj: string
  nome: string
  cidade: string
  uf: string
  consultor: string
}

type SipEditDetail = {
  sip: {
    id: string
    nome: string
    meta_mes: number
    pagamento_percentual: number
    acesso_publico_ativo: number | boolean
  }
  clientes: SipEditClient[]
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')
const cnpjFormat = (value: string) => {
  const digits = value.replace(/\D/g, '').padStart(14, '0').slice(-14)
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

export default function SipEditDialog({
  sip,
  onClose,
  onSaved,
}: {
  sip: SipItem
  onClose: () => void
  onSaved: (message: string) => void | Promise<void>
}) {
  const [detail, setDetail] = useState<SipEditDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState(sip.nome)
  const [goal, setGoal] = useState(Number(sip.meta_mes || 0))
  const [payment, setPayment] = useState(0)
  const [publicAccess, setPublicAccess] = useState(true)
  const [newCnpjs, setNewCnpjs] = useState('')
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/sips/detalhe?id=${encodeURIComponent(sip.id)}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.detalhe || result.erro || 'Falha ao carregar a SIP.')
        setDetail(result)
        setName(String(result.sip.nome || sip.nome))
        setGoal(Number(result.sip.meta_mes || 0))
        setPayment(Number(result.sip.pagamento_percentual || 0))
        setPublicAccess(Boolean(Number(result.sip.acesso_publico_ativo ?? 1)))
        setError('')
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [sip.id, sip.nome])

  const activeClients = useMemo(
    () => (detail?.clientes || []).filter((client) => !removed.has(client.cnpj)),
    [detail, removed],
  )

  const toggleRemove = (cnpj: string) => {
    setRemoved((current) => {
      const next = new Set(current)
      if (next.has(cnpj)) next.delete(cnpj)
      else next.add(cnpj)
      return next
    })
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/sips/editar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sip_id: sip.id,
          nome: name,
          meta_mes: goal,
          pagamento_percentual: payment,
          acesso_publico_ativo: publicAccess,
          cnpjs_adicionar: newCnpjs,
          cnpjs_remover: [...removed],
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        const missing = Array.isArray(result.cnpjs_nao_encontrados)
          ? ` CNPJs: ${result.cnpjs_nao_encontrados.join(', ')}` : ''
        throw new Error(`${result.detalhe || result.erro || 'Falha ao editar a SIP.'}${missing}`)
      }
      await onSaved(result.mensagem || `SIP ${name} atualizada.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sip-edit-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose()
    }}>
      <section className="sip-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="sip-edit-title">
        <div className="sip-edit-heading">
          <div>
            <span>EDITAR SIP</span>
            <h2 id="sip-edit-title">{sip.nome}</h2>
            <small>Atualize os dados e os CNPJs vinculados ao grupo.</small>
          </div>
          <button type="button" className="sip-edit-close" onClick={onClose} disabled={saving} aria-label="Fechar">×</button>
        </div>

        {error && <div className="alert alert-error sip-edit-alert">{error}</div>}
        {loading ? <div className="sips-empty">Carregando dados da SIP…</div> : (
          <form className="sip-edit-form" onSubmit={(event) => void save(event)}>
            <div className="sip-edit-fields">
              <label className="sip-edit-name">
                <span>Nome da SIP</span>
                <input value={name} onChange={(event) => setName(event.target.value)} required minLength={3} />
              </label>
              <label>
                <span>Meta total mensal</span>
                <input type="number" min="0" step="0.01" value={goal} onChange={(event) => setGoal(Math.max(0, Number(event.target.value || 0)))} />
                <small>{money.format(goal || 0)}</small>
              </label>
              <label>
                <span>Pagamento (%)</span>
                <input type="number" min="0" step="0.01" value={payment} onChange={(event) => setPayment(Math.max(0, Number(event.target.value || 0)))} />
              </label>
              <label className="sip-edit-public">
                <input type="checkbox" checked={publicAccess} onChange={(event) => setPublicAccess(event.target.checked)} />
                <span>Manter link público ativo</span>
              </label>
            </div>

            <div className="sip-edit-grid">
              <section className="sip-edit-clients">
                <div className="sip-edit-section-heading">
                  <div>
                    <h3>CNPJs vinculados</h3>
                    <small>{num.format(activeClients.length)} permanecerão · {num.format(removed.size)} marcados para remoção</small>
                  </div>
                </div>
                <div className="sip-edit-client-list">
                  {(detail?.clientes || []).map((client) => {
                    const willRemove = removed.has(client.cnpj)
                    return (
                      <article className={willRemove ? 'will-remove' : ''} key={client.cnpj}>
                        <div>
                          <strong>{client.nome}</strong>
                          <span>{cnpjFormat(client.cnpj)}</span>
                          <small>{client.cidade}{client.uf ? `/${client.uf}` : ''}{client.consultor ? ` · ${client.consultor}` : ''}</small>
                        </div>
                        <button type="button" onClick={() => toggleRemove(client.cnpj)}>
                          {willRemove ? 'Desfazer' : 'Remover'}
                        </button>
                      </article>
                    )
                  })}
                  {!detail?.clientes?.length && <p className="sip-edit-empty">Nenhum CNPJ vinculado.</p>}
                </div>
              </section>

              <section className="sip-edit-add">
                <h3>Adicionar CNPJs</h3>
                <p>Cole um CNPJ por linha ou separe por vírgula. Os clientes precisam existir na carteira ativa.</p>
                <textarea
                  rows={10}
                  value={newCnpjs}
                  onChange={(event) => setNewCnpjs(event.target.value)}
                  placeholder={'12.345.678/0001-90\n98.765.432/0001-10'}
                />
                <small>A meta total será redistribuída igualmente entre os CNPJs ativos após salvar.</small>
              </section>
            </div>

            <div className="sip-edit-actions">
              <button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancelar</button>
              <button type="submit" className="primary-action" disabled={saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
