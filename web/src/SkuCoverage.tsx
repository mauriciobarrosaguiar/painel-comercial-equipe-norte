import { useEffect, useState } from 'react'
import './sku-coverage.css'

type Group = { total: number; comprados: number; faltantes: number; percentual: number; unidades: number }
type Groups = Record<string, Group>
type Product = { sku: string; ean: string; codigo_sap: string; produto: string; tipo_mix: string; unidades: number; clientes: number; clientes_recompra: number; ultima_compra: string | null }
type Data = { resumo: Groups; clientes: { id: string; nome: string; cnpj: string; grupos: Groups }[]; produtos: Product[]; mensal: { mes: string; grupos: Groups }[]; unidades_sem_catalogo: number; criterio: string }
type Props = { clienteId?: string; inicio?: string; fim?: string; uf?: string }
const num = new Intl.NumberFormat('pt-BR')
const labels = [['LANCAMENTO', 'Lançamentos'], ['PRIORITARIO', 'Prioritários'], ['TOTAL', 'Catálogo total']]

export default function SkuCoverage({ clienteId = '', inicio = '', fim = '', uf = '' }: Props) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [group, setGroup] = useState('TODOS')
  const [status, setStatus] = useState('TODOS')
  const [search, setSearch] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError('')
    const params = new URLSearchParams({ id: clienteId, inicio, fim, uf })
    fetch(`/api/cobertura-skus?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok || !body.resumo || !Array.isArray(body.produtos)) throw new Error(body.erro || 'Falha na consulta.'); return body })
      .then(setData).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Falha na consulta.') })
    return () => controller.abort()
  }, [clienteId, inicio, fim, uf, retry])
  const products = (data?.produtos || []).filter(p => (group === 'TODOS' || p.tipo_mix === group)
    && (status === 'TODOS' || (status === 'COMPRADOS' ? p.unidades > 0 : p.unidades === 0))
    && `${p.produto} ${p.sku} ${p.ean}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
  return <section className="sku-coverage" aria-label="Cobertura de SKUs e unidades">
    <header><h2>{clienteId ? 'SKUs comprados pelo cliente' : 'Meus SKUs vendidos e unidades'}</h2>
      <p>{inicio && fim ? `${inicio.split('-').reverse().join('/')} a ${fim.split('-').reverse().join('/')}` : 'Todo o histórico disponível'} · Cobertura por apresentação e volume em unidades</p></header>
    {error ? <p role="alert">{error} <button type="button" className="secondary-button" onClick={() => setRetry(n => n + 1)}>Tentar novamente</button></p> : !data ? <p role="status">Calculando SKUs e unidades…</p> : <>
      <div className="sku-cards">{labels.map(([key, label]) => {
        const g = data.resumo[key]
        return <article key={key}><h3>{label}</h3><strong>{num.format(g.comprados)} / {num.format(g.total)} SKUs</strong>
          <progress value={g.comprados} max={g.total || 1} aria-label={`${label}: ${g.percentual}% de cobertura`} />
          <span>{num.format(g.percentual)}% de cobertura · faltam {num.format(g.faltantes)}</span>
          <b>{num.format(g.unidades)} unidades faturadas</b></article>
      })}</div>
      <p className="sku-note">{data.criterio}</p>
      {data.unidades_sem_catalogo > 0 && <p className="sku-note">O total inclui {num.format(data.unidades_sem_catalogo)} unidades sem correspondência no catálogo ativo; elas não aumentam a cobertura de lançamentos ou prioritários.</p>}
      {!clienteId && <details><summary>Cobertura de cada cliente ({data.clientes.length})</summary><div className="sku-scroll"><table><thead><tr><th>Cliente / CNPJ</th><th>Lançamentos SKUs</th><th>Unidades lanç.</th><th>Prioritários SKUs</th><th>Unidades prior.</th><th>Unidades totais</th></tr></thead><tbody>
        {data.clientes.map(c => <tr key={c.id}><th scope="row">{c.nome}<small>{c.cnpj}</small></th><td>{c.grupos.LANCAMENTO.comprados} / {c.grupos.LANCAMENTO.total}</td><td>{num.format(c.grupos.LANCAMENTO.unidades)}</td><td>{c.grupos.PRIORITARIO.comprados} / {c.grupos.PRIORITARIO.total}</td><td>{num.format(c.grupos.PRIORITARIO.unidades)}</td><td>{num.format(c.grupos.TOTAL.unidades)}</td></tr>)}
      </tbody></table></div></details>}
      <details><summary>Evolução mensal em unidades</summary><div className="sku-scroll"><table><thead><tr><th>Mês</th><th>Lanç. SKUs</th><th>Lanç. un.</th><th>Prior. SKUs</th><th>Prior. un.</th><th>Total un.</th></tr></thead><tbody>
        {data.mensal.map(m => <tr key={m.mes}><th scope="row">{m.mes}</th><td>{m.grupos.LANCAMENTO.comprados}</td><td>{num.format(m.grupos.LANCAMENTO.unidades)}</td><td>{m.grupos.PRIORITARIO.comprados}</td><td>{num.format(m.grupos.PRIORITARIO.unidades)}</td><td>{num.format(m.grupos.TOTAL.unidades)}</td></tr>)}
        {!data.mensal.length && <tr><td colSpan={6}>Sem unidades faturadas identificadas no período.</td></tr>}
      </tbody></table></div></details>
      <details><summary>Giro, recompra e produtos que faltam</summary><div className="sku-filters">
        <label>Grupo<select value={group} onChange={e => setGroup(e.target.value)}><option value="TODOS">Todos os produtos</option><option value="LANCAMENTO">Lançamentos</option><option value="PRIORITARIO">Prioritários</option></select></label>
        <label>Compra<select value={status} onChange={e => setStatus(e.target.value)}><option value="TODOS">Todos</option><option value="COMPRADOS">Comprados</option><option value="FALTANTES">Não comprados no período</option></select></label>
        <label>Produto, EAN ou SAP<input value={search} onChange={e => setSearch(e.target.value)} type="search" /></label>
      </div><div className="sku-scroll"><table><thead><tr><th>Produto / EAN / SAP</th><th>Grupo</th><th>Unidades</th><th>Clientes</th><th>Clientes com recompra</th><th>Última compra</th></tr></thead><tbody>
        {products.map(p => <tr key={p.sku}><th scope="row">{p.produto}<small>{p.ean ? `EAN ${p.ean}` : 'EAN não vinculado'}{p.codigo_sap ? ` · SAP ${p.codigo_sap}` : ''}</small></th><td>{labels.find(([key]) => key === p.tipo_mix)?.[1] || p.tipo_mix}</td><td>{num.format(p.unidades)}</td><td>{p.clientes}</td><td>{p.clientes_recompra}</td><td>{p.ultima_compra?.split('-').reverse().join('/') || 'Sem compra no período'}</td></tr>)}
        {!products.length && <tr><td colSpan={6}>Nenhum produto para estes filtros.</td></tr>}
      </tbody></table></div></details>
    </>}
  </section>
}
