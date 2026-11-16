import { readSession, json } from '../_lib/credentials.js'
import { monthlyQuery, queryFilters, categories } from '../_lib/sku-pdv.js'
import { MAURICIO_ID } from '../_lib/personal-scope.js'
import { buildXlsx } from '../_lib/xlsx-compatible.js'
const esc = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
export async function onRequestGet({ request, env }) {
  try {
    const session = await readSession(request, env.PAINEL_ADMIN_KEY)
    if (session?.consultor_id !== MAURICIO_ID) return json({erro:'Entre com seu acesso pessoal.'},401)
    const p = new URL(request.url).searchParams
    const mes = p.get('mes') || new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date())
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return json({erro:'Mês inválido.'},400)
    const next = new Date(`${mes}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth()+1)
    const args=[session.consultor_id,session.consultor_id,session.consultor_id,`${mes}-01`,next.toISOString().slice(0,10)]
    const cte=monthlyQuery(), f=queryFilters(p)
    const meta = await env.DB.prepare(`SELECT e.id,e.finalizado_em,
      COUNT(ip.id) itens,MIN(SUBSTR(COALESCE(pe.data_faturamento,pe.data_pedido),1,7)) primeiro_mes,
      MAX(SUBSTR(COALESCE(pe.data_faturamento,pe.data_pedido),1,7)) ultimo_mes,
      SUM(CASE WHEN ip.id IS NOT NULL AND (TRIM(COALESCE(NULLIF(ip.ean,''),pr.ean,''))='' OR ip.quantidade_faturada IS NULL) THEN 1 ELSE 0 END) invalidos
      FROM extracoes e LEFT JOIN pedidos pe ON pe.ultima_extracao_id=e.id AND pe.origem='BUSSOLA' AND pe.ativo=1 AND pe.consultor_id=?
      LEFT JOIN itens_pedido ip ON ip.pedido_id=pe.id AND ip.ativo=1 LEFT JOIN produtos pr ON pr.id=ip.produto_id
      WHERE e.id=(SELECT id FROM extracoes WHERE tipo='BUSSOLA' AND status='concluido' ORDER BY finalizado_em DESC LIMIT 1)
      GROUP BY e.id,e.finalizado_em`).bind(session.consultor_id).first()
    // Missing month evidence is unavailable, never a fabricated zero. Existing importer has no explicit coverage manifest.
    const available=Boolean(meta?.itens && !meta.invalidos && meta.primeiro_mes===mes && meta.ultimo_mes===mes)
    if (!available) return json({disponivel:false,mes,atualizado_em:meta?.finalizado_em || null,mensagem:'Extração mensal detalhada ausente, incompleta ou de outro mês. Não é possível confirmar o SKU/PDV. Nenhum histórico foi utilizado.'})
    const page=Math.max(1,Math.min(100000,Number.parseInt(p.get('pagina') || '1',10)||1)), limit=25
    const [summary,count,rows] = await env.DB.batch([
      env.DB.prepare(cte+`SELECT COUNT(*) carteira,SUM(CASE WHEN sem_combate>0 THEN 1 ELSE 0 END) compradores,${categories.map(c=>`SUM(${c}) soma_${c},AVG(${c}) ${c}`).join(',')} FROM resultado`).bind(...args),
      env.DB.prepare(cte+`SELECT COUNT(*) total FROM resultado${f.where}`).bind(...args,...f.binds),
      env.DB.prepare(cte+`SELECT * FROM resultado${f.where} ORDER BY ${f.order}${p.get('excel')==='1'?'':' LIMIT ? OFFSET ?'}`).bind(...args,...f.binds,...(p.get('excel')==='1'?[]:[limit,(page-1)*limit]))
    ])
    const s=summary.results[0], clientes=rows.results || []
    if (p.get('excel')==='1') {
      const headers=['CNPJ','CLIENTE','PRIORITÁRIOS','LANÇAMENTOS','LINHA','SEM COMBATE','CATÁLOGO TOTAL','SITUAÇÃO']
      const values=[headers,...clientes.map(c=>[c.cnpj,c.cliente,c.prioritarios,c.lancamentos,c.linha,c.sem_combate,c.total,c.sem_combate>0?'Com compra':'Zerado'])]
      const xmlRows=values.map((r,i)=>`<row r="${i+1}">${r.map((v,j)=>typeof v==='number'?`<c r="${String.fromCharCode(65+j)}${i+1}"><v>${v}</v></c>`:`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('')
      const bytes=buildXlsx({sheetName:mes,title:`SKU/PDV ${mes}`,stylesXml:'<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>',worksheetXml:`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`})
      return new Response(bytes,{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="SKU_PDV_${mes}.xlsx"`,'cache-control':'no-store'}})
    }
    return json({disponivel:true,mes,atualizado_em:meta.finalizado_em,resumo:{...s,zerados:s.carteira-s.compradores,cobertura:s.carteira?s.compradores/s.carteira*100:null,compradores_media:s.compradores?s.soma_sem_combate/s.compradores:null},clientes,paginacao:{pagina:page,limite:limit,total:count.results[0].total},mensagem:'Bússola mensal; saldo líquido positivo por CNPJ completo e EAN. Carteira oficial atual. Análise complementar compara com a média de toda a carteira.'})
  } catch (e) { return json({erro:'Não foi possível consultar o SKU/PDV mensal.'},500) }
}
