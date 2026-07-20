import { authorized, json } from '../../_lib/credentials.js'
import { classificarMix } from '../../_lib/commercial.js'

const TIPOS=new Set(['painel','metas','produtos_mix','produtos_mercado_farma'])
const texto=(v)=>String(v??'').trim()
const digitos=(v)=>texto(v).replace(/\D/g,'')
const alto=(v)=>texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').toUpperCase()
const numero=(v)=>{if(typeof v==='number')return Number.isFinite(v)?v:0;let s=texto(v).replace(/R\$/g,'').replace(/%/g,'').replace(/\s/g,'');if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');else if(s.includes(','))s=s.replace(',','.');const n=Number(s);return Number.isFinite(n)?n:0}
const ativo=(v)=>!/(INATIV|CANCEL|ENCERR|BLOQUE)/.test(alto(v))

async function idEstavel(prefixo,...partes){
  const bytes=new TextEncoder().encode(partes.map(texto).join('|'))
  const hash=await crypto.subtle.digest('SHA-1',bytes)
  const hex=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')
  return`${prefixo}-${hex.slice(0,28)}`
}

async function admin(request,env){
  if(typeof env.PAINEL_ADMIN_KEY!=='string'||env.PAINEL_ADMIN_KEY.length<12)return json({erro:'Chave administrativa não configurada.'},503)
  if(!(await authorized(request,env.PAINEL_ADMIN_KEY)))return json({erro:'Chave administrativa inválida.'},401)
  return null
}

async function executarJson(env,sql,rows,tamanho=400,antes=[],depois=[]){
  for(let i=0;i<rows.length;i+=tamanho){
    const bloco=JSON.stringify(rows.slice(i,i+tamanho))
    await env.DB.prepare(sql).bind(...antes,bloco,...depois).run()
  }
}

async function registrar(env,tipo,nome,total){
  const agora=new Date().toISOString()
  await env.DB.prepare('INSERT INTO importacoes(id,tipo,nome_arquivo,total_registros,status,criado_em) VALUES(?,?,?,?,?,?)').bind(`imp-${crypto.randomUUID()}`,tipo,nome,total,'concluido',agora).run()
}

async function obterStatus(env){
  const r=await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) total FROM clientes WHERE carteira_importada=1'),
    env.DB.prepare("SELECT COUNT(*) total FROM produtos WHERE UPPER(COALESCE(tipo_mix,''))<>'SEM CLASSIFICACAO'"),
    env.DB.prepare('SELECT COUNT(*) total FROM produtos WHERE mercado_farma_ativo=1'),
    env.DB.prepare('SELECT COUNT(*) total FROM metas'),
    env.DB.prepare('SELECT tipo,nome_arquivo,total_registros,status,criado_em FROM importacoes ORDER BY criado_em DESC LIMIT 8')
  ])
  return{painel:Number(r[0]?.results?.[0]?.total||0),produtos_mix:Number(r[1]?.results?.[0]?.total||0),produtos_mercado_farma:Number(r[2]?.results?.[0]?.total||0),metas:Number(r[3]?.results?.[0]?.total||0),historico:r[4]?.results||[]}
}

