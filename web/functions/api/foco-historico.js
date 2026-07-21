import { json } from '../_lib/credentials.js'
import { arquivarPeriodosEncerrados, listarHistoricosFoco } from '../_lib/focus-history.js'

export async function onRequestGet({ env }) {
  try {
    await arquivarPeriodosEncerrados(env)
    const historicos = await listarHistoricosFoco(env)
    return json({ historicos })
  } catch (error) {
    return json({
      erro: 'Não foi possível carregar o histórico do Foco Semanal.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
