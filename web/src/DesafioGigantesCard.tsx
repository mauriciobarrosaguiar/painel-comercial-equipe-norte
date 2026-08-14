import { useEffect, useMemo, useState } from 'react'
import './desafio-gigantes-card.css'

type Produto = {
  sku:string; produto:string; ean:string; meta_positivacao:number; meta_giro:number;
  positivacao_real:number; giro_real:number; unidades:number;
  atingimento_positivacao:number; atingimento_giro:number;
  atingimento_positivacao_considerado:number; atingimento_giro_considerado:number;
  pontos_positivacao:number; pontos_giro:number; pontos_estimados:number;
  alvo_positivacao_80:number; falta_pdv_80:number; sku_destravado:boolean; giro_pontuando:boolean;
}
type Resumo = {
  ano_mes:string; colaborador:string; metas:number; skus:number; identificados:number; pos_80:number; giro_100:number; giro_80?:number;
  pontuacao_estimada:number; maximo_estimado:number;
  regras?:{gatilho_positivacao:number;gatilho_giro:number;teto_percentual:number;pontos_maximos_por_sku:number};
  identificacao?:{total:number;identificados:number;pendentes:number;ambiguos:number;nao_encontrados:number;erros:number};
  oportunidades:Produto[]; aviso?:string; erro?:string; detalhe?:string;
}
type Props = { inicio:string; consultor:string; uf:string }
const vazio:Resumo={ano_mes:'',colaborador:'',metas:0,skus:0,identificados:0,pos_80:0,giro_100:0,pontuacao_estimada:0,maximo_estimado:0,oportunidades:[]}
const pct=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})
const num=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1})
const giroNum=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:2})
const mes=(v:string)=>/^\d{4}-\d{2}$/.test(v)?`${v.slice(5,7)}/${v.slice(0,4)}`:v

