import { useEffect, useState } from 'react'
import './sips.css'

type Sip={id:string;nome:string;redes:number;nomes_redes:string;clientes_ativos:number;clientes_com_venda:number;clientes_sem_venda:number;ol_total:number;ol_sem_combate:number;ol_prioritarios:number;ol_lancamentos:number;meta_mes:number;resultado_meta:number}
type Data={periodo:{rotulo:string};sips:Sip[];totais:{sips:number;redes:number;clientes_ativos:number;clientes_com_venda:number;clientes_sem_venda:number;ol_total:number;ol_sem_combate:number}}
const dinheiro=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
const numero=new Intl.NumberFormat('pt-BR')

export default function SipsModule({onBack}:{onBack:()=>void}){
 const [data,setData]=useState<Data|null>(null)
 const [erro,setErro]=useState('')
 useEffect(()=>{const controller=new AbortController();fetch('/api/sips?periodo=mes-atual',{cache:'no-store',signal:controller.signal}).then(async resposta=>{const resultado=await resposta.json();if(!resposta.ok)throw new Error(resultado.detalhe||resultado.erro||'Falha ao carregar');setData(resultado)}).catch(motivo=>{if(motivo.name!=='AbortError')setErro(String(motivo.message||motivo))});return()=>controller.abort()},[])
 return <main className="content sips-page">
  <button className="back-button" type="button" onClick={onBack}>← Voltar ao painel</button>
  <section className="sips-hero"><div><span className="eyebrow">Redes comerciais</span><h1>SIP / Redes</h1><p>Resultados das SIPs e redes cadastradas no painel anterior.</p></div><span>{data?.periodo.rotulo||'Carregando'}</span></section>
  {erro&&<div className="alert alert-error">{erro}</div>}
  <section className="sips-summary"><article><span>SIPs</span><strong>{numero.format(data?.totais.sips||0)}</strong></article><article><span>Redes</span><strong>{numero.format(data?.totais.redes||0)}</strong></article><article><span>Clientes com venda</span><strong>{numero.format(data?.totais.clientes_com_venda||0)}</strong><small>{numero.format(data?.totais.clientes_sem_venda||0)} sem venda</small></article><article><span>OL total</span><strong>{dinheiro.format(data?.totais.ol_total||0)}</strong><small>Sem combate: {dinheiro.format(data?.totais.ol_sem_combate||0)}</small></article></section>
  <section className="sips-list"><div className="sips-heading"><h2>SIPs cadastradas</h2><span>{numero.format(data?.sips.length||0)}</span></div>{!data?.sips.length?<div className="sips-empty">Nenhuma SIP encontrada. Execute a migração das bases anteriores.</div>:data.sips.map(sip=><article className="sip-card" key={sip.id}><div><h3>{sip.nome}</h3><p>{sip.redes} redes · {sip.nomes_redes||'Sem rede informada'}</p></div><div><span>Clientes</span><strong>{sip.clientes_com_venda}/{sip.clientes_ativos}</strong></div><div><span>OL total</span><strong>{dinheiro.format(sip.ol_total)}</strong></div><div><span>Sem combate</span><strong>{dinheiro.format(sip.ol_sem_combate)}</strong></div><div><span>Meta</span><strong>{dinheiro.format(sip.meta_mes)}</strong><small>{sip.resultado_meta.toFixed(1)}%</small></div></article>)}</section>
 </main>
}
