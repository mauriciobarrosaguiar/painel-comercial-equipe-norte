import './pending-orders.css'

type PendingConsultant = {
  id: string
  nome: string
  setor: string
  pedidos_nao_faturados: number
  valor_nao_faturado: number
}

type Props = {
  loading: boolean
  orders: number
  value: number
  rows: PendingConsultant[]
  filter: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const num = new Intl.NumberFormat('pt-BR')

export default function PendingOrdersOverview({ loading, orders, value, rows, filter }: Props) {
  return (
    <section className="pending-orders-overview">
      <div className="pending-orders-heading">
        <div>
          <span>Pedidos ainda não faturados</span>
          <small>{filter}</small>
        </div>
        <div>
          <strong>{loading ? '—' : num.format(orders)}</strong>
          <span>pedidos/notas</span>
        </div>
        <div>
          <strong>{loading ? '—' : money.format(value)}</strong>
          <span>valor sem imposto</span>
        </div>
      </div>
      {!loading && (
        <div className="pending-consultants">
          {rows.length ? rows.map((item) => (
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
                <span>Valor</span>
                <b>{money.format(item.valor_nao_faturado)}</b>
              </div>
            </article>
          )) : (
            <p>Nenhum pedido ainda não faturado neste período.</p>
          )}
        </div>
      )}
    </section>
  )
}
