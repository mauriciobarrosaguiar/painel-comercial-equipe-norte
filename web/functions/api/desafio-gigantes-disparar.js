import { authorized, json } from '../_lib/credentials.js'

const REPO = 'mauriciobarrosaguiar/painel-comercial-equipe-norte'
const WORKFLOW = 'desafio-gigantes-sap.yml'

export async function onRequestPost({ request, env }) {
  if (typeof env.PAINEL_ADMIN_KEY !== 'string' || env.PAINEL_ADMIN_KEY.length < 12) {
    return json({ erro: 'Chave administrativa não configurada.' }, 503)
  }
  if (!(await authorized(request, env.PAINEL_ADMIN_KEY))) {
    return json({ erro: 'Acesso não autorizado.' }, 401)
  }
  const token = String(env.GITHUB_ACTIONS_TOKEN || '').trim()
  if (token.length < 20) {
    return json({ erro: 'Disparo imediato do GitHub Actions não configurado.' }, 503)
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'painel-equipe-norte',
      },
      body: JSON.stringify({ ref: 'main' }),
    })
    if (response.status !== 204) {
      const detalhe = (await response.text().catch(() => '')).slice(0, 600)
      return json({ erro: 'GitHub recusou o disparo da identificação SAP.', detalhe, status: response.status }, 502)
    }
    return json({ sucesso: true, status: 'acionada', mensagem: 'Verificação SAP no Mercado Farma acionada.' }, 202)
  } catch (error) {
    return json({ erro: 'Não foi possível acionar a identificação SAP.', detalhe: error instanceof Error ? error.message : String(error) }, 500)
  }
}
