import { useEffect, useState } from 'react'
import './clients.css'

type Cliente={id:string;cnpj:string;nome:string;cidade:string;uf:string;gd:string;consultor:string;faturamento_atual:number;faturamento_anterior:number;variacao_percentual:number;ultima_compra:string|null;dias_sem_comprar:number|null;produtos_prioritarios:number;produtos_lancamentos:number;prioridade:string;motivo_prioridade:string}
type Dados={periodo:{rotulo:string};resumo:{clientes_sem_venda:number;faturamento_total:number;prioridades:Record<string,number>};clientes:Cliente[];filtros:{consultores:Array<{id:string;nome:string}>;ufs:string[]}}
const dinheiro=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
const numero=new Intl.NumberFormat('pt-BR')

function acao(item:Cliente){
 if(item.faturamento_atual<=0&&item.faturamento_anterior>0)return'Recuperar o volume comprado no período anterior.'
 if(item.faturamento_atual<=0)return'Priorizar contato para positivar o cliente.'
 if(item.produtos_prioritarios<=0&&item.produtos_lancamentos<=0)return'Apresentar prioritários e lançamentos ausentes.'
 if(item.produtos_prioritarios<=0)return'Trabalhar inclusão de produtos prioritários.'
 if(item.produtos_lancamentos<=0)return'Apresentar lançamentos ainda não comprados.'
 return'Investigar a queda e ampliar o mix.'
}
function rotulo(valor:string){return valor==='CRITICA'?'Crítica':valor==='ALTA'?'Alta':valor==='MEDIA'?'Média':valor==='NOVO'?'Novo':'Baixa'}

export default function OpportunitiesModule({onBack}:{onBack:()=>void}){
 const [dados,setDados]=useState<Dados|null>(null)
 const [consultor,setConsultor]=useState('')
 const [uf,setUf]=useState('')
 const [prioridade,setPrioridade]=useState('')
 const [carregando,setCarregando]=useState(true)
 const [erro,setErro]=useState('')
 useEffect(()=>{const controle=new AbortController();setCarregando(true);const parametros=new URLSearchParams({periodo:'mes-atual',limite:'500',ordenar:'prioridade'});if(consultor)parametros.set('consultor',consultor);if(uf)parametros.set('uf',uf);if(prioridade)parametros.set('prioridade',prioridade);fetch(`/api/clientes?${parametros}`,{cache:'no-store',signal:controle.signal}).then(async resposta=>{const resultado=await resposta.json();if(!resposta.ok)throw new Error(resultado.detalhe||resultado.erro||'Falha ao carregar oportunidades.');setDados(resultado);setErro('')}).catch(motivo=>{if(motivo.name!=='AbortError')setErro(String(motivo.message||motivo))}).finally(()=>setCarregando(false));return()=>controle.abort()},[consultor,uf,prioridade])
 const oportunidades=(dados?.clientes||[]).filter(item=>item.prioridade!=='BAIXA')
 const urgentes=(dados?.resumo.prioridades?.CRITICA||0)+(dados?.resumo.prioridades?.ALTA||0)
 return <main className="content clients-page">
  <button className="back-button" type="button" onClick={onBack}>← Voltar ao painel</button>
  <section className="clients-hero"><div><span className="eyebrow">Ação comercial</span><h1>Oportunidades</h1><p>Clientes organizados por falta de compra, queda e ausência de mix.</p></div><span className="clients-period">{dados?.periodo.rotulo||'Mês atual'}</span></section>
  <section className="filters clients-filters"><label><span>Consultor</span><select value={consultor} onChange={evento=>setConsultor(evento.target.value)}><option value="">Todos</option>{(dados?.filtros.consultores||[]).map(item=><option value={item.id} key={item.id}>{item.nome}</option>)}</select></label><label><span>UF</span><select value={uf} onChange={evento=>setUf(evento.target.value)}><option value="">Todas</option>{(dados?.filtros.ufs||[]).map(item=><option value={item} key={item}>{item}</option>)}</select></label><label><span>Prioridade</span><select value={prioridade} onChange={evento=>setPrioridade(evento.target.value)}><option value="">Todas as oportunidades</option><option value="CRITICA">Crítica</option><option value="ALTA">Alta</option><option value="MEDIA">Média</option><option value="NOVO">Novo</option></select></label></section>
  {erro&&<div className="alert alert-error">{erro}</div>}
  <section className="clients-summary"><article><span>Urgentes</span><strong>{carregando?'—':numero.format(urgentes)}</strong><small>Crítica e alta</small></article><article><span>Sem venda</span><strong>{carregando?'—':numero.format(dados?.resumo.clientes_sem_venda||0)}</strong></article><article><span>Em atenção</span><strong>{carregando?'—':numero.format(dados?.resumo.prioridades?.MEDIA||0)}</strong></article><article><span>Faturamento da carteira</span><strong>{carregando?'—':dinheiro.format(dados?.resumo.faturamento_total||0)}</strong></article></section>
  <section className="clients-list-card"><div className="clients-list-heading"><div><span className="eyebrow">Plano de ação</span><h2>Prioridades comerciais</h2></div><span>{numero.format(oportunidades.length)} oportunidades</span></div><div className="clients-table-wrap"><table className="clients-table"><thead><tr><th>Prioridade</th><th>Cliente</th><th>Responsável</th><th>Resultado</th><th>Motivo</th><th>Ação</th></tr></thead><tbody>{carregando&&<tr><td colSpan={6} className="clients-empty">Carregando…</td></tr>}{!carregando&&oportunidades.map(item=><tr key={item.id}><td><span className={`priority-pill priority-${item.prioridade.toLowerCase()}`}>{rotulo(item.prioridade)}</span></td><td><strong>{item.nome}</strong><small>{item.cnpj} · {item.cidade}/{item.uf}</small></td><td><strong>{item.consultor||'Sem consultor'}</strong><small>{item.gd||'GD não informado'}</small></td><td><strong>{dinheiro.format(item.faturamento_atual)}</strong><small>Anterior: {dinheiro.format(item.faturamento_anterior)}</small></td><td><strong>{item.motivo_prioridade}</strong><small>{item.dias_sem_comprar===null?'Sem histórico':`${item.dias_sem_comprar} dias sem comprar`}</small></td><td><strong>{acao(item)}</strong><small>{item.produtos_prioritarios} prioritários · {item.produtos_lancamentos} lançamentos</small></td></tr>)}{!carregando&&!oportunidades.length&&<tr><td colSpan={6} className="clients-empty">Nenhuma oportunidade encontrada.</td></tr>}</tbody></table></div></section>
 </main>
}
