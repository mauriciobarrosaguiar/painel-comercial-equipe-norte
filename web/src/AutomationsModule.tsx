import {useEffect,useState} from'react'
import'./clients.css'
type Item={id:string;tipo:string;status:string;total_registros:number;mensagem:string;erro:string;iniciado_em:string|null;finalizado_em:string|null;criado_em:string|null}
type Dados={em_execucao:number;recentes:Item[];atualizado_em:string}
const n=new Intl.NumberFormat('pt-BR')
const data=(v:string|null)=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('pt-BR')}
export default function AutomationsModule({onBack}:{onBack:()=>void}){
 const[dados,setDados]=useState<Dados|null>(null),[erro,setErro]=useState(''),[loading,setLoading]=useState(true)
 const carregar=()=>{setLoading(true);fetch('/api/automacoes',{cache:'no-store'}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.detalhe||j.erro);setDados(j);setErro('')}).catch(e=>setErro(String(e.message||e))).finally(()=>setLoading(false))}
 useEffect(carregar,[])
 return <main className="content clients-page"><button className="back-button" onClick={onBack}>← Voltar ao painel</button><section className="clients-hero"><div><span className="eyebrow">Processos</span><h1>Central de Automações</h1><p>Status das extrações e importações.</p></div><button className="outline-button" onClick={carregar}>Atualizar</button></section>{erro&&<div className="alert alert-error">{erro}</div>}<section className="clients-summary"><article><span>Em execução</span><strong>{loading?'—':n.format(dados?.em_execucao||0)}</strong></article><article><span>Execuções</span><strong>{n.format(dados?.recentes.length||0)}</strong></article><article><span>Última consulta</span><strong>{data(dados?.atualizado_em||null)}</strong></article></section><section className="clients-list-card"><div className="clients-list-heading"><h2>Execuções recentes</h2></div><div className="clients-table-wrap"><table className="clients-table"><thead><tr><th>Automação</th><th>Status</th><th>Registros</th><th>Início</th><th>Fim</th><th>Mensagem</th></tr></thead><tbody>{loading&&<tr><td colSpan={6}>Carregando…</td></tr>}{!loading&&(dados?.recentes||[]).map(i=><tr key={i.id}><td><strong>{i.tipo.replaceAll('_',' ')}</strong></td><td>{i.status}</td><td>{n.format(i.total_registros)}</td><td>{data(i.iniciado_em||i.criado_em)}</td><td>{data(i.finalizado_em)}</td><td>{i.mensagem||i.erro||'—'}</td></tr>)}</tbody></table></div></section></main>
}
