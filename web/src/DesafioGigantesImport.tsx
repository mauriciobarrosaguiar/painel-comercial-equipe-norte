import { ChangeEvent, useEffect, useState } from 'react'
import readWorkbook from 'read-excel-file/browser'

type Row = Record<string, unknown>
type Status = { metas:number; produtos:number; identificados:number; pendentes:number; ambiguos:number; nao_encontrados:number; erros:number; ano_mes:string }
const EMPTY: Status = { metas:0, produtos:0, identificados:0, pendentes:0, ambiguos:0, nao_encontrados:0, erros:0, ano_mes:'' }
const slug=(v:unknown)=>String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')
const mesAtual=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}

function cabecalho(matrix:unknown[][], gd=false){
  for(let i=0;i<Math.min(matrix.length,20);i+=1){
    const k=new Set((matrix[i]||[]).map(slug))
    const setor=gd?['setor_g_distrital','setor_gd','setor']:['setor_consultor','setor']
    const nome=gd?['nome_g_distrital','nome_gd','nome']:['nome_consultor','consultor','nome']
    if(setor.some(x=>k.has(x))&&nome.some(x=>k.has(x))&&k.has('sap')&&k.has('produto')&&k.has('meta_positivacao')&&k.has('meta_giro')) return i
  }
  return -1
}
function lerAba(matrix:unknown[][],gd=false):Row[]{
  const h=cabecalho(matrix,gd)
  if(h<0) throw new Error(`Cabeçalhos não encontrados na aba ${gd?'G.DISTRITAL':'CONSULTOR'}.`)
  const headers=(matrix[h]||[]).map(slug)
  return matrix.slice(h+1).map(values=>{
    const r:Row={};headers.forEach((key,col)=>{if(key)r[key]=values?.[col]??''})
    return {escopo:gd?'gerente':'consultor',setor:r.setor_consultor??r.setor_g_distrital??r.setor_gd??r.setor??'',nome_colaborador:r.nome_consultor??r.nome_g_distrital??r.nome_gd??r.nome??'',sap:r.sap??'',produto:r.produto??'',meta_positivacao:r.meta_positivacao??0,meta_giro:r.meta_giro??0}
  }).filter(r=>String(r.nome_colaborador??'').trim()&&String(r.sap??'').trim())
}
async function lerArquivo(file:File){
  if(file.size>20*1024*1024) throw new Error('O arquivo excede 20 MB.')
  if(!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Use o arquivo oficial .xlsx.')
  const wb=await readWorkbook(file);const nomes=wb.map(({sheet})=>sheet)
  const consultar=nomes.find(n=>slug(n)==='consultor')||''
  const gd=nomes.find(n=>['g_distrital','gdistrital'].includes(slug(n)))||''
  if(!consultar||!gd) throw new Error('O arquivo precisa conter as abas CONSULTOR e G.DISTRITAL.')
  const matriz=(n:string):unknown[][]=>wb.find(({sheet})=>sheet===n)?.data||[]
  return [...lerAba(matriz(consultar)),...lerAba(matriz(gd),true)]
}

export default function DesafioGigantesImport(){
  const [mes,setMes]=useState(mesAtual());const [status,setStatus]=useState<Status>(EMPTY)
  const [carregando,setCarregando]=useState(false);const [mensagem,setMensagem]=useState('');const [erro,setErro]=useState('')
  async function atualizar(){
    const res=await fetch('/api/admin/bases',{cache:'no-store'});const data=await res.json() as {desafio_gigantes?:Status;erro?:string}
    if(!res.ok) throw new Error(data.erro||'Não foi possível consultar a campanha.');setStatus(data.desafio_gigantes||EMPTY)
  }
  useEffect(()=>{void atualizar().catch(()=>{})},[])
  async function importar(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value='';if(!file)return
    setCarregando(true);setErro('');setMensagem('')
    try{
      const rows=await lerArquivo(file)
      const res=await fetch('/api/admin/bases',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({tipo:'desafio_gigantes',rows,nome_arquivo:file.name,ano_mes:mes})})
      const data=await res.json() as {erro?:string;total?:number;consultores?:number;gerentes?:number;ignoradas?:number;skus?:number;bases?:{desafio_gigantes?:Status}}
      if(!res.ok) throw new Error(data.erro||'A importação não foi concluída.')
      if(data.bases?.desafio_gigantes)setStatus(data.bases.desafio_gigantes)
      setMensagem(`${data.gerentes||0} GD, ${data.consultores||0} consultores, ${Number(data.total||0).toLocaleString('pt-BR')} metas e ${data.skus||0} SAPs únicos. ${Number(data.ignoradas||0).toLocaleString('pt-BR')} linhas de outros territórios ignoradas.`)
    }catch(reason){setErro(reason instanceof Error?reason.message:String(reason))}finally{setCarregando(false)}
  }
  const pronto=status.metas>0
  return <section className="bases-section">
    <div className="bases-heading"><div><span className="eyebrow">Campanha</span><h2>Desafio de Gigantes</h2><p>Importe o arquivo oficial. O painel usa somente consultores e GD do território e ignora G.REGIONAL.</p></div><button className="outline-button" type="button" onClick={()=>void atualizar()}>Atualizar situação</button></div>
    <div className="base-cards"><article className="base-card">
      <div className="base-card-top"><div><h3>Metas — Desafio de Gigantes</h3><p>SAP, produto, meta de positivação e meta de giro são associados ao setor do painel.</p></div><span className={pronto?'base-count ready':'base-count missing'}>{pronto?`${status.metas.toLocaleString('pt-BR')} metas`:'Base ausente'}</span></div>
      <small><strong>Abas usadas:</strong> CONSULTOR e G.DISTRITAL. G.REGIONAL é ignorada.</small>
      <label className="month-field"><span>Mês das metas</span><input type="month" value={mes} onChange={e=>setMes(e.target.value)}/></label>
      {pronto&&<div className="integration-status-grid"><div><span>Produtos SAP</span><strong>{status.produtos}</strong></div><div><span>Identificados</span><strong>{status.identificados}</strong></div><div><span>Pendentes</span><strong>{status.pendentes}</strong></div><div><span>Revisar</span><strong>{status.ambiguos+status.nao_encontrados+status.erros}</strong></div></div>}
      {erro&&<div className="alert alert-error">{erro}</div>}{mensagem&&<div className="alert alert-success">{mensagem}</div>}
      <label className={`file-button ${carregando?'disabled':''}`}><input type="file" accept=".xlsx" disabled={carregando} onChange={e=>void importar(e)}/>{carregando?'Lendo CONSULTOR e G.DISTRITAL…':pronto?'Substituir planilha de metas':'Selecionar planilha de metas'}</label>
    </article></div>
  </section>
}
