import './sip-pending.css'

export type SipProduct = {
  ean: string
  produto: string
  tipo_mix: string
  quantidade: number
  faturamento: number
  pedidos: number
}

export type SipClient = {
  id: string
  cnpj: string
  nome: string
  cidade: string
  uf: string
  consultor: string
  objetivo: number
  cobertura: number
  gap_80: number
  gap_90: number
  gap_100: number
  ol_total: number
  ol_sem_combate: number
  prioritarios: number
  lancamentos: number
  ultima_compra: string | null
  notas_faturadas: number
  notas_canceladas: number
  notas_a_faturar: number
  valor_a_faturar: number
}

export type SipPendingConsultant = {
  id: string
  nome: string
  setor: string
  pedidos_nao_faturados: number
  valor_nao_faturado: number
}

export type SipGoalSummary = {
  objetivo: number
  realizado: number
  cobertura: number
  gap_80: number
  gap_90: number
  gap_100: number
}

export type SipDetail = {
  sip: { id?: string; nome: string; meta_mes: number }
  periodo: { inicio: string; fim: string }
  totais: {
    clientes_ativos: number
    clientes_com_venda: number
    clientes_sem_venda: number
    pedidos: number
    ol_total: number
    ol_sem_combate: number
    prioritarios: number
    resultado_meta: number
    projecao_ol_sem_combate?: number
    projecao_meta?: number
    notas_faturadas: number
    notas_canceladas: number
    notas_a_faturar: number
    valor_a_faturar: number
  }
  resumo_sip: SipGoalSummary
  clientes: SipClient[]
  produtos: SipProduct[]
  pendentes_por_consultor: SipPendingConsultant[]
  link_exportacao: string
  link_resumo_excel?: string
  link_resumo_pdf?: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
const date = (value: string | null) => value
  ? value.slice(0, 10).split('-').reverse().join('/')
  : 'Sem compra'

export default function SipDetailView({
  detail,
  publicView = false,
}: {
  detail: SipDetail
  publicView?: boolean
}) {
  const totals = detail.totais
  const projection = totals.projecao_ol_sem_combate ?? totals.ol_sem_combate
  const projectionPercent = totals.projecao_meta ?? totals.resultado_meta
  const pendingConsultants = detail.pendentes_por_consultor || []

  return (
    <div className="sip-detail-content">
      <section className="sips-summary sip-detail-summary">
        <article>
          <span>CNPJs com vendas</span>
          <strong>{num.format(totals.clientes_com_venda)}</strong>
          <small>
            {num.format(totals.clientes_ativos)} vinculados · {num.format(totals.clientes_sem_venda)} sem vendas
          </small>
        </article>
        <article className="sip-primary-result">
          <span>OL Sem Combate</span>
          <strong>{money.format(totals.ol_sem_combate)}</strong>
          <small>
            <b>{pct.format(totals.resultado_meta)}% atingido</b> · Meta {money.format(detail.sip.meta_mes)}
          </small>
          <small>Projeção {money.format(projection)} · {pct.format(projectionPercent)}%</small>
        </article>
        <article>
          <span>Notas faturadas</span>
          <strong>{num.format(totals.notas_faturadas)}</strong>
          <small>OL Total {money.format(totals.ol_total)} · {num.format(totals.pedidos)} pedidos</small>
        </article>
        <article>
          <span>Notas canceladas</span>
          <strong>{num.format(totals.notas_canceladas)}</strong>
        </article>
        <article className="sip-pending-summary">
          <span>Pedidos ainda não faturados</span>
          <strong>{num.format(totals.notas_a_faturar)}</strong>
          <small>{money.format(totals.valor_a_faturar || 0)}</small>
        </article>
      </section>

      <section className="sip-pending-list">
        <div className="sips-heading">
          <div>
            <h2>Não faturados por consultor</h2>
            <small>Atendidos, atendidos parcialmente ou enviados no período</small>
          </div>
          <strong>{money.format(totals.valor_a_faturar || 0)}</strong>
        </div>
        {pendingConsultants.length ? pendingConsultants.map((item) => (
          <article key={item.id}>
            <div>
              <strong>{item.nome}</strong>
              <small>{item.setor ? `Setor ${item.setor}` : 'Setor não informado'}</small>
            </div>
            <div>
              <span>Pedidos/notas</span>
              <b>{num.format(item.pedidos_nao_faturados)}</b>
            </div>
            <div>
              <span>Valor sem imposto</span>
              <b>{money.format(item.valor_nao_faturado)}</b>
            </div>
          </article>
        )) : (
          <p className="sips-empty">Nenhum pedido ainda não faturado neste período.</p>
        )}
      </section>

      <section className="sip-client-list">
        <h2>Resultado por cliente</h2>
        {detail.clientes.map((client) => (
          <article key={client.id || client.cnpj}>
            <div>
              <strong>{client.nome}</strong>
              <small>
                {publicView ? '' : `${client.cnpj} · `}
                {client.cidade}/{client.uf} · {client.consultor || 'Sem consultor'}
              </small>
            </div>
            <div>
              <span>OL Sem Combate</span>
              <b>{money.format(client.ol_sem_combate || 0)}</b>
              <small>OL Total {money.format(client.ol_total)}</small>
            </div>
            <div>
              <span>Notas</span>
              <b>{num.format(client.notas_faturadas)} faturadas</b>
              <small>
                {num.format(client.notas_canceladas)} canceladas · {num.format(client.notas_a_faturar)} a faturar
              </small>
              {client.notas_a_faturar > 0 && (
                <small>{money.format(client.valor_a_faturar || 0)} ainda não faturado</small>
              )}
            </div>
            <div>
              <span>Prioritários</span>
              <b>{money.format(client.prioritarios)}</b>
            </div>
            <div>
              <span>Lançamentos</span>
              <b>{money.format(client.lancamentos)}</b>
            </div>
            <div>
              <span>Última compra</span>
              <b>{date(client.ultima_compra)}</b>
            </div>
          </article>
        ))}
      </section>

      <section className="sip-product-list">
        <div className="sips-heading">
          <h2>Resultado por produto</h2>
          <span>{detail.produtos.length} produtos</span>
        </div>
        {detail.produtos.map((item) => (
          <article key={`${item.ean}-${item.produto}`}>
            <div>
              <strong>{item.produto}</strong>
              <small>{item.ean} · {item.tipo_mix}</small>
            </div>
            <div>
              <span>Quantidade</span>
              <b>{num.format(item.quantidade)}</b>
            </div>
            <div>
              <span>Pedidos</span>
              <b>{num.format(item.pedidos)}</b>
            </div>
            <div>
              <span>Faturamento</span>
              <b>{money.format(item.faturamento)}</b>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