async function importarPainel(env,rows,nome){
  const token=crypto.randomUUID(),consultores=new Map(),clientes=[]
  for(const row of rows){
    const bruto=digitos(row.cnpj);if(!bruto)continue
    const cnpj=bruto.slice(-14).padStart(14,'0');if(/^0+$/.test(cnpj))continue
    const nomeRep=texto(row.nome_rep||row.consultor||row.representante)
    const consultorId=nomeRep?await idEstavel('cons',nomeRep):null
    if(consultorId)consultores.set(consultorId,{id:consultorId,nome:nomeRep})
    clientes.push({id:await idEstavel('cli',cnpj),cnpj,nome_fantasia:texto(row.nome_pdv||row.nome_fantasia||row.razao_social),cidade:texto(row.cidade),uf:alto(row.uf).slice(0,2),situacao:texto(row.situacao),grupo_economico:texto(row.grupo_economico),rede_associacao:texto(row.rede_associacao),bandeira:texto(row.bandeira),nome_gd:texto(row.nome_gd),consultor_id:consultorId,setor_rep:texto(row.setor_rep),foco_pex:texto(row.foco_pex),positivacao:texto(row.positivacao),grupo_sip:texto(row.grupo_economico||row.rede_associacao||row.bandeira||row.nome_pdv),ativo:ativo(row.situacao)?1:0,token})
  }
  if(!clientes.length)throw new Error('O Painel Equipe Norte não possui clientes válidos.')
  const agora=new Date().toISOString()
  for(const c of consultores.values())await env.DB.prepare("INSERT INTO consultores(id,nome,origem,ativo,atualizado_em) VALUES(?,?,'PAINEL_EQUIPE',1,?) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome,origem='PAINEL_EQUIPE',ativo=1,atualizado_em=excluded.atualizado_em").bind(c.id,c.nome,agora).run()
  await executarJson(env,`INSERT INTO clientes(id,cnpj,nome_fantasia,cidade,uf,situacao,grupo_economico,rede_associacao,bandeira,nome_gd,consultor_id,setor_rep,foco_pex,positivacao,grupo_sip,ativo,carteira_importada,carteira_importacao_id,atualizado_em) SELECT json_extract(value,'$.id'),json_extract(value,'$.cnpj'),json_extract(value,'$.nome_fantasia'),json_extract(value,'$.cidade'),json_extract(value,'$.uf'),json_extract(value,'$.situacao'),json_extract(value,'$.grupo_economico'),json_extract(value,'$.rede_associacao'),json_extract(value,'$.bandeira'),json_extract(value,'$.nome_gd'),json_extract(value,'$.consultor_id'),json_extract(value,'$.setor_rep'),json_extract(value,'$.foco_pex'),json_extract(value,'$.positivacao'),json_extract(value,'$.grupo_sip'),json_extract(value,'$.ativo'),1,json_extract(value,'$.token'),? FROM json_each(?) WHERE 1 ON CONFLICT(cnpj) DO UPDATE SET nome_fantasia=excluded.nome_fantasia,cidade=excluded.cidade,uf=excluded.uf,situacao=excluded.situacao,grupo_economico=excluded.grupo_economico,rede_associacao=excluded.rede_associacao,bandeira=excluded.bandeira,nome_gd=excluded.nome_gd,consultor_id=excluded.consultor_id,setor_rep=excluded.setor_rep,foco_pex=excluded.foco_pex,positivacao=excluded.positivacao,grupo_sip=excluded.grupo_sip,ativo=excluded.ativo,carteira_importada=1,carteira_importacao_id=excluded.carteira_importacao_id,atualizado_em=excluded.atualizado_em`,clientes,250,[agora])
  await env.DB.batch([
    env.DB.prepare("UPDATE clientes SET carteira_importada=0,consultor_id=NULL WHERE carteira_importada=1 AND COALESCE(carteira_importacao_id,'')<>?").bind(token),
    env.DB.prepare("UPDATE consultores SET ativo=CASE WHEN EXISTS(SELECT 1 FROM clientes c WHERE c.consultor_id=consultores.id AND c.carteira_importada=1) THEN 1 ELSE 0 END WHERE origem='PAINEL_EQUIPE'"),
    env.DB.prepare("UPDATE pedidos SET consultor_id=(SELECT c.consultor_id FROM clientes c WHERE c.id=pedidos.cliente_id AND c.carteira_importada=1) WHERE origem='BUSSOLA'")
  ])
  await registrar(env,'PAINEL_EQUIPE_NORTE',nome,clientes.length)
  return{total:clientes.length,consultores:consultores.size}
}

async function importarProdutos(env,rows,nome,tipo){
  const token=crypto.randomUUID(),dados=[]
  for(const row of rows){const ean=digitos(row.ean);if(!ean)continue;dados.push({id:await idEstavel('prod',ean),ean,descricao:texto(row.produto||row.descricao)||`Produto ${ean}`,tipo_mix:classificarMix(row.tipo_mix||row.classificacao||row.categoria),token})}
  if(!dados.length)throw new Error('A planilha não possui EANs válidos.')
  const agora=new Date().toISOString()
  if(tipo==='produtos_mix'){
    await executarJson(env,`INSERT INTO produtos(id,ean,descricao,tipo_mix,ativo,mix_importacao_id,atualizado_em) SELECT json_extract(value,'$.id'),json_extract(value,'$.ean'),json_extract(value,'$.descricao'),json_extract(value,'$.tipo_mix'),1,json_extract(value,'$.token'),? FROM json_each(?) WHERE 1 ON CONFLICT(ean) DO UPDATE SET descricao=excluded.descricao,tipo_mix=excluded.tipo_mix,ativo=1,mix_importacao_id=excluded.mix_importacao_id,atualizado_em=excluded.atualizado_em`,dados,400,[agora])
    await env.DB.prepare("UPDATE produtos SET tipo_mix='SEM CLASSIFICACAO' WHERE COALESCE(mix_importacao_id,'')<>?").bind(token).run()
  }else{
    await executarJson(env,`INSERT INTO produtos(id,ean,descricao,ativo,mercado_farma_ativo,mercado_farma_importacao_id,atualizado_em) SELECT json_extract(value,'$.id'),json_extract(value,'$.ean'),json_extract(value,'$.descricao'),1,1,json_extract(value,'$.token'),? FROM json_each(?) WHERE 1 ON CONFLICT(ean) DO UPDATE SET descricao=excluded.descricao,ativo=1,mercado_farma_ativo=1,mercado_farma_importacao_id=excluded.mercado_farma_importacao_id,atualizado_em=excluded.atualizado_em`,dados,400,[agora])
    await env.DB.prepare("UPDATE produtos SET mercado_farma_ativo=0 WHERE mercado_farma_ativo=1 AND COALESCE(mercado_farma_importacao_id,'')<>?").bind(token).run()
  }
  await registrar(env,tipo.toUpperCase(),nome,dados.length)
  return{total:dados.length}
}

