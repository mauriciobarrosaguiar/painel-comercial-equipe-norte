import {useEffect,useState} from 'react'
import './operations.css'

type Command={id:string;tipo:string;status:string;mensagem:string;erro:string;solicitado_em:string;iniciado_em:string|null;finalizado_em:string|null}
type Extraction={id:string;tipo:string;status:string;total_registros:number;mensagem:string;erro:string;iniciado_em:string|null;finalizado_em:string|null;criado_em:string}
type Data={comandos:Command[];extracoes:Extraction[];aviso?:string}
const date=(v:string|null|undefined)=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('pt-BR')}
const label=(v:string)=>v.replaceAll('_',' ').replace(/\b\w/g,(x:string)=>x.toUpperCase())

export default function AutomationsModule({onBack}:{onBack:()=>void}){
 const [key,setKey]=useState(''),[data,setData]=useState<Data>({comandos:[],extracoes:[]}),[loading,setLoading]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[month,setMonth]=useState(new Date().toISOString().slice(0,7))
 async function refresh(){try{const r=await fetch('/api/automacoes',{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.erro||'Falha ao consultar automações');setData(d)}catch(e){setError(e instanceof Error?e.message:String(e))}}
 useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),15000);return()=>window.clearInterval(timer)},[])
 async function queue(tipo:string,parametros:Record<string,unknown>={}){if(key.trim().length<12){setError('Informe a chave administrativa.');return}setLoading(true);setError('');setMessage('');try{const r=await fetch('/api/automacoes',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-admin-key':key},body:JSON.stringify({tipo,parametros,solicitado_por:'Maurício'})}),d=await r.json();if(!r.ok)throw new Error(d.erro||'Falha ao solicitar automação');setMessage(d.mensagem||'Solicitação registrada.');await refresh()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setLoading(false)}}
 const actions=[
  {tipo:'BUSSOLA',title:'Extrair Bússola',text:'Atualiza pedidos, itens e valor faturado no D1.'},
  {tipo:'MERCADO_FARMA',title:'Extrair Mercado Farma',text:'Pesquisa preços e estoques para as UFs cadastradas.'},
  {tipo:'AUDITORIA',title:'Auditar cálculos',text:'Confere CNPJ, EAN, datas, duplicidades e conciliação.'},
  {tipo:'MIGRAR_BASES',title:'Migrar bases legadas',text:'Recupera carteira, metas, produtos e SIPs preservadas.'},
 ]
 return <main className="content operations-page"><button className="back-button" onClick={onBack}>← Voltar ao painel</button><section className="operations-hero"><div><span className="eyebrow">Processos seguros</span><h1>Central de Automações</h1><p>Execute e acompanhe Bússola, Mercado Farma, auditorias, migrações e fechamento mensal.</p></div><span>{data.comandos.filter(x=>['aguardando','executando','despachado'].includes(x.status)).length} em andamento</span></section>
 <section className="automation-key"><label><span>Chave administrativa</span><input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder="Informe para executar"/></label><small>A chave fica apenas nesta página e não é gravada no navegador.</small></section>
 {error&&<div className="alert alert-error">{error}</div>}{message&&<div className="alert alert-success">{message}</div>}{data.aviso&&<div className="alert alert-error">{data.aviso}</div>}
 <section className="automation-actions">{actions.map(a=><article key={a.tipo}><div><h2>{a.title}</h2><p>{a.text}</p></div><button className="primary-action" disabled={loading} onClick={()=>void queue(a.tipo)}>{loading?'Processando…':'Executar agora'}</button></article>)}<article><div><h2>Fechamento mensal</h2><p>Grava uma fotografia permanente de resultados e metas.</p><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div><button className="primary-action" disabled={loading} onClick={()=>void queue('FECHAMENTO_MENSAL',{ano_mes:month})}>Fechar mês</button></article></section>
 <section className="operations-list"><div className="operations-heading"><h2>Solicitações recentes</h2><button className="outline-button" onClick={()=>void refresh()}>Atualizar</button></div>{!data.comandos.length?<div className="operations-empty">Nenhuma solicitação registrada.</div>:data.comandos.map(c=><div className="operation-row" key={c.id}><div><strong>{label(c.tipo)}</strong><span>{c.mensagem||c.erro||'Sem mensagem'}</span></div><div><b className={`operation-status status-${c.status}`}>{c.status}</b><small>{date(c.finalizado_em||c.iniciado_em||c.solicitado_em)}</small></div></div>)}</section>
 <section className="operations-list"><div className="operations-heading"><h2>Últimas extrações</h2></div>{!data.extracoes.length?<div className="operations-empty">Nenhuma extração registrada.</div>:data.extracoes.map(x=><div className="operation-row" key={x.id}><div><strong>{label(x.tipo)}</strong><span>{x.mensagem||x.erro||`${Number(x.total_registros||0).toLocaleString('pt-BR')} registros`}</span></div><div><b className={`operation-status status-${x.status}`}>{x.status}</b><small>{date(x.finalizado_em||x.iniciado_em||x.criado_em)}</small></div></div>)}</section></main>
}
