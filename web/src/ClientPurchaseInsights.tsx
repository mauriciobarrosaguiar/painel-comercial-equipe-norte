import { useEffect, useMemo, useState } from 'react'

export type OfertaInteligencia = {
  distribuidora: string; uf: string; estoque: number; preco: number
  preco_com_imposto: number; preco_sem_imposto: number; atualizado_em: string | null
}
export type SugestaoInteligencia = {
  id: string; ean: string; produto: string; tipo_mix: string
  tipo: 'REPOSICAO' | 'REATIVACAO' | 'EXPANSAO_MIX'
  quantidade_sugerida: number; quantidade_3m: number; quantidade_6m: number
  justificativa: string; ultima_compra: string | null; ofertas: OfertaInteligencia[]
}
export type InteligenciaCliente = {
  cliente: { id: string; cnpj: string; uf: string; nome: string }
  cobertura: { total: number; comprados: number; nao_comprados: number; percentual: number; periodo: string; inicio: string; fim: string; criterio: string }
  sugestoes: SugestaoInteligencia[]
  avisos: string[]
}
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const integer = new Intl.NumberFormat('pt-BR')
const chave = 'mercado-farma-importacao-proposta'
const tipos: Record<SugestaoInteligencia['tipo'], string> = {
  REPOSICAO: 'Reposição recorrente',
  REATIVACAO: 'Reativar compra',
  EXPANSAO_MIX: 'Oportunidade de mix',
}
export default function ClientPurchaseInsights({ dados, onOpenMarket }: { dados: InteligenciaCliente; onOpenMarket: () => void }) {
  const [marcados, setMarcados] = useState<string[]>([])
  const [quantidades, setQuantidades] = useState<Record<string, number>>({})
  const [distribuidoras, setDistribuidoras] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    setMarcados([])
    setQuantidades({})
    setDistribuidoras({})
    setAviso('')
  }, [dados.cliente.id])
  const disponiveis = dados.sugestoes.filter(item => item.ofertas.length)
  const selecionados = useMemo(() => dados.sugestoes.filter(item => marcados.includes(item.ean)), [dados.sugestoes, marcados])
  const oferta = (item: SugestaoInteligencia) => item.ofertas.find(op => op.distribuidora === distribuidoras[item.ean]) || item.ofertas[0]
  const quantidade = (item: SugestaoInteligencia) => Math.max(1, Math.min(99999, quantidades[item.ean] || item.quantidade_sugerida))
  const total = selecionados.reduce((soma, item) => soma + (oferta(item)?.preco || 0) * Math.min(quantidade(item), oferta(item)?.estoque || 0), 0)

  function enviar() {
    const itens = selecionados.map(item => {
      const escolhida = oferta(item)
      const qtd = quantidade(item)
      return escolhida && escolhida.estoque >= qtd ? {
        ean: item.ean, quantidade: qtd, distribuidora: escolhida.distribuidora, preco_referencia: escolhida.preco,
      } : null
    }).filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (!itens.length) { setAviso('Selecione produtos com distribuidora e estoque suficientes.'); return }
    if (itens.length !== selecionados.length) { setAviso('Revise as quantidades: há produtos sem estoque suficiente.'); return }
    sessionStorage.setItem(chave, JSON.stringify({
      criado_em: Date.now(), cliente_cnpj: dados.cliente.cnpj, uf: dados.cliente.uf, itens,
    }))
    onOpenMarket()
  }

  return <>
    <section className="detail-section client-intelligence">
      <div className="client-insights-heading"><div><span className="eyebrow">Últimos 3 meses-calendário</span><h3>Cobertura do nosso catálogo</h3></div><strong>{dados.cobertura.percentual.toLocaleString('pt-BR')}%</strong></div>
      <div className="client-coverage-metrics">
        <article><span>Catálogo ativo com EAN</span><b>{integer.format(dados.cobertura.total)}</b></article>
        <article><span>Produtos comprados</span><b>{integer.format(dados.cobertura.comprados)}</b></article>
        <article><span>Ainda não comprados</span><b>{integer.format(dados.cobertura.nao_comprados)}</b></article>
      </div>
      <div className="client-coverage-track" role="progressbar" aria-label="Cobertura do catálogo" aria-valuenow={dados.cobertura.percentual} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${dados.cobertura.percentual}%` }} /></div>
      <small>Período: {dados.cobertura.inicio.split('-').reverse().join('/')} a {dados.cobertura.fim.split('-').reverse().join('/')}. {dados.cobertura.criterio}</small>
    </section>
    <section className="detail-section client-intelligence">
      <div className="client-insights-heading"><div><span className="eyebrow">Recomendação baseada no giro</span><h3>Sugestão de compras</h3></div><strong>{integer.format(disponiveis.length)} com oferta</strong></div>
      <p>Escolha as quantidades e a distribuidora. O preço vem da última extração Mercado Farma para <b>{dados.cliente.uf}</b>. Nenhum pedido será enviado automaticamente.</p>
      {dados.avisos.map(aviso => <p className="client-rec-warning" key={aviso}>{aviso}</p>)}
      <div className="client-recommendation-actions">
        <button type="button" className="outline-button" onClick={() => setMarcados(disponiveis.map(item => item.ean))}>Selecionar disponíveis</button>
        <button type="button" className="outline-button" onClick={() => setMarcados([])}>Limpar seleção</button>
      </div>
      {dados.sugestoes.length === 0 && <p>Não há recomendações calculáveis neste momento. Confira se existem itens de pedidos faturados e produtos cadastrados.</p>}
      <div className="client-recommendations">
        {dados.sugestoes.map(item => {
          const escolhida = oferta(item)
          const qtd = quantidade(item)
          const semEstoque = !escolhida || escolhida.estoque < qtd
          return <article className="client-recommendation" key={item.ean}>
            <div className="client-recommendation-main">
              <label className="client-rec-select"><input type="checkbox" checked={marcados.includes(item.ean)} disabled={!escolhida} onChange={event => setMarcados(anteriores => event.target.checked ? [...anteriores, item.ean] : anteriores.filter(ean => ean !== item.ean))} aria-label={`Selecionar ${item.produto}`} /></label>
              <div><strong>{item.produto}</strong><small>EAN {item.ean} · {tipos[item.tipo]} · {item.tipo_mix}</small><p>{item.justificativa}</p></div>
            </div>
            <div className="client-recommendation-fields">
              <label>Quantidade
                <input aria-label={`Quantidade de ${item.produto}`} type="number" min="1" max="99999" value={qtd} onChange={event => setQuantidades(prev => ({ ...prev, [item.ean]: Math.max(1, Math.min(99999, Math.round(Number(event.target.value) || 1))) }))} />
              </label>
              <label>Distribuidora para {dados.cliente.uf}
                <select aria-label={`Distribuidora de ${item.produto}`} disabled={!item.ofertas.length} value={escolhida?.distribuidora || ''} onChange={event => setDistribuidoras(prev => ({ ...prev, [item.ean]: event.target.value }))}>
                  {!item.ofertas.length && <option value="">Sem oferta com estoque para esta UF</option>}
                  {item.ofertas.map(op => <option key={op.distribuidora} value={op.distribuidora}>{op.distribuidora} · {money.format(op.preco)} · estoque {integer.format(op.estoque)}</option>)}
                </select>
              </label>
              <div className="client-recommendation-value"><small>Preço unitário</small><strong>{escolhida ? money.format(escolhida.preco) : 'Indisponível'}</strong>{escolhida && <small>Extração: {escolhida.atualizado_em ? new Date(escolhida.atualizado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'data não informada'} · Sujeito à confirmação</small>}{escolhida && <small>{semEstoque ? 'Estoque insuficiente' : `Subtotal: ${money.format(escolhida.preco * qtd)}`}</small>}</div>
            </div>
          </article>
        })}
      </div>
      {aviso && <p className="client-rec-warning" role="alert">{aviso}</p>}
      <div className="client-recommendation-footer"><span>{integer.format(marcados.length)} selecionados · estimativa {money.format(total)}</span><button className="primary-action" type="button" disabled={!selecionados.length} onClick={enviar}>Enviar selecionados ao carrinho do Mercado Farma →</button></div>
      <small>Somente ofertas disponíveis na UF do cliente são elegíveis. Preço e estoque deverão ser confirmados novamente no carrinho antes de gerar o pedido.</small>
    </section>
  </>
}
