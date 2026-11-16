import { useEffect, useState } from 'react'
const labels = [['sem_combate','Sem Combate'],['prioritarios','Prioritários'],['lancamentos','Lançamentos'],['linha','Linha'],['total','Catálogo Total']]
const decimal = (v: number | null | undefined) => v == null ? 'N/D' : v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})
type Row = {cnpj:string;cliente:string;sem_combate:number;[key:string]:string|number}
type Data = {disponivel:boolean;mes:string;atualizado_em:string|null;mensagem:string;resumo?:Record<string,number|null>;clientes?:Row[];paginacao?:{total:number;limite:number;pagina:number}}
const currentMonth = () => { const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(new Date()); return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}` }
export default function SkuPdv({ refresh }: { refresh: number }) {
  const [filters,setFilters] = useState(() => { try { return {...{mes:currentMonth(),busca:'',situacao:'todos',ordem:'sem_combate',direcao:'asc'},...JSON.parse(sessionStorage.getItem('sku-pdv-filtros') || '{}')} } catch { return {mes:currentMonth(),busca:'',situacao:'todos',ordem:'sem_combate',direcao:'asc'} } })
  const [page,setPage]=useState(1),[retry,setRetry]=useState(0),[data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const update = (key:string,value:string) => { setFilters((f:typeof filters)=>({...f,[key]:value}));setPage(1) }
  const params = new URLSearchParams({...filters,pagina:String(page)})
  useEffect(()=>{
    try { sessionStorage.setItem('sku-pdv-filtros',JSON.stringify(filters)) } catch { /* Storage is optional. */ }
    const controller=new AbortController(); setLoading(true);setError('');setData(null)
    const timer=setTimeout(()=>fetch(`/api/sku-pdv?${new URLSearchParams({...filters,pagina:String(page)})}`,{cache:'no-store',signal:controller.signal}).then(async r=>{const b=await r.json();if(!r.ok)throw new Error(b.erro);return b}).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)}),250)
    return ()=>{clearTimeout(timer);controller.abort()}
  },[filters,page,retry,refresh])
  useEffect(()=>{ const timer=window.setInterval(()=>{ if(document.visibilityState==='visible')setRetry(v=>v+1) },300000); const focus=()=>setRetry(v=>v+1); window.addEventListener('focus',focus);return ()=>{clearInterval(timer);window.removeEventListener('focus',focus)} },[])
  const s=data?.resumo
  return <section className="sku-pdv" aria-label="SKU por ponto de venda"><header><h2>SKU/PDV — Produtividade de Mix por Cliente</h2><p>Vendas exclusivamente do mês selecionado ÷ todos os CNPJs da carteira pessoal atual.</p></header>
    <div className="sku-filters"><label>Mês analisado<input type="month" value={filters.mes} onChange={e=>update('mes',e.target.value)}/></label><button type="button" className="secondary-button" onClick={()=>setRetry(v=>v+1)}>Atualizar SKU/PDV</button></div>
    {loading && <p role="status">Consultando produtividade mensal…</p>}{error && <p role="alert">{error}</p>}
    {data && <><p>Última extração válida: {data.atualizado_em ? new Date(/Z$|[+-]\d\d:\d\d$/.test(data.atualizado_em)?data.atualizado_em:`${data.atualizado_em}Z`).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : 'Não disponível'}</p>
      {!data.disponivel ? <p role="status">{data.mensagem}</p> : <>
      <div className="sku-cards">{labels.map(([key,label])=><article key={key} className={key==='sem_combate'?'sku-pdv-main':''}><div className="sku-pdv-card"><h3>SKU/PDV {label}</h3><strong>{decimal(s?.[key])}</strong><span>SKUs por cliente · Carteira: {s?.carteira || 0} PDVs</span></div></article>)}
      <article><div className="sku-pdv-card"><h3>Cobertura da Carteira</h3><strong>{decimal(s?.cobertura)}%</strong><span>Carteira: {s?.carteira || 0} CNPJs</span><span>Compradores Sem Combate: {s?.compradores || 0}</span><span>Sem compra Sem Combate: {s?.zerados || 0}</span></div></article></div>
      <p><b>SKU/PDV Compradores — Sem Combate: {decimal(s?.compradores_media)}</b> · Indicador secundário, calculado somente entre compradores.</p>
      <h3>Detalhamento SKU/PDV por Cliente</h3><p className="sku-note">Análise complementar: zerados, abaixo da média e iguais ou acima da média oficial. Ordene Sem Combate em ordem crescente para identificar oportunidades.</p>
      <div className="sku-filters"><label>Nome ou CNPJ<input type="search" value={filters.busca} onChange={e=>update('busca',e.target.value)}/></label>
        <label>Situação / oportunidade<select value={filters.situacao} onChange={e=>update('situacao',e.target.value)}><option value="todos">Todos os clientes</option><option value="zerados">Zerados em Sem Combate</option><option value="compradores">Com compra Sem Combate</option><option value="abaixo">Compradores abaixo da média</option><option value="acima">Compradores iguais ou acima da média</option></select></label>
        <label>Ordenar por<select value={filters.ordem} onChange={e=>update('ordem',e.target.value)}><option value="cliente">Cliente</option><option value="cnpj">CNPJ</option>{labels.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label>Direção<select value={filters.direcao} onChange={e=>update('direcao',e.target.value)}><option value="asc">Crescente (oportunidade)</option><option value="desc">Decrescente</option></select></label>
        <button type="button" className="secondary-button" onClick={()=>{setFilters({...filters,busca:'',situacao:'todos',ordem:'sem_combate',direcao:'asc'});setPage(1)}}>Limpar filtros</button>
        <a className="secondary-button" href={`/api/sku-pdv?${params}&excel=1`}>Exportar Excel</a></div>
      <p>{data.paginacao?.total || 0} clientes encontrados / {s?.carteira || 0} CNPJs da carteira · {filters.mes}</p>
      <div className="sku-scroll" tabIndex={0} role="region" aria-label="Resultados mensais por cliente"><table><thead><tr><th>CNPJ</th><th>Cliente</th>{[...labels.slice(1,4),labels[0],labels[4]].map(([key,label])=><th key={key}><button type="button" onClick={()=>{setFilters({...filters,ordem:key,direcao:filters.ordem===key&&filters.direcao==='asc'?'desc':'asc'});setPage(1)}}>{label}</button></th>)}<th>Situação</th></tr></thead><tbody>
        {data.clientes?.map(c=><tr key={c.cnpj} className={c.sem_combate===0?'sku-pdv-zero':''}><td>{c.cnpj}</td><th scope="row">{c.cliente}</th>{['prioritarios','lancamentos','linha','sem_combate','total'].map(k=><td key={k}>{c[k]}</td>)}<td>{c.sem_combate>0?'Com compra':'Zerado'}</td></tr>)}
        {!data.clientes?.length && <tr><td colSpan={8}>Nenhum cliente encontrado.</td></tr>}</tbody></table></div>
      <div className="sku-filters"><button type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page} de {Math.max(1,Math.ceil((data.paginacao?.total || 0)/25))}</span><button type="button" disabled={page*25>=(data.paginacao?.total || 0)} onClick={()=>setPage(p=>p+1)}>Próxima</button></div><p className="sku-note">{data.mensagem}</p></>}
    </>}
  </section>
}
