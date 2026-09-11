import { FormEvent, useEffect, useState } from 'react'
import './useful-links.css'

type UsefulLink = {
  id: string
  nome: string
  url: string
  criado_por: string
  criado_em: string
  atualizado_em: string
}

type FormState = { nome: string; url: string }
const initialForm: FormState = { nome: '', url: '' }

export default function UsefulLinksModule({ onBack }: { onBack: () => void }) {
  const [links, setLinks] = useState<UsefulLink[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [editingId, setEditingId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    try {
      const response = await fetch('/api/links-uteis', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível carregar os links úteis.')
      setLinks(result.links || [])
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function resetForm() {
    setForm(initialForm)
    setEditingId('')
    setError('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/links-uteis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operacao: 'salvar', id: editingId || undefined, ...form }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível salvar o link.')
      setMessage(editingId ? 'Link atualizado com sucesso.' : 'Link adicionado aos LINKs úteis.')
      setForm(initialForm)
      setEditingId('')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  function edit(link: UsefulLink) {
    setEditingId(link.id)
    setForm({ nome: link.nome, url: link.url })
    setMessage('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(link: UsefulLink) {
    if (!confirm(`Excluir o link “${link.nome}”?`)) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/links-uteis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operacao: 'excluir', id: link.id }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível excluir o link.')
      if (editingId === link.id) resetForm()
      setMessage('Link excluído com sucesso.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return <main className="content useful-links-page">
    <button className="back-button" type="button" onClick={onBack}>← Voltar ao painel</button>

    <section className="useful-links-hero">
      <div>
        <span className="eyebrow">Acesso rápido</span>
        <h1>LINKs úteis</h1>
        <p>Cadastre os endereços que você usa no dia a dia. Cada nome salvo vira uma opção clicável para abrir o link diretamente.</p>
      </div>
      <div className="useful-links-count">{loading ? '—' : links.length} link(s)</div>
    </section>

    {error && <div className="alert alert-error useful-links-alert">{error}</div>}
    {message && <div className="alert alert-success useful-links-alert">{message}</div>}

    <section className="useful-links-card useful-links-form-card">
      <div className="useful-links-heading">
        <div>
          <span className="eyebrow">{editingId ? 'Editando link' : 'Novo link'}</span>
          <h2>{editingId ? 'Atualizar LINK útil' : 'Cadastrar LINK útil'}</h2>
        </div>
        {editingId && <button className="outline-button" type="button" onClick={resetForm}>Cancelar edição</button>}
      </div>

      <form className="useful-links-form" onSubmit={event => void save(event)}>
        <label>
          <span>NOME DO LINK</span>
          <input value={form.nome} onChange={event => setForm(current => ({ ...current, nome: event.target.value }))} placeholder="Ex.: Bússola, Mercado Farma, Onfly..." maxLength={120} required />
        </label>
        <label>
          <span>ENDEREÇO DO LINK</span>
          <input value={form.url} onChange={event => setForm(current => ({ ...current, url: event.target.value }))} placeholder="https://..." inputMode="url" required />
        </label>
        <div className="useful-links-form-actions">
          <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Salvando…' : editingId ? 'Atualizar link' : 'Cadastrar link'}</button>
          {editingId && <button className="outline-button" type="button" onClick={resetForm}>Cancelar</button>}
        </div>
      </form>
    </section>

    <section className="useful-links-card useful-links-menu-card">
      <div className="useful-links-heading">
        <div>
          <span className="eyebrow">Submenu</span>
          <h2>Links cadastrados</h2>
          <p>Clique no nome para abrir a página em uma nova aba.</p>
        </div>
      </div>

      <div className="useful-links-list">
        {loading && <div className="useful-links-empty">Carregando links…</div>}
        {!loading && links.map(link => <div className="useful-links-row" key={link.id}>
          <a className="useful-links-open" href={link.url} target="_blank" rel="noreferrer noopener">
            <span className="useful-links-icon">↗</span>
            <span><strong>{link.nome}</strong><small>{link.url}</small></span>
          </a>
          <div className="useful-links-actions">
            <button className="outline-button useful-links-compact" type="button" onClick={() => edit(link)}>Editar</button>
            <button className="danger-button useful-links-compact" type="button" disabled={busy} onClick={() => void remove(link)}>Excluir</button>
          </div>
        </div>)}
        {!loading && !links.length && <div className="useful-links-empty">Nenhum link cadastrado ainda.</div>}
      </div>
    </section>
  </main>
}
