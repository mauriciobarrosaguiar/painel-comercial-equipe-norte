import { readSession } from '../../_lib/credentials.js'
import { onRequestGet as consultarClientes } from '../clientes.js'
import { periodoTresMesesBrasilia } from '../../_lib/mercado-farma-comercial.js'
import { prepararCatalogoMix, comporPlanilhaClientes, aplicarEstoquePorDistribuidora, workbookClientesMix } from '../../_lib/clientes-mix-excel.js'

const MAX_CNPJS = 100
const errors = (message, status=400) => new Response(message,{status,headers:{'content-type':'text/plain; charset=UTF-8','cache-control':'no-store'}})
const onlyDigits = value => String(value || '').replace(/\D/g,'')
const cnpjSql = "REPLACE(REPLACE(REPLACE(COALESCE(cl.cnpj,''),'.',''),'/',''),'-','')"

export async function onRequestGet({request,env}) {
  const session = await readSession(request,env.PAINEL_ADMIN_KEY)
  if (!session?.consultor_id) return errors('Entre com seu usuário para exportar os clientes da sua carteira.',401)

  try {
    const url = new URL(request.url), params = new URLSearchParams(url.search)
    const owner = String(params.get('consultor') || '').trim()
    if (owner && owner !== String(session.consultor_id)) return errors('É permitido exportar somente sua carteira de clientes.',403)
    // O endpoint existente define os clientes efetivamente filtrados, inclusive
    // prioridade calculada, ordenação e período da página. Não usa só a página atual.
    params.set('consultor',String(session.consultor_id))
    params.set('pagina','1')
    params.set('limite','500')
    const listaRequest = new Request(new URL('/api/clientes?'+params,request.url),{
      method:'GET',headers:request.headers,
    })
    const listaResponse = await consultarClientes({request:listaRequest,env})
    if (!listaResponse.ok) return errors('Não foi possível aplicar os filtros dos clientes. '+(await listaResponse.text()).slice(0,250),listaResponse.status)
    const lista = await listaResponse.json()
    const filtrados = lista.clientes || []
    const cnpjs = [...new Set(filtrados.map(row=>onlyDigits(row.cnpj)).filter(Boolean))]
    if (!cnpjs.length) return errors('Nenhum CNPJ encontrado nos filtros. Ajuste a busca ou a UF.',404)
    if (cnpjs.length>MAX_CNPJS || Number(lista.paginacao?.total||0)>MAX_CNPJS)
      return errors(`Há mais de ${MAX_CNPJS} clientes nesta seleção. Refine os filtros por UF, cidade ou nome para exportar sem travar o painel.`,422)

    const periodo = periodoTresMesesBrasilia()
    const [catalogoResult,sapResult] = await env.DB.batch([
      env.DB.prepare(`
        SELECT p.id,p.ean,p.sku,p.descricao,
          COALESCE(NULLIF(TRIM(m.tipo_mix),''),p.tipo_mix) tipo_mix,
          'PRODUTO' origem
        FROM produtos p
        LEFT JOIN produtos_mix_sap m ON m.ativo=1 AND TRIM(COALESCE(m.sku,''))=TRIM(COALESCE(p.sku,''))
        WHERE p.ativo=1 AND UPPER(TRIM(COALESCE(m.tipo_mix,p.tipo_mix,''))) IN ('PRIORITARIO','LANCAMENTO','LANÇAMENTO')
        ORDER BY p.descricao COLLATE NOCASE
      `),
      env.DB.prepare(`
        SELECT 'sap:'||TRIM(m.sku) id, '' ean, m.sku sku,
          COALESCE(NULLIF(TRIM(m.descricao),''),'SAP '||TRIM(m.sku)) descricao,
          m.tipo_mix,'SAP' origem
        FROM produtos_mix_sap m
        WHERE m.ativo=1 AND TRIM(COALESCE(m.sku,''))<>''
          AND UPPER(TRIM(COALESCE(m.tipo_mix,''))) IN ('PRIORITARIO','LANCAMENTO','LANÇAMENTO')
          AND NOT EXISTS(SELECT 1 FROM produtos p WHERE p.ativo=1 AND TRIM(p.sku)=TRIM(m.sku))
        ORDER BY m.descricao COLLATE NOCASE
      `),
    ])
    const catalogo = prepararCatalogoMix([...(catalogoResult.results||[]),...(sapResult.results||[])])
    if (!catalogo.length) return errors('O MIX de prioritários e lançamentos está vazio. Confira a importação do MIX.',422)

    const compras = []
    // Blocos pequenos: evitam exceder os parâmetros do banco Turso/D1.
    for (let offset=0;offset<cnpjs.length;offset+=35) {
      const bloco = cnpjs.slice(offset,offset+35)
      const inPlaceholders = bloco.map(()=>'?').join(',')
      const compradas = await env.DB.prepare(`
        SELECT ${cnpjSql} cnpj,
          COALESCE(NULLIF(TRIM(pr.ean),''),NULLIF(TRIM(ip.ean),''),'') ean,
          COALESCE(NULLIF(TRIM(pr.sku),''),'') sku,
          COALESCE(pr.id,ip.produto_id,'') id,
          SUBSTR(DATE(COALESCE(pe.data_faturamento,pe.data_pedido)),1,7) mes,
          SUM(COALESCE(ip.quantidade_faturada,0)) quantidade,
          COUNT(DISTINCT CASE WHEN ip.quantidade_faturada>0 THEN pe.id END) pedidos,
          MAX(CASE WHEN ip.quantidade_faturada>0
            THEN DATE(COALESCE(pe.data_faturamento,pe.data_pedido)) END) ultima_compra
        FROM pedidos pe
        JOIN clientes cl ON cl.id=pe.cliente_id
        JOIN itens_pedido ip ON ip.pedido_id=pe.id
        LEFT JOIN produtos pr ON pr.id=ip.produto_id OR
          (ip.produto_id IS NULL AND TRIM(COALESCE(ip.ean,''))<>''
           AND TRIM(COALESCE(pr.ean,''))=TRIM(ip.ean))
        WHERE cl.consultor_id=? AND cl.ativo=1 AND cl.carteira_importada=1
          AND ${cnpjSql} IN (${inPlaceholders})
          AND UPPER(TRIM(COALESCE(pe.origem,'')))='BUSSOLA'
          AND UPPER(TRIM(COALESCE(pe.status,''))) IN ('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO')
          AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido))>=DATE(?)
          AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido))<DATE(?)
          AND ((pe.ativo=1 AND ip.ativo=1) OR
              (pe.ativo=0 AND ip.ativo=0
               AND DATE(COALESCE(pe.data_faturamento,pe.data_pedido))<DATE(?)))
        GROUP BY 1,2,3,4,5
      `).bind(session.consultor_id,...bloco,periodo.inicio,periodo.proximo,periodo.inicioMesAtual).all()
      compras.push(...(compradas.results||[]))
    }

    const ordenados = filtrados.filter(c=>cnpjs.includes(onlyDigits(c.cnpj)))
    const unicos = [...new Map(ordenados.map(c=>[onlyDigits(c.cnpj),c])).values()]
    const ufs = [...new Set(unicos.map(item=>String(item.uf || '').trim().toUpperCase()).filter(uf=>/^[A-Z]{2}$/.test(uf)))]
    if (!ufs.length) return errors('Clientes sem UF válida para consulta de estoque.',422)
    const ufIn = ufs.map(()=>'?').join(',')
    // Sempre oferecer somente distribuidoras que atendem a UF dos clientes.
    const existentes = await env.DB.prepare(`
      SELECT DISTINCT UPPER(TRIM(uf)) uf, TRIM(distribuidora) nome
      FROM mercado_farma_precos
      WHERE UPPER(TRIM(COALESCE(uf,''))) IN (${ufIn})
        AND TRIM(COALESCE(distribuidora,''))<>''
        AND TRIM(COALESCE(ean,''))<>''
      ORDER BY nome COLLATE NOCASE, uf
    `).bind(...ufs).all()
    // Cada CNPJ recebe somente as distribuidoras que aparecem em sua UF
    // na extração Mercado Farma, intersectadas com a seleção feita na tela.
    const atendimentoPorUf = Object.fromEntries(ufs.map(uf => [uf, []]))
    for (const item of existentes.results || []) {
      const uf = String(item.uf || '').trim().toUpperCase()
      const nome = String(item.nome || '').trim()
      if (atendimentoPorUf[uf] && nome && !atendimentoPorUf[uf].includes(nome)) {
        atendimentoPorUf[uf].push(nome)
      }
    }
    const disponiveis = [...new Set(Object.values(atendimentoPorUf).flat())]
    const explicit = params.has('distribuidora')
    const selecionadas = explicit
      ? [...new Set(params.getAll('distribuidora').map(item=>String(item).trim()).filter(Boolean))]
      : disponiveis
    if (!selecionadas.length) return errors('Selecione pelo menos uma distribuidora para exportar o estoque.',422)
    if (selecionadas.length > 20) return errors('Selecione até 20 distribuidoras por arquivo.',422)
    if (selecionadas.some(item=>!disponiveis.includes(item))) return errors('A seleção contém distribuidoras fora das UFs dos clientes.',422)

    // Evita somar snapshots: última linha por UF/EAN/distribuidora. Somente
    // o status OK possui estoque válido; ausência de cotação fica em branco.
    const eans = [...new Set(catalogo.map(prod=>String(prod.ean || '').trim()).filter(Boolean))]
    const precos = []
    for (let i=0; i<eans.length; i+=120) {
      const bloco = eans.slice(i,i+120)
      const eansIn = bloco.map(()=>'?').join(',')
      const distIn = selecionadas.map(()=>'?').join(',')
      const linhas = await env.DB.prepare(`
        SELECT uf,ean,distribuidora,
               CASE WHEN UPPER(TRIM(COALESCE(status,'')))='OK'
                         AND estoque IS NOT NULL THEN MAX(0,estoque)
                    ELSE NULL END estoque,
               atualizado_em
        FROM (
          SELECT UPPER(TRIM(uf)) uf,TRIM(ean) ean,
                 TRIM(distribuidora) distribuidora,estoque,status,atualizado_em,
                 ROW_NUMBER() OVER(
                   PARTITION BY UPPER(TRIM(uf)),TRIM(ean),TRIM(distribuidora)
                   ORDER BY COALESCE(atualizado_em,'') DESC,id DESC
                 ) numero
          FROM mercado_farma_precos
          WHERE UPPER(TRIM(COALESCE(uf,''))) IN (${ufIn})
            AND TRIM(COALESCE(ean,'')) IN (${eansIn})
            AND TRIM(COALESCE(distribuidora,'')) IN (${distIn})
        ) WHERE numero=1
      `).bind(...ufs,...bloco,...selecionadas).all()
      precos.push(...(linhas.results||[]))
    }
    const planilhas = aplicarEstoquePorDistribuidora(comporPlanilhaClientes(unicos,catalogo,compras,periodo),precos,selecionadas)
    const bytes = workbookClientesMix(planilhas,periodo,{
      busca:params.get('busca')||'',uf:params.get('uf')||'',
      cidade:params.get('cidade')||'',prioridade:params.get('prioridade')||'',
      periodo:lista.periodo?.rotulo||'',
    },selecionadas,atendimentoPorUf)
    return new Response(bytes,{headers:{
      'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':`attachment; filename="carteira-mix-${periodo.meses[0]}-a-${periodo.mes}-${cnpjs.length}-cnpjs.xlsx"`,
      'cache-control':'private, no-store, no-cache, must-revalidate',
      'x-content-type-options':'nosniff',
    }})
  }catch(error){
    return errors('Falha na geração do Excel da carteira. '+(error instanceof Error?error.message:String(error)),500)
  }
}
