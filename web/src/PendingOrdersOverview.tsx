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

// O resumo foi incorporado aos cards expansíveis de cada consultor.
// Mantemos o componente temporariamente para preservar compatibilidade com o dashboard.
export default function PendingOrdersOverview(_props: Props) {
  return null
}
