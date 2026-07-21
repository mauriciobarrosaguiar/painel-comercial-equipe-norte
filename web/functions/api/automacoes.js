const HEADERS={'content-type':'application/json; charset=UTF-8','cache-control':'no-store, no-cache, must-revalidate'}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEADERS})

export async function onRequestGet({env}){
 try{
  const [extracoes,importacoes]=await env.DB.batch([
   env.DB.prepare(`SELECT id,tipo,status,total_registros,mensagem,erro,iniciado_em,finalizado_em,criado_em FROM extracoes ORDER BY criado_em DESC LIMIT 30`),
   env.DB.prepare(`SELECT id,tipo,nome_arquivo,total_registros,status,criado_em FROM importacoes ORDER BY criado_em DESC LIMIT 15`),
  ])
  const recentes=(extracoes.results||[]).map(item=>({
   id:String(item.id||''),tipo:String(item.tipo||''),status:String(item.status||''),total_registros:Number(item.total_registros||0),mensagem:String(item.mensagem||''),erro:String(item.erro||''),iniciado_em:item.iniciado_em||null,finalizado_em:item.finalizado_em||null,criado_em:item.criado_em||null,
  }))
  return json({
   em_execucao:recentes.filter(item=>item.status==='executando').length,
   recentes,
   importacoes:(importacoes.results||[]).map(item=>({id:String(item.id||''),tipo:String(item.tipo||''),nome_arquivo:String(item.nome_arquivo||''),total_registros:Number(item.total_registros||0),status:String(item.status||''),criado_em:item.criado_em||null})),
   atualizado_em:new Date().toISOString(),
  })
 }catch(error){return json({erro:'Não foi possível consultar as automações.',detalhe:error instanceof Error?error.message:String(error)},500)}
}