async function importarMetas(env,rows,nome,anoMes){
  if(!/^\d{4}-\d{2}$/.test(anoMes))throw new Error('Informe o mês das metas no formato AAAA-MM.')
  const dados=[]
  for(const row of rows){const n=texto(row.consultor||row.colaborador);if(!n)continue;const consultor_id=await idEstavel('cons',n);dados.push({id:await idEstavel('meta',anoMes,'consultor',consultor_id),consultor_id,nome:n,ol_sem_combate:numero(row.ol_sem_combate),ol_prioritarios:numero(row.ol_prioritarios),ol_lancamentos:numero(row.ol_lancamentos),clientes_positivados:numero(row.clientes_positivados)})}
  if(!dados.length)throw new Error('A planilha não possui metas válidas.')
  const agora=new Date().toISOString(),token=crypto.randomUUID()
  for(const d of dados)await env.DB.prepare("INSERT INTO consultores(id,nome,origem,ativo,atualizado_em) VALUES(?,?,'METAS',1,?) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome,atualizado_em=excluded.atualizado_em").bind(d.consultor_id,d.nome,agora).run()
  await env.DB.prepare('DELETE FROM metas WHERE ano_mes=?').bind(anoMes).run()
  await executarJson(env,`INSERT INTO metas(id,ano_mes,escopo,consultor_id,ol_sem_combate,ol_prioritarios,ol_lancamentos,clientes_positivados,importacao_id,atualizado_em) SELECT json_extract(value,'$.id'),?,'consultor',json_extract(value,'$.consultor_id'),json_extract(value,'$.ol_sem_combate'),json_extract(value,'$.ol_prioritarios'),json_extract(value,'$.ol_lancamentos'),json_extract(value,'$.clientes_positivados'),?,? FROM json_each(?)`,dados,400,[anoMes,token,agora])
  const soma=dados.reduce((a,d)=>({ol_sem_combate:a.ol_sem_combate+d.ol_sem_combate,ol_prioritarios:a.ol_prioritarios+d.ol_prioritarios,ol_lancamentos:a.ol_lancamentos+d.ol_lancamentos,clientes_positivados:a.clientes_positivados+d.clientes_positivados}),{ol_sem_combate:0,ol_prioritarios:0,ol_lancamentos:0,clientes_positivados:0})
  await env.DB.prepare("INSERT INTO metas(id,ano_mes,escopo,consultor_id,ol_sem_combate,ol_prioritarios,ol_lancamentos,clientes_positivados,importacao_id,atualizado_em) VALUES(?,?,'gerente',NULL,?,?,?,?,?,?)").bind(await idEstavel('meta',anoMes,'gerente'),anoMes,soma.ol_sem_combate,soma.ol_prioritarios,soma.ol_lancamentos,soma.clientes_positivados,token,agora).run()
  await registrar(env,'METAS_COMERCIAIS',nome,dados.length)
  return{total:dados.length,ano_mes:anoMes}
}

export async function onRequestGet({request,env}){const negado=await admin(request,env);if(negado)return negado;return json(await obterStatus(env))}
export async function onRequestPost({request,env}){
  const negado=await admin(request,env);if(negado)return negado
  try{
    const body=await request.json(),tipo=texto(body.tipo),rows=Array.isArray(body.rows)?body.rows:[],nome=texto(body.nome_arquivo)||'arquivo.xlsx'
    if(!TIPOS.has(tipo))return json({erro:'Tipo de base inválido.'},400)
    if(!rows.length||rows.length>30000)return json({erro:'A base está vazia ou excede 30.000 linhas.'},400)
    const resultado=tipo==='painel'?await importarPainel(env,rows,nome):tipo==='metas'?await importarMetas(env,rows,nome,texto(body.ano_mes)):await importarProdutos(env,rows,nome,tipo)
    return json({sucesso:true,tipo,...resultado,bases:await obterStatus(env)})
  }catch(error){return json({erro:error instanceof Error?error.message:String(error)},400)}
}