export default function DesafioGigantesCard({inicio,consultor,uf}:Props){
  const [data,setData]=useState<Resumo>(vazio),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const anoMes=useMemo(()=>/^\d{4}-\d{2}/.test(inicio||'')?inicio.slice(0,7):'', [inicio])
  useEffect(()=>{const c=new AbortController();setLoading(true);setError('');const p=new URLSearchParams();if(anoMes)p.set('ano_mes',anoMes);if(consultor)p.set('consultor',consultor);if(uf)p.set('uf',uf);fetch(`/api/desafio-gigantes?${p}`,{cache:'no-store',signal:c.signal}).then(async r=>{const b=await r.json() as Resumo;if(!r.ok)throw new Error(b.detalhe||b.erro||'Falha ao carregar campanha');setData(b)}).catch(e=>{if(!(e instanceof DOMException&&e.name==='AbortError'))setError(e instanceof Error?e.message:String(e))}).finally(()=>setLoading(false));return()=>c.abort()},[anoMes,consultor,uf])
  const pend=(data.identificacao?.pendentes||0)+(data.identificacao?.ambiguos||0)+(data.identificacao?.nao_encontrados||0)+(data.identificacao?.erros||0)
  const foco=data.oportunidades?.[0]
  const alcance=data.maximo_estimado>0?data.pontuacao_estimada/data.maximo_estimado*100:0
  const posPct=data.skus?data.pos_80/data.skus*100:0
  const giro100=data.giro_100 ?? data.giro_80 ?? 0
  const giroPct=data.skus?giro100/data.skus*100:0
  const teto=data.regras?.teto_percentual||120
  const maxSku=data.regras?.pontos_maximos_por_sku||240
  return <section className="dg-card"><div className="dg-heading"><div><span>🏆 CAMPANHA</span><h2>Desafio de Gigantes</h2><p>{data.colaborador||'Equipe Norte'} · {mes(data.ano_mes||anoMes)} · parcial gerencial</p></div><b>CDD / Close-Up oficial</b></div>{error&&<div className="dg-alert">{error}</div>}{loading?<div className="dg-loading">Atualizando campanha…</div>:data.metas===0?<div className="dg-empty"><strong>Card ativo</strong><span>Não há metas para este período. Importe a planilha na Administração.</span></div>:<><div className="dg-metrics"><div className="score"><span>Pontuação parcial estimada</span><strong>{num.format(data.pontuacao_estimada)}</strong><small>{pct.format(alcance)}% do teto gerencial · máximo {num.format(data.maximo_estimado)} pts</small></div><div><span>SKUs monitorados</span><strong>{data.skus}</strong><small>{data.identificados}/{data.skus} ligados ao EAN</small></div><div><span>Positivação: SKUs ≥80%</span><strong>{data.pos_80}/{data.skus}</strong><small>{pct.format(posPct)}% dos SKUs destravaram o SKU</small></div><div><span>Giro pontuando</span><strong>{giro100}/{data.skus}</strong><small>{pct.format(giroPct)}% com Pos. ≥80% e Giro ≥100%</small></div><div><span>Identificação SAP → EAN</span><strong>{pend?`${pend} pend.`:'OK'}</strong><small>{data.identificacao?.identificados||0}/{data.identificacao?.total||data.skus} SAPs identificados</small></div></div><div className="dg-rule-legend"><b>Regras usadas no cálculo:</b><span>Positivação: abaixo de 80% = 0 ponto; de 80% a 120% = percentual em pontos</span><span>Giro: só entra depois de Positivação ≥80%; abaixo de 100% = 0 ponto</span><span>Giro entre 100% e 120% = percentual em pontos; acima de {teto}% continua valendo no máximo {teto} pontos</span><span>Cada SKU vale no máximo {maxSku} pontos: 120 Positivação + 120 Giro</span><span>Vendas consideradas: somente quantidade faturada dos PDVs da carteira do painel</span></div><div className="dg-action"><div><span>Mais perto de destravar pontos</span>{foco?<><strong>{foco.produto}</strong><small>SAP {foco.sku} · faltam {foco.falta_pdv_80} PDV(s) para atingir 80% da meta de positivação e destravar o SKU.</small></>:<><strong>Manter acompanhamento</strong><small>Sem SKU identificado abaixo de 80% neste recorte.</small></>}</div>{foco&&<div className="dg-action-progress"><b>{foco.positivacao_real}/{foco.alvo_positivacao_80} PDVs</b><span>{pct.format(foco.atingimento_positivacao)}% da meta total</span></div>}</div>{data.oportunidades?.length>0&&<details className="dg-details"><summary>Ver produtos mais perto de destravar pontos</summary><div className="dg-table"><table><thead><tr><th>SAP</th><th>Produto</th><th>Faltam p/80%</th><th>Positivação</th><th>Giro</th><th>Pontos</th></tr></thead><tbody>{data.oportunidades.map(i=><tr key={`${i.sku}-${i.ean}`}><td data-label="SAP">{i.sku}</td><td data-label="Produto">{i.produto}</td><td data-label="Faltam p/80%"><b>{i.falta_pdv_80} PDV(s)</b></td><td data-label="Positivação">{i.positivacao_real}/{num.format(i.meta_positivacao)} · real {pct.format(i.atingimento_positivacao)}% · considerado {pct.format(i.atingimento_positivacao_considerado||0)}%</td><td data-label="Giro">Atual {giroNum.format(i.giro_real)} un./PDV · Meta {giroNum.format(i.meta_giro)} · real {pct.format(i.atingimento_giro)}% · considerado {pct.format(i.atingimento_giro_considerado||0)}%</td><td data-label="Pontos">Pos. {num.format(i.pontos_positivacao||0)} + Giro {num.format(i.pontos_giro||0)} = <b>{num.format(i.pontos_estimados)}</b></td></tr>)}</tbody></table></div></details>}<p className="dg-note">{data.aviso}</p></>}</section>
}
