import { authorized, json } from '../../_lib/credentials.js'
import { fecharDesafioGigantes } from '../../_lib/desafio-gigantes-historico.js'

const texto = (value) => String(value ?? '').trim()
const mesAnterior = () => {
  const date = new Date()
  date.setUTCMonth(date.getUTCMonth() - 1)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function onRequestPost({ request, env }) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return json({ erro: 'Chave administrativa não configurada.' }, 503)
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Chave administrativa inválida.' }, 401)
  }

  try {
    const body = await request.json().catch(() => ({}))
    const anoMes = texto(body.ano_mes || mesAnterior())
    if (!/^\d{4}-\d{2}$/.test(anoMes)) return json({ erro: 'Mês inválido. Use AAAA-MM.' }, 400)

    const resultado = await fecharDesafioGigantes(env, anoMes)
    return json({ sucesso: true, ano_mes: anoMes, ...resultado })
  } catch (error) {
    return json({
      erro: 'Não foi possível arquivar o Desafio de Gigantes.',
      detalhe: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
