export const MAURICIO_ID = 'cons-1ee6626b98906f06c399a6ad350c'
export const MAURICIO_NOME = 'MAURICIO BARROS DE AGUIAR'
export const MAURICIO_LOGIN = 'm0043497'

export async function enforcePersonalScope(env) {
  if (!env?.DB) return
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE clientes
         SET carteira_importada=0,
             ativo=0
       WHERE COALESCE(consultor_id,'')<>?
         AND (COALESCE(carteira_importada,0)<>0 OR COALESCE(ativo,0)<>0)
    `).bind(MAURICIO_ID),
    env.DB.prepare(`
      UPDATE consultores
         SET ativo=0
       WHERE id<>?
         AND COALESCE(ativo,0)<>0
    `).bind(MAURICIO_ID),
    env.DB.prepare(`
      UPDATE itens_pedido
         SET ativo=0
       WHERE COALESCE(ativo,0)<>0
         AND pedido_id IN (
           SELECT id FROM pedidos
            WHERE COALESCE(consultor_id,'')<>?
         )
    `).bind(MAURICIO_ID),
    env.DB.prepare(`
      UPDATE pedidos
         SET ativo=0
       WHERE COALESCE(ativo,0)<>0
         AND COALESCE(consultor_id,'')<>?
    `).bind(MAURICIO_ID),
    env.DB.prepare(`
      DELETE FROM metas
       WHERE consultor_id IS NOT NULL
         AND consultor_id<>?
    `).bind(MAURICIO_ID),
  ])
}
