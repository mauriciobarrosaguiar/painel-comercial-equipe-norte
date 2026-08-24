import { useEffect, useMemo, useState } from 'react'
import DesafioGigantesHistory from './DesafioGigantesHistory'
import HistoryImportPanel from './HistoryImportPanel'
import './operations.css'
import './history-import.css'

type Item = {
  id: string
  ano_mes: string
  escopo: string
  referencia_id: string
  referencia_nome: string
  versao: number
  fechado_em: string
  origem?: 'IMPORTADO' | 'FECHAMENTO'
  resultado: Record<string, any>
}
type Month = { ano_mes: string; fechado_em: string; versao: number; origem?: 'IMPORTADO' | 'FECHAMENTO' }
type Data = { meses: Month[]; geral: Item[]; itens: Item[]; aviso?: string }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const mes = (v: string) => { const [y, m] = String(v || '').split('-'); return y && m ? `${m}/${y}` : v }
const valor = (x: any, k: string) => Number(x?.resultado?.[k] || 0)

export default function HistoryModule({ onBack, onAutomations }: { onBack: () => void; onAutomations: () => void }) {
  const [data, setData] = useState<Data>({ meses: [], geral: [], itens: [] })
  const [selected, setSelected] = useState('')
  const [scope, setScope] = useState('CONSULTOR')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const c = new AbortController()
    setLoading(true)
    fetch('/api/historico', { cache: 'no-store', signal: c.signal })
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.detalhe || d.erro)
        setData(d)
        setSelected(current => d.meses?.some((x: Month) => x.ano_mes === current) ? current : d.meses?.[0]?.ano_mes || '')
        setError('')
      })
      .catch(e => { if (e.name !== 'AbortError') setError(String(e.message || e)) })
      .finally(() => setLoading(false))
    return () => c.abort()
  }, [reload])

  const atual = useMemo(() => data.geral.find(x => x.ano_mes === selected), [data, selected])
  const anterior = useMemo(() => {
    const a = [...data.geral].sort((x, y) => y.ano_mes.localeCompare(x.ano_mes))
    const i = a.findIndex(x => x.ano_mes === selected)
    return i >= 0 ? a[i + 1] : undefined
  }, [data, selected])
  const linhas = data.itens.filter(x => x.ano_mes === selected && x.escopo === scope)
  const variacao = (k: string) => {
    const a = valor(atual, k), b = valor(anterior, k)
    return b > 0 ? (a - b) / b * 100 : a > 0 ? 100 : 0
  }
  const metricas = [
    { label: 'OL total', key: 'ol_total' },
    { label: 'OL sem combate', key: 'ol_sem_combate', metaKey: 'meta_ol_sem_combate', resultadoKey: 'resultado_meta_ol' },
    { label: 'Prioritários', key: 'ol_prioritarios', metaKey: 'meta_ol_prioritarios', resultadoKey: 'resultado_meta_prioritarios' },
    { label: 'Lançamentos', key: 'ol_lancamentos', metaKey: 'meta_ol_lancamentos', resultadoKey: 'resultado_meta_lancamentos' },
  ]
  const mesImportado = atual?.origem === 'IMPORTADO' || atual?.resultado?.origem === 'IMPORTADO'

  const celulaMeta = (item: Item, realizadoKey: string, metaKey: string, resultadoKey: string) => {
    const meta = valor(item, metaKey)
    return <>
      <strong>{money.format(valor(item, realizadoKey))}</strong>
      {meta > 0 && <small>Meta {money.format(meta)} · {pct.format(valor(item, resultadoKey))}%</small>}
    </>
  }

  return <main className="content operations-page">
    <button className="back-button" onClick={onBack}>← Voltar ao painel</button>
    <section className="operations-hero">
      <div><span className="eyebrow">Fotografias permanentes</span><h1>Histórico mensal</h1><p>Resultados e metas fechadas por mês, com atualização dos faturamentos retroativos.</p></div>
      <button className="secondary-button" onClick={onAutomations}>Executar fechamento</button>
    </section>
    <HistoryImportPanel onImported={() => setReload(v => v + 1)} />
    {error && <div className="alert alert-error">{error}</div>}
    {data.aviso && <div className="alert alert-error">{data.aviso}</div>}
    <section className="filters history-filters">
      <label><span>Mês fechado</span><select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Selecione</option>{data.meses.map(x => <option key={x.ano_mes} value={x.ano_mes}>{mes(x.ano_mes)} · {x.origem === 'IMPORTADO' ? 'planilha importada' : `versão ${x.versao}`}</option>)}</select></label>
      <label><span>Detalhamento</span><select value={scope} onChange={e => setScope(e.target.value)}><option value="CONSULTOR">Consultores</option><option value="GD">GD / Gerente</option><option value="UF">UF</option><option value="SIP">SIP</option></select></label>
    </section>
    {mesImportado && <div className="alert alert-success">Mês carregado da planilha histórica. O OL total, pedidos, clientes e positivação estão disponíveis; o mix de produtos e as metas congeladas dependem do fechamento mensal do painel.</div>}
    {!selected && !loading ? <div className="history-empty"><h2>Nenhum mês fechado</h2><p>Anexe os meses anteriores ou aguarde o fechamento automático após a virada do mês.</p></div> : <>
      <section className="history-summary">
        {metricas.map(item => {
          const vari = variacao(item.key)
          const meta = item.metaKey ? valor(atual, item.metaKey) : 0
          return <article key={item.key}>
            <span>{item.label}</span>
            <strong>{loading ? '—' : money.format(valor(atual, item.key))}</strong>
            <small className={vari < 0 ? 'variation-negative' : 'variation-positive'}>
              {meta > 0 && item.resultadoKey && <>Meta fechada: {money.format(meta)} · {pct.format(valor(atual, item.resultadoKey))}% · </>}
              {vari >= 0 ? '+' : ''}{pct.format(vari)}% versus {mes(anterior?.ano_mes || 'mês anterior')}
            </small>
          </article>
        })}
        <article><span>Clientes com venda</span><strong>{num.format(valor(atual, 'clientes_com_venda'))}</strong><small>{valor(atual, 'meta_clientes') > 0 && <>Meta fechada: {num.format(valor(atual, 'meta_clientes'))} · {pct.format(valor(atual, 'resultado_meta_clientes'))}% · </>}{num.format(valor(atual, 'clientes_sem_venda'))} sem venda · {pct.format(valor(atual, 'positivacao_percentual'))}%</small></article>
        <article><span>Atingimento da meta principal</span><strong>{pct.format(valor(atual, 'resultado_meta_ol'))}%</strong><small>Meta fechada: {money.format(valor(atual, 'meta_ol_sem_combate'))}</small></article>
      </section>
      <section className="operations-list">
        <div className="operations-heading"><h2>Resultado por {scope === 'CONSULTOR' ? 'consultor' : scope}</h2><span>{linhas.length} registros</span></div>
        {!linhas.length ? <div className="operations-empty">Sem detalhamento para esse mês.</div> : <div className="history-table-wrap"><table className="history-table"><thead><tr><th>Referência</th><th>OL total</th><th>Sem combate / meta</th><th>Prioritários / meta</th><th>Lançamentos / meta</th><th>Clientes / meta</th><th>Positivação</th></tr></thead><tbody>{linhas.map(x => <tr key={x.id}><td><strong>{x.referencia_nome || x.referencia_id}</strong></td><td><strong>{money.format(valor(x, 'ol_total'))}</strong></td><td>{celulaMeta(x, 'ol_sem_combate', 'meta_ol_sem_combate', 'resultado_meta_ol')}</td><td>{celulaMeta(x, 'ol_prioritarios', 'meta_ol_prioritarios', 'resultado_meta_prioritarios')}</td><td>{celulaMeta(x, 'ol_lancamentos', 'meta_ol_lancamentos', 'resultado_meta_lancamentos')}</td><td><strong>{num.format(valor(x, 'clientes_com_venda'))}/{num.format(valor(x, 'clientes_ativos'))}</strong>{valor(x, 'meta_clientes') > 0 && <small>Meta {num.format(valor(x, 'meta_clientes'))} · {pct.format(valor(x, 'resultado_meta_clientes'))}%</small>}</td><td>{pct.format(valor(x, 'positivacao_percentual'))}%</td></tr>)}</tbody></table></div>}
      </section>
      <DesafioGigantesHistory anoMes={selected} />
    </>}
  </main>
}
