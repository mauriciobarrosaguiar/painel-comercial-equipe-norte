import { readSession, json } from '../_lib/credentials.js'
import { categoriaFarmaceutica } from '../_lib/classificacao-farmaceutica.js'

const eanNormalizado = value => String(value ?? '').replace(/\D/g, '')

export async function onRequestPost({ request, env }) {
  const origem = request.headers.get('origin')
  if (origem && origem !== new URL(request.url).origin) return json({ erro: 'Origem não autorizada.' }, 403)
  const session = await readSession(request, env.PAINEL_ADMIN_KEY)
  if (!session?.login || !session?.consultor_id) return json({ erro: 'Acesso autenticado necessário.' }, 401)
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ erro: 'Envie JSON.' }, 415)

  let body
  try { body = await request.json() } catch { return json({ erro: 'JSON inválido.' }, 400) }
  const items = Array.isArray(body?.itens) ? body.itens : []
  if (!items.length || items.length > 500) return json({ erro: 'Informe de 1 a 500 classificações por envio.' }, 400)

  const unicos = new Map()
  for (const item of items) {
    const ean = eanNormalizado(item?.ean)
    const categoria = categoriaFarmaceutica(item?.categoria)
    const fonte = String(item?.fonte || 'CONFERENCIA_MANUAL').trim().slice(0, 200)
    if (!/^\d{8,14}$/.test(ean) || !categoria || !fonte) {
      return json({ erro: 'Cada item deve ter EAN válido, categoria reconhecida e fonte.' }, 400)
    }
    if (unicos.has(ean) && unicos.get(ean).categoria !== categoria) {
      return json({ erro: `EAN ${ean} possui classificações conflitantes no mesmo envio.` }, 400)
    }
    unicos.set(ean, { ean, categoria, fonte })
  }
  const agora = new Date().toISOString()
  try {
    const registros = [...unicos.values()]
    for (let offset = 0; offset < registros.length; offset += 50) {
      await env.DB.batch(registros.slice(offset, offset + 50).map(item =>
        env.DB.prepare(`
          INSERT INTO produto_classificacao_farmaceutica(ean,categoria,fonte,atualizado_por,atualizado_em)
          VALUES(?,?,?,?,?)
          ON CONFLICT(ean) DO UPDATE SET categoria=excluded.categoria,
          fonte=excluded.fonte,atualizado_por=excluded.atualizado_por,atualizado_em=excluded.atualizado_em
        `).bind(item.ean, item.categoria, item.fonte, session.login, agora)
      ))
    }
    return json({ sucesso: true, atualizados: unicos.size })
  } catch (error) {
    return json({ erro: 'Falha ao salvar classificação. Verifique a migração do banco.', detalhe: String(error) }, 500)
  }
}
