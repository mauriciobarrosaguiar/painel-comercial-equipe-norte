import { MIX_SEM_COMBATE } from '../_lib/commercial.js'

const TIPOS = new Set(['clientes','consultores','mercado_farma','historico','foco','foco_pendentes','oportunidades','sips','sip_detalhado'])
const texto = (v) => String(v ?? '').trim()
const data = (v) => /^\d{4}-\d{2}-\d{2}$/.test(texto(v))
const esc = (v) => { const s=String(v??''); return /[;"\n\r]/.test(s) ? `"${s.replaceAll('"','""')}"` : s }
const html = (v) => String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')

function responder(nome, linhas, formato) {
  const colunas=[...new Set(linhas.flatMap(x=>Object.keys(x)))]
  if(formato==='xls'){
    const cabecalho=colunas.map(c=>`<th>${html(c)}</th>`).join('')
    const corpo=linhas.map(x=>`<tr>${colunas.map(c=>`<td>${html(x[c])}</td>`).join('')}</tr>`).join('')
    const conteudo=`<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${cabecalho}</tr></thead><tbody>${corpo}</tbody></table></body></html>`
    return new Response(conteudo,{headers:{'content-type':'application/vnd.ms-excel; charset=UTF-8','content-disposition':`attachment; filename="${nome}.xls"`,'cache-control':'no-store'}})
  }
  const conteudo='\ufeff'+[colunas.join(';'),...linhas.map(x=>colunas.map(c=>esc(x[c])).join(';'))].join('\r\n')
  return new Response(conteudo,{headers:{'content-type':'text/csv; charset=UTF-8','content-disposition':`attachment; filename="${nome}.csv"`,'cache-control':'no-store'}})
}

function periodo(p){const h=new Date(),inicio=data(p.get('inicio'))?p.get('inicio'):`${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-01`,fim=data(p.get('fim'))?p.get('fim'):`${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-${String(new Date(h.getFullYear(),h.getMonth()+1,0).getDate()).padStart(2,'0')}`;return{inicio,fim}}

export async function onRequestGet({request,env}){
  try{
    const p=new URL(request.url).searchParams,tipo=texto(p.get('tipo')).toLowerCase(),formato=texto(p.get('formato')).toLowerCase()==='xls'?'xls':'csv'
    if(!TIPOS.has(tipo))return new Response('Tipo inválido',{status:400})
    const{inicio,fim}=periodo(p),uf=texto(p.get('uf')).toUpperCase().slice(0,2),consultor=texto(p.get('consultor')),dist=texto(p.get('distribuidora')),busca=texto(p.get('busca')),estoque=p.get('estoque')==='1',sipId=texto(p.get('sip_id'))
    let sql='',binds=[]

    if(tipo==='mercado_farma'){
      const cond=['1=1'];if(uf){cond.push('UPPER(TRIM(uf))=?');binds.push(uf)}if(dist){cond.push('distribuidora=?');binds.push(dist)}if(busca){cond.push("(UPPER(COALESCE(produto,'')) LIKE UPPER(?) OR ean LIKE ?)");binds.push(`%${busca}%`,`%${busca.replace(/\D/g,'')}%`)}if(estoque)cond.push('estoque>0')
      sql=`SELECT uf,ean,produto,distribuidora,estoque,desconto,pf_distribuidora,pf_fabrica,preco_sem_imposto,preco_com_imposto,status,erro,atualizado_em FROM mercado_farma_precos WHERE ${cond.join(' AND ')} ORDER BY produto COLLATE NOCASE,uf,CASE WHEN preco_sem_imposto>0 THEN preco_sem_imposto ELSE 999999999 END,distribuidora`
    }else if(tipo==='historico'){
      sql="SELECT ano_mes,escopo,referencia_nome,versao,resultado_json,fechado_em FROM historico_mensal WHERE versao_atual=1 ORDER BY ano_mes DESC,escopo,referencia_nome"
    }else if(tipo==='foco'){
      sql=`SELECT f.semana_inicio,f.semana_fim,f.ean,f.descricao,co.nome consultor,MIN(cl.setor_rep) setor,fc.meta_quantidade,fc.meta_valor,f.observacoes FROM foco_semanal f LEFT JOIN foco_consultores fc ON fc.foco_id=f.id AND fc.ativo=1 LEFT JOIN consultores co ON co.id=fc.consultor_id LEFT JOIN clientes cl ON cl.consultor_id=co.id AND cl.carteira_importada=1 WHERE f.ativo=1 GROUP BY f.id,co.id ORDER BY f.semana_inicio DESC,f.descricao,co.nome`
    }else if(tipo==='foco_pendentes'){
      binds=[consultor,consultor,uf,uf,fim,inicio]
      sql=`WITH consultores_escopo AS(SELECT co.id,co.nome,MIN(cl.setor_rep) setor FROM consultores co LEFT JOIN clientes cl ON cl.consultor_id=co.id AND cl.carteira_importada=1 WHERE co.ativo=1 AND co.origem='PAINEL_EQUIPE' AND (?='' OR co.id=?) GROUP BY co.id,co.nome),metas AS(SELECT f.id foco_id,f.semana_inicio,f.semana_fim,f.ean,f.descricao,co.id consultor_id,co.nome consultor,co.setor FROM foco_semanal f CROSS JOIN consultores_escopo co LEFT JOIN foco_consultores fc ON fc.foco_id=f.id AND fc.consultor_id=co.id AND fc.ativo=1 WHERE f.ativo=1 AND DATE(f.semana_inicio)<=DATE(?) AND DATE(f.semana_fim)>=DATE(?) AND (NOT EXISTS(SELECT 1 FROM foco_consultores fx WHERE fx.foco_id=f.id AND fx.ativo=1) OR fc.consultor_id IS NOT NULL)) SELECT m.consultor,m.setor,m.descricao produto,m.ean,m.semana_inicio,m.semana_fim,cl.cnpj,COALESCE(cl.nome_fantasia,cl.razao_social) cliente,cl.cidade,cl.uf FROM metas m JOIN clientes cl ON cl.consultor_id=m.consultor_id AND cl.carteira_importada=1 AND cl.ativo=1 AND (?='' OR UPPER(TRIM(COALESCE(cl.uf,'')))=?) WHERE NOT EXISTS(SELECT 1 FROM pedidos pe JOIN itens_pedido ip ON ip.pedido_id=pe.id LEFT JOIN produtos pr ON pr.id=ip.produto_id WHERE pe.cliente_id=cl.id AND pe.ativo=1 AND ip.ativo=1 AND UPPER(TRIM(COALESCE(pe.status,''))) IN('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO') AND COALESCE(NULLIF(ip.ean,''),pr.ean,'')=m.ean AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(m.semana_inicio) AND DATE(m.semana_fim)) ORDER BY m.consultor,m.descricao,cliente`
      binds=[consultor,consultor,fim,inicio,uf,uf]
    }else if(tipo==='oportunidades'){
      const cond=["cl.carteira_importada=1","cl.ativo=1"];binds=[inicio,fim];if(consultor){cond.push('cl.consultor_id=?');binds.push(consultor)}if(uf){cond.push('UPPER(TRIM(cl.uf))=?');binds.push(uf)}
      sql=`SELECT co.nome consultor,cl.cnpj,COALESCE(cl.nome_fantasia,cl.razao_social) cliente,cl.cidade,cl.uf,COALESCE(SUM(ip.valor_faturado),0) faturamento_periodo,MAX(DATE(COALESCE(pe.data_faturamento,pe.data_pedido))) ultima_compra,CASE WHEN COUNT(DISTINCT pe.id)=0 THEN 'SEM VENDA' WHEN COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='PRIORITARIO' THEN ip.valor_faturado ELSE 0 END),0)=0 THEN 'SEM PRIORITARIOS' WHEN COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='LANCAMENTO' THEN ip.valor_faturado ELSE 0 END),0)=0 THEN 'SEM LANCAMENTOS' ELSE 'AMPLIAR MIX' END oportunidade FROM clientes cl LEFT JOIN consultores co ON co.id=cl.consultor_id LEFT JOIN pedidos pe ON pe.cliente_id=cl.id AND pe.ativo=1 AND UPPER(TRIM(COALESCE(pe.status,''))) IN('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO') AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?) LEFT JOIN itens_pedido ip ON ip.pedido_id=pe.id AND ip.ativo=1 LEFT JOIN produtos pr ON pr.id=ip.produto_id WHERE ${cond.join(' AND ')} GROUP BY cl.id HAVING oportunidade<>'AMPLIAR MIX' OR faturamento_periodo=0 ORDER BY consultor,oportunidade,cliente`
    }else if(tipo==='sip_detalhado'){
      if(!sipId)return new Response('SIP não informada',{status:400})
      const sip=await env.DB.prepare('SELECT nome,acesso_publico_ativo FROM sips WHERE id=? AND ativo=1').bind(sipId).first();if(!sip)return new Response('SIP não encontrada',{status:404});if(p.get('publico')==='1'&&!Number(sip.acesso_publico_ativo||0))return new Response('Acesso da SIP desativado',{status:403})
      binds=[sipId,inicio,fim]
      sql=`SELECT ? sip,cl.cnpj,COALESCE(cl.nome_fantasia,cl.razao_social) cliente,cl.cidade,cl.uf,co.nome consultor,pe.pedido_origem pedido,pe.nota_fiscal,pe.status,DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) data,COALESCE(pr.ean,ip.ean,'') ean,COALESCE(pr.descricao,ip.descricao) produto,COALESCE(pr.tipo_mix,'SEM CLASSIFICACAO') tipo_mix,ip.quantidade_faturada,ip.preco_unitario_sem_imposto,ip.preco_unitario_com_imposto,ip.valor_faturado,CASE WHEN UPPER(TRIM(COALESCE(pe.status,''))) IN('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO') THEN 'FATURADA' WHEN UPPER(TRIM(COALESCE(pe.status,''))) LIKE '%CANCEL%' OR UPPER(TRIM(COALESCE(pe.status,''))) LIKE '%NAO FATUR%' OR UPPER(TRIM(COALESCE(pe.status,''))) LIKE '%NÃO FATUR%' THEN 'CANCELADA' ELSE 'A FATURAR' END situacao_nota FROM sip_clientes sc JOIN clientes cl ON cl.cnpj=sc.cnpj AND cl.carteira_importada=1 AND cl.ativo=1 LEFT JOIN consultores co ON co.id=cl.consultor_id JOIN pedidos pe ON pe.cliente_id=cl.id AND pe.ativo=1 LEFT JOIN itens_pedido ip ON ip.pedido_id=pe.id AND ip.ativo=1 LEFT JOIN produtos pr ON pr.id=ip.produto_id WHERE sc.sip_id=? AND sc.ativo=1 AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?) ORDER BY cliente,data,pedido,produto`
      binds=[sip.nome,sipId,inicio,fim]
    }else if(tipo==='clientes'){
      const cond=["cl.carteira_importada=1","cl.ativo=1"],f=[];if(uf){cond.push("UPPER(TRIM(cl.uf))=?");f.push(uf)}if(consultor){cond.push('cl.consultor_id=?');f.push(consultor)}binds=[inicio,fim,...f]
      sql=`SELECT cl.cnpj,COALESCE(cl.nome_fantasia,cl.razao_social) cliente,cl.cidade,cl.uf,co.nome consultor,cl.nome_gd gd,CASE WHEN COUNT(DISTINCT pe.id)>0 THEN 'COM VENDA' ELSE 'SEM VENDA' END situacao_venda,COUNT(DISTINCT pe.id) pedidos,COALESCE(SUM(ip.valor_faturado),0) faturamento,MAX(DATE(COALESCE(pe.data_faturamento,pe.data_pedido))) ultima_compra FROM clientes cl LEFT JOIN consultores co ON co.id=cl.consultor_id LEFT JOIN pedidos pe ON pe.cliente_id=cl.id AND pe.ativo=1 AND UPPER(TRIM(COALESCE(pe.status,''))) IN('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO') AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?) LEFT JOIN itens_pedido ip ON ip.pedido_id=pe.id AND ip.ativo=1 WHERE ${cond.join(' AND ')} GROUP BY cl.id ORDER BY consultor,situacao_venda,cliente`
    }else if(tipo==='consultores'){
      binds=[inicio,fim];sql=`SELECT co.nome consultor,COUNT(DISTINCT cl.id) clientes_ativos,COUNT(DISTINCT CASE WHEN pe.id IS NOT NULL THEN cl.id END) clientes_com_venda,COUNT(DISTINCT pe.id) pedidos,COALESCE(SUM(ip.valor_faturado),0) ol_total,COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) ol_sem_combate,COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='PRIORITARIO' THEN ip.valor_faturado ELSE 0 END),0) prioritarios,COALESCE(SUM(CASE WHEN UPPER(COALESCE(pr.tipo_mix,''))='LANCAMENTO' THEN ip.valor_faturado ELSE 0 END),0) lancamentos FROM consultores co LEFT JOIN clientes cl ON cl.consultor_id=co.id AND cl.carteira_importada=1 AND cl.ativo=1 LEFT JOIN pedidos pe ON pe.cliente_id=cl.id AND pe.ativo=1 AND UPPER(TRIM(COALESCE(pe.status,''))) IN('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO') AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?) LEFT JOIN itens_pedido ip ON ip.pedido_id=pe.id AND ip.ativo=1 LEFT JOIN produtos pr ON pr.id=ip.produto_id WHERE co.ativo=1 AND co.origem='PAINEL_EQUIPE' GROUP BY co.id ORDER BY ol_sem_combate DESC`
    }else{
      binds=[inicio,fim];sql=`SELECT s.nome sip,COUNT(DISTINCT cl.id) clientes_ativos,COUNT(DISTINCT CASE WHEN pe.id IS NOT NULL THEN cl.id END) clientes_com_venda,COALESCE(SUM(ip.valor_faturado),0) ol_total,COALESCE(SUM(CASE WHEN ${MIX_SEM_COMBATE} THEN ip.valor_faturado ELSE 0 END),0) ol_sem_combate FROM sips s LEFT JOIN sip_clientes sc ON sc.sip_id=s.id AND sc.ativo=1 LEFT JOIN clientes cl ON cl.cnpj=sc.cnpj AND cl.carteira_importada=1 AND cl.ativo=1 LEFT JOIN pedidos pe ON pe.cliente_id=cl.id AND pe.ativo=1 AND UPPER(TRIM(COALESCE(pe.status,''))) IN('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO') AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) BETWEEN DATE(?) AND DATE(?) LEFT JOIN itens_pedido ip ON ip.pedido_id=pe.id AND ip.ativo=1 WHERE s.ativo=1 GROUP BY s.id ORDER BY ol_sem_combate DESC`
    }
    const r=binds.length?await env.DB.prepare(sql).bind(...binds).all():await env.DB.prepare(sql).all();let linhas=r.results||[]
    if(tipo==='historico')linhas=linhas.map(x=>{let j={};try{j=JSON.parse(String(x.resultado_json||'{}'))}catch{}const{resultado_json,...base}=x;return{...base,...j}})
    return responder(`${tipo}_${inicio}_${fim}`,linhas,formato)
  }catch(error){return new Response(`Falha ao exportar: ${error instanceof Error?error.message:String(error)}`,{status:500})}
}
