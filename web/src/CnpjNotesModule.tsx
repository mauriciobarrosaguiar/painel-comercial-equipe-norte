import { FormEvent, useEffect, useMemo, useState } from 'react'
import './cnpj-notes.css'

type Consultant = { id: string; nome: string }
type CnpjNote = {
  id: string
  consultor_id: string
  consultor: string
  cnpj: string
  razao_social: string
  nome_contato: string
  telefone: string
  observacao: string
  acao_painel: 'INCLUIR' | 'EXCLUIR'
  criado_por: string
  criado_em: string
  atualizado_em: string
}
type Data = {
  anotacoes: CnpjNote[]
  filtros: { consultores: Consultant[] }
  resumo: { total: number; incluir: number; excluir: number }
}
type FormState = {
  consultor_id: string
  cnpj: string
  razao_social: string
  nome_contato: string
  telefone: string
  observacao: string
  acao_painel: 'INCLUIR' | 'EXCLUIR'
}

const initialForm: FormState = {
  consultor_id: '',
  cnpj: '',
  razao_social: '',
  nome_contato: '',
  telefone: '',
  observacao: '',
  acao_painel: 'INCLUIR',
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim()
const onlyDigits = (value: string) => value.replace(/\D/g, '')

function formatCnpj(value: string) {
  const digits = onlyDigits(value).slice(0, 14)
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 11)
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return digits.replace(/^(\d{2})(\d+)/, '($1) $2')
  if (digits.length <= 10) return digits.replace(/^(\d{2})(\d{4})(\d+)/, '($1) $2-$3')
  return digits.replace(/^(\d{2})(\d{5})(\d+)/, '($1) $2-$3')
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

export default function CnpjNotesModule({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<Data>({ anotacoes: [], filtros: { consultores: [] }, resumo: { total: 0, incluir: 0, excluir: 0 } })
  const [form, setForm] = useState<FormState>(initialForm)
  const [editingId, setEditingId] = useState('')
  const [search, setSearch] = useState('')
  const [consultantFilter, setConsultantFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    try {
      const response = await fetch('/api/cnpj-anotacoes', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível carregar as anotações.')
      setData({
        anotacoes: result.anotacoes || [],
        filtros: { consultores: result.filtros?.consultores || [] },
        resumo: result.resumo || { total: 0, incluir: 0, excluir: 0 },
      })
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const query = normalize(search)
    const digits = onlyDigits(search)
    return data.anotacoes.filter(note => {
      if (consultantFilter && note.consultor_id !== consultantFilter) return false
      if (actionFilter && note.acao_painel !== actionFilter) return false
      if (!query && !digits) return true
      const haystack = normalize(`${note.razao_social} ${note.consultor} ${note.nome_contato} ${note.telefone} ${note.observacao}`)
      return haystack.includes(query) || (digits && onlyDigits(note.cnpj).includes(digits))
    })
  }, [data.anotacoes, search, consultantFilter, actionFilter])

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

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
      const response = await fetch('/api/cnpj-anotacoes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operacao: 'salvar', id: editingId || undefined, ...form, cnpj: onlyDigits(form.cnpj) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível salvar a anotação.')
      setMessage(editingId ? 'Anotação atualizada com sucesso.' : 'CNPJ adicionado às anotações.')
      setForm(initialForm)
      setEditingId('')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  function edit(note: CnpjNote) {
    setEditingId(note.id)
    setForm({
      consultor_id: note.consultor_id,
      cnpj: formatCnpj(note.cnpj),
      razao_social: note.razao_social,
      nome_contato: note.nome_contato,
      telefone: note.telefone,
      observacao: note.observacao,
      acao_painel: note.acao_painel,
    })
    setMessage('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(note: CnpjNote) {
    if (!confirm(`Excluir a anotação de ${note.razao_social}?`)) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/cnpj-anotacoes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operacao: 'excluir', id: note.id }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro || 'Não foi possível excluir a anotação.')
      if (editingId === note.id) resetForm()
      setMessage('Anotação excluída.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return <main className="content cnpj-notes-page">
    <button className="back-button" type="button" onClick={onBack}>← Voltar ao painel</button>

    <section className="cnpj-notes-hero">
      <div>
        <span className="eyebrow">Planejamento de carteira</span>
        <h1>Anotações de CNPJs</h1>
        <p>Organize os clientes que deverão ser incluídos ou excluídos do Painel nos próximos meses.</p>
      </div>
      <div className="cnpj-notes-hero-badge">{data.resumo.total} anotações</div>
    </section>

    <section className="cnpj-notes-summary">
      <article><span>Total anotado</span><strong>{loading ? '—' : data.resumo.total}</strong><small>CNPJs em acompanhamento</small></article>
      <article><span>Para incluir</span><strong>{loading ? '—' : data.resumo.incluir}</strong><small>Entrarão no Painel</small></article>
      <article><span>Para excluir</span><strong>{loading ? '—' : data.resumo.excluir}</strong><small>Serão retirados do Painel</small></article>
    </section>

    {error && <div className="alert alert-error cnpj-notes-alert">{error}</div>}
    {message && <div className="alert alert-success cnpj-notes-alert">{message}</div>}

    <section className="cnpj-notes-card cnpj-notes-form-card">
      <div className="cnpj-notes-card-heading">
        <div><span className="eyebrow">{editingId ? 'Editando registro' : 'Nova anotação'}</span><h2>{editingId ? 'Atualizar CNPJ' : 'Cadastrar CNPJ'}</h2></div>
        {editingId && <button className="outline-button" type="button" onClick={resetForm}>Cancelar edição</button>}
      </div>

      <form className="cnpj-notes-form" onSubmit={event => void save(event)}>
        <label><span>SELECIONE O CONSULTOR</span><select value={form.consultor_id} onChange={event => setField('consultor_id', event.target.value)} required><option value="">Selecione</option>{data.filtros.consultores.map(item => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
        <label><span>CNPJ</span><input value={form.cnpj} onChange={event => setField('cnpj', formatCnpj(event.target.value))} placeholder="00.000.000/0000-00" inputMode="numeric" required /></label>
        <label><span>RAZÃO SOCIAL</span><input value={form.razao_social} onChange={event => setField('razao_social', event.target.value)} placeholder="Razão social da empresa" required /></label>
        <label><span>NOME DO CONTATO</span><input value={form.nome_contato} onChange={event => setField('nome_contato', event.target.value)} placeholder="Nome do contato" /></label>
        <label><span>TELEFONE</span><input value={form.telefone} onChange={event => setField('telefone', formatPhone(event.target.value))} placeholder="(00) 00000-0000" inputMode="tel" /></label>
        <label><span>AÇÃO NO PAINEL</span><select value={form.acao_painel} onChange={event => setField('acao_painel', event.target.value as 'INCLUIR' | 'EXCLUIR')}><option value="INCLUIR">Incluir no Painel</option><option value="EXCLUIR">Excluir do Painel</option></select></label>
        <label className="cnpj-notes-wide"><span>OBSERVAÇÃO</span><textarea value={form.observacao} onChange={event => setField('observacao', event.target.value)} placeholder="Ex.: incluir no próximo ciclo, substituir cliente, aguardar definição do setor..." rows={4} /></label>
        <div className="cnpj-notes-form-actions"><button className="primary-action" type="submit" disabled={busy}>{busy ? 'Salvando…' : editingId ? 'Atualizar anotação' : 'Salvar anotação'}</button>{editingId && <button className="outline-button" type="button" onClick={resetForm}>Cancelar</button>}</div>
      </form>
    </section>

    <section className="cnpj-notes-card cnpj-notes-list-card">
      <div className="cnpj-notes-list-heading">
        <div><span className="eyebrow">Próximos meses</span><h2>CNPJs anotados</h2><p>{filtered.length} registro(s) exibido(s)</p></div>
        <div className="cnpj-notes-filters">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar CNPJ, empresa ou contato" />
          <select value={consultantFilter} onChange={event => setConsultantFilter(event.target.value)}><option value="">Todos os consultores</option>{data.filtros.consultores.map(item => <option key={item.id} value={item.id}>{item.nome}</option>)}</select>
          <select value={actionFilter} onChange={event => setActionFilter(event.target.value)}><option value="">Incluir e excluir</option><option value="INCLUIR">Somente incluir</option><option value="EXCLUIR">Somente excluir</option></select>
        </div>
      </div>

      <div className="cnpj-notes-table-wrap">
        <table className="cnpj-notes-table">
          <thead><tr><th>Ação</th><th>Empresa</th><th>Consultor</th><th>Contato</th><th>Observação</th><th>Atualização</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="cnpj-notes-empty">Carregando anotações…</td></tr>}
            {!loading && filtered.map(note => <tr key={note.id}>
              <td><span className={`cnpj-action-badge cnpj-action-${note.acao_painel.toLowerCase()}`}>{note.acao_painel === 'INCLUIR' ? 'Incluir' : 'Excluir'}</span></td>
              <td><strong>{note.razao_social}</strong><small>{formatCnpj(note.cnpj)}</small></td>
              <td><strong>{note.consultor}</strong></td>
              <td><strong>{note.nome_contato || '—'}</strong><small>{note.telefone || 'Sem telefone'}</small></td>
              <td className="cnpj-notes-observation">{note.observacao || '—'}</td>
              <td><small>{formatDate(note.atualizado_em)}</small></td>
              <td><div className="cnpj-notes-row-actions"><button className="outline-button cnpj-notes-compact" type="button" onClick={() => edit(note)}>Editar</button><button className="danger-button cnpj-notes-compact" type="button" disabled={busy} onClick={() => void remove(note)}>Excluir</button></div></td>
            </tr>)}
            {!loading && !filtered.length && <tr><td colSpan={7} className="cnpj-notes-empty">Nenhum CNPJ encontrado para os filtros selecionados.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </main>
}
