const HEADERS={'content-type':'application/json; charset=UTF-8','cache-control':'no-store,no-cache,must-revalidate'}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS})
const texto=v=>String(v??'').trim()

export async function onRequestGet({request,env}){
 try{
  const p=new URL(request.url).searchParams,uf=texto(p.get('uf')).toUpperCase().slice(0,2),distribuidora=texto(p.get('distribuidora')).slice(0,120),busca=texto(p.get('busca')).slice(0,160),comEstoque=p.get('estoque')==='1',limite=Math.min(1000,Math.max(20,Number(p.get('limite')||300)))
  const cond=['1=1'],binds=[]
  if(uf){cond.push('UPPER(TRIM(uf))=?');binds.push(uf)}
  if(distribuidora){cond.push('distribuidora=?');binds.push(distribuidora)}
  if(busca){cond.push('(UPPER(COALESCE(produto,\'\')) LIKE UPPER(?) OR COALESCE(ean,\'\') LIKE ?)');binds.push(`%${busca}%`,`%${busca.replace(/\D/g,'')}%`)}
  if(comEstoque)cond.push('COALESCE(estoque,0)>0')
  const where=cond.join(' AND ')
  const [resumo,linhas,ufs,dists,extracao]=await env.DB.batch([
   env.DB.prepare(`SELECT COUNT(*) registros,COUNT(DISTINCT ean) produtos,COUNT(DISTINCT uf) ufs,COUNT(DISTINCT distribuidora) distribuidoras,MAX(atualizado_em) atualizado_em,COALESCE(SUM(CASE WHEN estoque>0 THEN 1 ELSE 0 END),0) com_estoque FROM mercado_farma_precos WHERE ${where}`).bind(...binds),
   env.DB.prepare(`SELECT uf,ean,produto,distribuidora,estoque,desconto,pf_distribuidora,pf_fabrica,preco_com_imposto,preco_sem_imposto,status,erro,atualizado_em,MIN(CASE WHEN estoque>0 THEN preco_sem_imposto END) OVER(PARTITION BY uf,ean) melhor_preco FROM mercado_farma_precos WHERE ${where} ORDER BY produto COLLATE NOCASE,uf,preco_sem_imposto LIMIT ?`).bind(...binds,limite),
   env.DB.prepare("SELECT DISTINCT UPPER(TRIM(uf)) uf FROM mercado_farma_precos WHERE TRIM(COALESCE(uf,''))<>'' ORDER BY uf"),
   env.DB.prepare("SELECT DISTINCT distribuidora FROM mercado_farma_precos WHERE TRIM(COALESCE(distribuidora,''))<>'' ORDER BY distribuidora COLLATE NOCASE"),
   env.DB.prepare("SELECT status,total_registros,mensagem,erro,iniciado_em,finalizado_em,criado_em FROM extracoes WHERE tipo='MERCADO_FARMA' ORDER BY criado_em DESC LIMIT 1")
  ])
  const r=resumo.results?.[0]||{}
  return json({resumo:{registros:Number(r.registros||0),produtos:Number(r.produtos||0),ufs:Number(r.ufs||0),distribuidoras:Number(r.distribuidoras||0),com_estoque:Number(r.com_estoque||0),atualizado_em:r.atualizado_em||null},resultados:(linhas.results||[]).map(x=>({...x,estoque:Number(x.estoque||0),desconto:Number(x.desconto||0),pf_distribuidora:Number(x.pf_distribuidora||0),pf_fabrica:Number(x.pf_fabrica||0),preco_com_imposto:Number(x.preco_com_imposto||0),preco_sem_imposto:Number(x.preco_sem_imposto||0),melhor_preco:x.melhor_preco===null?null:Number(x.melhor_preco)})),filtros:{ufs:(ufs.results||[]).map(x=>String(x.uf||'')).filter(Boolean),distribuidoras:(dists.results||[]).map(x=>String(x.distribuidora||'')).filter(Boolean)},ultima_extracao:extracao.results?.[0]||null})
 }catch(error){return json({erro:'Não foi possível carregar o Mercado Farma.',detalhe:error instanceof Error?error.message:String(error)},500)}
}
