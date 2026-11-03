import './daily-goal.css'

export type DailyGoalData = {
  ativa: boolean; sem_meta: boolean; atingida: boolean; valor: number | null; falta: number;
  dias_uteis_restantes: number; inclui_hoje: boolean; faltas: Record<string, number>
}
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export default function DailyGoal({ goal, showGaps = false }: { goal?: DailyGoalData; showGaps?: boolean }) {
  if (!goal?.ativa) return null
  return <div className="daily-goal">
    <div><span>Meta diária</span><strong>{goal.sem_meta ? 'Sem meta cadastrada' : goal.atingida ? 'Atingida ✓' : goal.valor === null ? 'Sem dias úteis restantes' : `${money.format(goal.valor)}/dia`}</strong></div>
    {!goal.sem_meta && !goal.atingida && <small>Faltam {money.format(goal.falta)} · {goal.dias_uteis_restantes} dias úteis restantes{goal.inclui_hoje ? ', incluindo hoje' : ''}.</small>}
    {showGaps && !goal.sem_meta && <div className="daily-goal-gaps">{[80, 90, 100].map(n => <span key={n}>{n}%: {goal.faltas[n] > 0 ? `falta ${money.format(goal.faltas[n])}` : 'atingido ✓'}</span>)}</div>}
  </div>
}
