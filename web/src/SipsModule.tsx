import { FormEvent, useEffect, useState } from 'react'
import SipDetailView, { SipDetail } from './SipDetailView'
import SipSummaryReport, { SipSummaryData } from './SipSummaryReport'
import './sips.css'
import './sip-phase4.css'

type Sip = {
  id: string
  nome: string
  redes: number
  nomes_redes: string
  clientes_ativos: number
  cnpjs_vinculados: number
  clientes_com_venda: number
  ol_total: number
  ol_sem_combate: number
  meta_mes: number
  resultado_meta: number
  gap_80: number
  gap_90: number
  gap_100: number
}

type List = {
  periodo: { inicio: string; fim: string; rotulo: string }
  sips: Sip[]
  resumo_sip: SipSummaryData
  totais: {
    sips: number
    redes: number
    clientes_com_venda: number
    clientes_sem_venda: number
    ol_total: number
    ol_sem_combate: number
  }
}

type Detail = SipDetail & {
  periodo: { inicio: string; fim: string }
  link_publico: string
  link_exportacao: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export default function SipsModule({ onBack, publicId }: { onBack: () => void; publicId?: string }) {
  const [data, setData] = useState<List | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [selected, setSelected] = useState(publicId || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function loadList() {
    const response = await fetch('/api/sips?periodo=mes-atual', { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error(result.detalhe || result.erro)
    setData(result)
  }

  async function loadDetail(id: string) {
    setLoading(true)
    try {
      const response = await fetch(
        `/api/sips/detalhe?id=${encodeURIComponent(id)}${publicId ? '&publico=1' : ''}`,
        { cache: 'no-store' },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro)
      setDetail(result)
      setSelected(id)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        if (publicId) await loadDetail(publicId)
        else await loadList()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setLoading(false)
      }
    })()
  }, [publicId])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    try {
      const response = await fetch('/api/sips/cadastro', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nome: form.get('nome'),
          meta_mes: form.get('meta_mes'),
          pagamento_percentual: form.get('pagamento_percentual'),
          cnpjs: form.get('cnpjs'),
          acesso_publico_ativo: form.get('publico') === 'on',
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detalhe || result.erro)
      setMessage(`${result.nome} cadastrada com ${result.clientes_vinculados} clientes.`)
      setShowForm(false)
      await loadList()
      await loadDetail(result.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  async function copy() {
    if (!detail) return
    await navigator.clipboard.writeText(detail.link_publico)
    setMessage('Link individual copiado.')
  }

  const updateSummary = (updated: SipSummaryData) => {
    const rowById = new Map(updated.linhas.map((row) => [row.id, row]))
    setData((current) => current ? {
      ...current,
      sips: current.sips.map((sip) => {
        const row = rowById.get(sip.id)
        return row ? {
          ...sip,
          meta_mes: row.objetivo,
          resultado_meta: row.cobertura,
          gap_80: row.gap_80,
          gap_90: row.gap_90,
          gap_100: row.gap_100,
        } : sip
      }),
      resumo_sip: updated,
    } : current)
  }

  if (publicId) {
    return (
      <main className="content sip-public-page">
        <section className="sips-hero">
          <div>
            <span className="eyebrow">Acompanhamento individual</span>
            <h1>{detail?.sip.nome || 'Resultado SIP'}</h1>
            <p>Vendas, notas e produtos dos CNPJs vinculados.</p>
          </div>
          <div className="sip-hero-actions">
            <span>{detail?.periodo.inicio?.split('-').reverse().join('/')} a {detail?.periodo.fim?.split('-').reverse().join('/')}</span>
            {detail && <a className="secondary-button sip-download" href={detail.link_exportacao}>Baixar vendas detalhadas</a>}
          </div>
        </section>
        {error && <div className="alert alert-error">{error}</div>}
        {loading ? <div className="sips-empty">Carregando…</div> : detail && <SipDetailView detail={detail} publicView />}
      </main>
    )
  }

  return (
    <main className="content sips-page">
      <button className="back-button" onClick={onBack}>← Voltar ao painel</button>

      <section className="sips-hero">
        <div>
          <span className="eyebrow">Redes comerciais</span>
          <h1>SIP / Redes</h1>
          <p>Resultados, notas e exportações individuais por SIP.</p>
        </div>
        <div className="sip-hero-actions">
          <span>{data?.periodo.rotulo || 'Mês atual'}</span>
          <button className="secondary-button" onClick={() => setShowForm((current) => !current)}>Cadastrar SIP</button>
        </div>
      </section>

      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      {showForm && (
        <form className="sip-register" onSubmit={(event) => void save(event)}>
          <h2>Nova SIP</h2>
          <label><span>Nome</span><input name="nome" required /></label>
          <label><span>Meta mensal</span><input name="meta_mes" type="number" min="0" step="0.01" /></label>
          <label><span>Pagamento (%)</span><input name="pagamento_percentual" type="number" min="0" step="0.01" /></label>
          <label className="sip-cnpjs"><span>CNPJs</span><textarea name="cnpjs" rows={5} placeholder="Um CNPJ por linha" /></label>
          <label className="sip-public-check"><input name="publico" type="checkbox" defaultChecked /><span>Liberar link individual</span></label>
          <button className="primary-action" disabled={saving}>{saving ? 'Salvando…' : 'Cadastrar SIP'}</button>
        </form>
      )}

      <section className="sips-summary">
        <article><span>SIPs</span><strong>{num.format(data?.totais.sips || 0)}</strong></article>
        <article><span>Redes</span><strong>{num.format(data?.totais.redes || 0)}</strong></article>
        <article>
          <span>Clientes com venda</span>
          <strong>{num.format(data?.totais.clientes_com_venda || 0)}</strong>
          <small>{num.format(data?.totais.clientes_sem_venda || 0)} sem venda</small>
        </article>
        <article><span>OL total</span><strong>{money.format(data?.totais.ol_total || 0)}</strong></article>
      </section>

      <section className="sips-list">
        <div className="sips-heading"><h2>SIPs cadastradas</h2><span>{data?.sips.length || 0}</span></div>
        {data?.sips.map((sip) => (
          <button className="sip-card sip-card-button" key={sip.id} onClick={() => void loadDetail(sip.id)}>
            <div><h3>{sip.nome}</h3><p>{sip.redes} redes · {sip.nomes_redes || 'Sem rede informada'}</p></div>
            <div><span>Clientes</span><strong>{sip.clientes_com_venda}/{sip.cnpjs_vinculados || sip.clientes_ativos}</strong></div>
            <div><span>OL total</span><strong>{money.format(sip.ol_total)}</strong></div>
            <div><span>Sem combate</span><strong>{money.format(sip.ol_sem_combate)}</strong></div>
            <div><span>Meta</span><strong>{money.format(sip.meta_mes)}</strong><small>{pct.format(sip.resultado_meta)}%</small></div>
            <b>Ver resultado →</b>
          </button>
        ))}
      </section>

      <section className="sip-all-summaries">
        <div className="sip-all-summaries-heading">
          <div>
            <span className="eyebrow">Objetivo preço líquido</span>
            <h2>Resultado consolidado por SIP</h2>
            <p>Cada linha soma todos os CNPJs vinculados ao respectivo grupo.</p>
          </div>
          <span>{data?.sips.length || 0} SIPs</span>
        </div>

        {loading && !data && <div className="sips-empty">Carregando resumo…</div>}
        {data?.resumo_sip && <SipSummaryReport data={data.resumo_sip} onUpdated={updateSummary} />}
      </section>

      {selected && (
        <div className="sip-detail-backdrop" onClick={() => { setSelected(''); setDetail(null) }}>
          <aside className="sip-detail-panel" onClick={(event) => event.stopPropagation()}>
            <button className="detail-close" onClick={() => { setSelected(''); setDetail(null) }}>×</button>
            {loading ? <div className="sips-empty">Carregando…</div> : detail && (
              <>
                <div className="sip-share">
                  <code>{detail.link_publico}</code>
                  <button className="outline-button" onClick={() => void copy()}>Copiar link</button>
                  <a className="primary-action sip-download" href={detail.link_exportacao}>Baixar vendas</a>
                </div>
                <SipDetailView detail={detail} />
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  )
}
