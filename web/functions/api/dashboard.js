const HEADERS={'content-type':'application/json; charset=UTF-8','cache-control':'no-store'}
const FATURADO="UPPER(COALESCE(pe.status,'')) LIKE '%FATURAD%' AND UPPER(COALESCE(pe.status,'')) NOT LIKE '%CANCEL%'"
const PERIODOS=new Set(['mes-atual','mes-anterior','todo-periodo','personalizado'])
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS})
const stmt=(env,sql,params=[])=>params.length?env.DB.prepare(sql).bind(...params):env.DB.prepare(sql)
const iso=(y,m,d)=>`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
const mostrar=(v)=>v?`${v.slice(8,10)}/${v.slice(5,7)}/${v.slice(0,4)}`:''

function periodo(params){
  const tipo=PERIODOS.has(params.get('periodo'))?params.get('periodo'):'mes-atual'
  if(tipo==='todo-periodo')return{tipo,inicio:null,fim:null}
  const inicio=params.get('inicio')||'',fim=params.get('fim')||''
  if(/^\d{4}-\d{2}-\d{2}$/.test(inicio)&&/^\d{4}-\d{2}-\d{2}$/.test(fim)){
    if(inicio>fim)throw new Error('A data inicial não pode ser posterior à data final.')
    return{tipo,inicio,fim}
  }
  if(tipo==='personalizado')throw new Error('Informe uma data inicial e uma data final válidas.')
  const partes=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]))
  let y=Number(partes.year),m=Number(partes.month)
  if(tipo==='mes-anterior'){m--;if(!m){m=12;y--}}
  return{tipo,inicio:iso(y,m,1),fim:iso(y,m,new Date(Date.UTC(y,m,0)).getUTCDate())}
}

function filtros(params){
  const p=periodo(params),consultor=String(params.get('consultor')||'').trim().slice(0,180),uf=String(params.get('uf')||'').trim().toUpperCase().slice(0,2)
  const cond=[FATURADO,'cl.carteira_importada=1'],valores=[]
  const condClientes=['cl.carteira_importada=1','cl.ativo=1'],valoresClientes=[]
  if(p.inicio&&p.fim){cond.push('DATE(COALESCE(pe.data_pedido,pe.data_faturamento)) BETWEEN DATE(?) AND DATE(?)');valores.push(p.inicio,p.fim)}
  if(consultor){cond.push('cl.consultor_id=?');valores.push(consultor);condClientes.push('cl.consultor_id=?');valoresClientes.push(consultor)}
  if(uf){cond.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?");valores.push(uf);condClientes.push("UPPER(TRIM(COALESCE(cl.uf,'')))=?");valoresClientes.push(uf)}
  return{...p,consultor,uf,where:cond.join(' AND '),valores,clientWhere:condClientes.join(' AND '),clientValues:valoresClientes,rotulo:p.inicio?`${mostrar(p.inicio)} a ${mostrar(p.fim)}`:'Todo o período extraído'}
}

const JOINS='FROM itens_pedido ip JOIN pedidos pe ON pe.id=ip.pedido_id JOIN clientes cl ON cl.id=pe.cliente_id LEFT JOIN produtos pr ON pr.id=ip.produto_id'

export async function onRequestGet({request,env}){
  try{
    const f=filtros(new URL(request.url).searchParams)
    const consultas=[
      stmt(env,`SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${f.where} AND UPPER(COALESCE(pr.tipo_mix,'SEM CLASSIFICACAO'))<>'COMBATE'`,f.valores),
      stmt(env,`SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${f.where} AND UPPER(COALESCE(pr.tipo_mix,''))='PRIORITARIO'`,f.valores),
      stmt(env,`SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${f.where} AND UPPER(COALESCE(pr.tipo_mix,''))='LANCAMENTO'`,f.valores),
      stmt(env,`SELECT COUNT(DISTINCT pe.cliente_id) total ${JOINS} WHERE ${f.where} AND cl.ativo=1 AND ip.valor_faturado>0`,f.valores),
      stmt(env,`SELECT COUNT(*) total FROM clientes cl WHERE ${f.clientWhere}`,f.clientValues),
      stmt(env,"SELECT COUNT(*) total FROM consultores WHERE ativo=1 AND origem='PAINEL_EQUIPE'"),
      stmt(env,`SELECT COALESCE(SUM(ip.valor_faturado),0) total ${JOINS} WHERE ${f.where}`,f.valores),
      stmt(env,"SELECT COUNT(*) total FROM extracoes WHERE status='executando'"),
      stmt(env,"SELECT id,nome FROM consultores WHERE ativo=1 AND origem='PAINEL_EQUIPE' AND TRIM(nome)<>'' ORDER BY nome COLLATE NOCASE"),
      stmt(env,"SELECT DISTINCT UPPER(TRIM(uf)) uf FROM clientes WHERE carteira_importada=1 AND ativo=1 AND LENGTH(TRIM(COALESCE(uf,'')))=2 ORDER BY uf"),
      stmt(env,"SELECT (SELECT COUNT(*) FROM clientes WHERE carteira_importada=1) clientes_carteira,(SELECT COUNT(*) FROM produtos WHERE UPPER(COALESCE(tipo_mix,''))<>'SEM CLASSIFICACAO') produtos_mix,(SELECT COUNT(*) FROM produtos WHERE mercado_farma_ativo=1) produtos_mercado_farma,(SELECT COUNT(*) FROM metas WHERE escopo='consultor') metas")
    ]
    const r=await env.DB.batch(consultas),ativos=Number(r[4]?.results?.[0]?.total||0),comVenda=Number(r[3]?.results?.[0]?.total||0),b=r[10]?.results?.[0]||{}
    return json({
      ol_sem_combate:Number(r[0]?.results?.[0]?.total||0),ol_prioritarios:Number(r[1]?.results?.[0]?.total||0),ol_lancamentos:Number(r[2]?.results?.[0]?.total||0),
      clientes_com_venda:comVenda,clientes_sem_venda:Math.max(0,ativos-comVenda),clientes_ativos:ativos,consultores_ativos:Number(r[5]?.results?.[0]?.total||0),vendas_faturadas:Number(r[6]?.results?.[0]?.total||0),automacoes_executando:Number(r[7]?.results?.[0]?.total||0),
      bases:{painel_equipe_norte:Number(b.clientes_carteira||0),produtos_mix:Number(b.produtos_mix||0),produtos_mercado_farma:Number(b.produtos_mercado_farma||0),metas:Number(b.metas||0)},
      filtros:{consultores:(r[8]?.results||[]).map(x=>({id:String(x.id||''),nome:String(x.nome||'')})).filter(x=>x.id&&x.nome),ufs:(r[9]?.results||[]).map(x=>String(x.uf||'')).filter(Boolean),aplicado:{periodo:f.tipo,inicio:f.inicio,fim:f.fim,consultor:f.consultor,uf:f.uf,rotulo:f.rotulo}},
      regra_calculo:{valor:'itens_pedido.valor_faturado',carteira:'PAINEL EQUIPE NORTE por CNPJ',uf:'UF do cliente',consultor:'NOME REP do cliente'},atualizado_em:new Date().toISOString()
    })
  }catch(error){const detalhe=error instanceof Error?error.message:String(error);return json({erro:'Não foi possível carregar os indicadores.',detalhe},detalhe.includes('data inicial')||detalhe.includes('data final')?400:500)}
}
