import { useEffect, useMemo, useState } from 'react'
import './desafio-gigantes-history.css'

type ProductResult={
  sku:string;ean:string;produto:string;meta_positivacao:number;meta_giro:number
  positivacao_real:number;giro_real:number;unidades:number
  atingimento_positivacao:number;atingimento_giro:number
  pontos_positivacao:number;pontos_giro:number;pontos_estimados:number
}
type Snapshot={
  tipo?:string
  ano_mes?:string
  escopo?:string
  referencia_id?:string
  referencia_nome?:string
  regras?:Record<string,number>
  resumo?:{
    skus?:number
    identificados?:number
    pos_80?:number
    giro_bruto_100?:number
    giro_bruto_120?:number
    giro_100?:number
    pontuacao_estimada?:number
    maximo_estimado?:number
  }
  produtos_meta?:Array<{sku:string;ean:string;produto:string;meta_positivacao:number;meta_giro:number;status_identificacao:string}>
  produtos_resultado?:ProductResult[]
  fechado_em?:string
}
type Item={id:string;ano_mes:string;escopo:string;referencia_id:string;referencia_nome:string;fechado_em:string;snapshot:Snapshot}
type Data={itens:Item[];imutavel?:boolean;erro?:string;detalhe?:string}
const num=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1})
const pct=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})
const dateLabel=(v:string)=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(d)}

export default function DesafioGigantesHistory({anoMes}:{anoMes:string}){
  const[data,setData]=useState<Data>({itens:[]}),[loading,setLoading]=useState(false),[error,setError]=useState('')
  useEffect(()=>{
    if(!anoMes){setData({itens:[]});return}
    const controller=new AbortController();setLoading(true);setError('')
    fetch(`/api/desafio-gigantes-historico?ano_mes=${encodeURIComponent(anoMes)}`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.detalhe||body.erro||'Falha ao carregar histórico do Desafio');setData(body)})
      .catch(e=>{if(!(e instanceof DOMException&&e.name==='AbortError'))setError(e instanceof Error?e.message:String(e))})
      .finally(()=>setLoading(false))
    return()=>controller.abort()
  },[anoMes])
  const manager=useMemo(()=>data.itens.find(item=>item.escopo==='gerente'),[data.itens])
  const consultants=useMemo(()=>data.itens.filter(item=>item.escopo==='consultor'),[data.itens])
  if(!anoMes||(!loading&&!error&&!data.itens.length))return null

  const products=(item:Item)=>{
    const final=item.snapshot?.produtos_resultado||[]
    if(final.length)return final.map(p=><div key={`${item.id}-${p.sku}`}><strong>{p.produto}</strong><small>SAP {p.sku} · EAN {p.ean||'não identificado'}</small><small>Positivação: {num.format(p.positivacao_real)}/{num.format(p.meta_positivacao)} PDVs · {pct.format(p.atingimento_positivacao)}% · {num.format(p.pontos_positivacao)} pts</small><small>Giro: {num.format(p.giro_real)}/{num.format(p.meta_giro)} un./PDV · {pct.format(p.atingimento_giro)}% · {num.format(p.pontos_giro)} pts · Total {num.format(p.pontos_estimados)} pts</small></div>)
    return (item.snapshot?.produtos_meta||[]).map(p=><div key={`${item.id}-${p.sku}`}><strong>{p.produto}</strong><small>SAP {p.sku} · EAN {p.ean||'não identificado'} · Meta Pos. {num.format(p.meta_positivacao)} · Meta Giro {num.format(p.meta_giro)}</small></div>)
  }
  const card=(item:Item)=>{const r=item.snapshot?.resumo||{},max=Number(r.maximo_estimado||0),score=Number(r.pontuacao_estimada||0),reach=max>0?score/max*100:0;return <article className="dgh-card" key={item.id}><div><span>{item.escopo==='gerente'?'GD / Gerente':'Consultor'}</span><strong>{item.referencia_nome}</strong></div><b>{num.format(score)} pts</b><small>{pct.format(reach)}% do máximo · fechado em {dateLabel(item.fechado_em)}</small><div className="dgh-stats"><span>SKUs <b>{Number(r.skus||0)}</b></span><span>Pos. ≥80% <b>{Number(r.pos_80||0)}</b></span><span>Giro ≥100% <b>{Number(r.giro_bruto_100||0)}</b></span><span>Giro pontuando <b>{Number(r.giro_100||0)}</b></span></div><details><summary>Resultado final por produto</summary><div className="dgh-products">{products(item)}</div></details></article>}
  return <section className="dgh-history"><div className="operations-heading"><div><span className="eyebrow">Campanha mensal congelada</span><h2>🏆 Desafio de Gigantes</h2><p>O fechamento deste mês é permanente. Produtos, metas, regras e resultados dos meses seguintes não alteram esta fotografia.</p></div><span>{data.itens.length} fechamento(s)</span></div>{error&&<div className="alert alert-error">{error}</div>}{loading?<div className="operations-empty">Carregando fechamento do Desafio…</div>:<><div className="dgh-manager">{manager&&card(manager)}</div><div className="dgh-grid">{consultants.map(card)}</div></>}</section>
}
