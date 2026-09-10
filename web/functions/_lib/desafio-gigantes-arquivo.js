const texto = (value) => String(value ?? '').trim()
const CHUNK_SIZE = 240000
const MAX_BASE64 = 28 * 1024 * 1024

export async function salvarArquivoDesafioGigantes(env, payload) {
  const anoMes = texto(payload?.ano_mes)
  const nomeArquivo = texto(payload?.nome_arquivo) || `desafio-gigantes-${anoMes}.xlsx`
  const mimeType = texto(payload?.mime_type) || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const base64 = texto(payload?.arquivo_base64)
  const tamanhoBytes = Number(payload?.tamanho_bytes || 0)

  if (!/^\d{4}-\d{2}$/.test(anoMes) || !base64) return { salvo: false }
  if (base64.length > MAX_BASE64) throw new Error('O arquivo original excede o limite de armazenamento do painel.')

  const chunks = []
  for (let index = 0; index < base64.length; index += CHUNK_SIZE) {
    chunks.push(base64.slice(index, index + CHUNK_SIZE))
  }

  const agora = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM desafio_gigantes_arquivo_chunks WHERE ano_mes=?').bind(anoMes),
    env.DB.prepare(`
      INSERT INTO desafio_gigantes_arquivos(ano_mes,nome_arquivo,mime_type,tamanho_bytes,total_chunks,importado_em)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(ano_mes) DO UPDATE SET
        nome_arquivo=excluded.nome_arquivo,
        mime_type=excluded.mime_type,
        tamanho_bytes=excluded.tamanho_bytes,
        total_chunks=excluded.total_chunks,
        importado_em=excluded.importado_em
    `).bind(anoMes, nomeArquivo, mimeType, tamanhoBytes, chunks.length, agora),
  ])

  for (let offset = 0; offset < chunks.length; offset += 40) {
    const statements = chunks.slice(offset, offset + 40).map((chunk, localIndex) => env.DB.prepare(`
      INSERT INTO desafio_gigantes_arquivo_chunks(ano_mes,indice,conteudo_base64)
      VALUES(?,?,?)
      ON CONFLICT(ano_mes,indice) DO UPDATE SET conteudo_base64=excluded.conteudo_base64
    `).bind(anoMes, offset + localIndex, chunk))
    await env.DB.batch(statements)
  }

  return { salvo: true, total_chunks: chunks.length }
}

export async function obterArquivoDesafioGigantes(env, anoMes) {
  const info = await env.DB.prepare(`
    SELECT ano_mes,nome_arquivo,mime_type,tamanho_bytes,total_chunks,importado_em
      FROM desafio_gigantes_arquivos
     WHERE ano_mes=?
     LIMIT 1
  `).bind(anoMes).first()
  if (!info?.ano_mes) return null

  const result = await env.DB.prepare(`
    SELECT indice,conteudo_base64
      FROM desafio_gigantes_arquivo_chunks
     WHERE ano_mes=?
     ORDER BY indice
  `).bind(anoMes).all()
  const chunks = result.results || []
  if (!chunks.length || chunks.length !== Number(info.total_chunks || 0)) return null

  const base64 = chunks.map((item) => String(item.conteudo_base64 || '')).join('')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return { ...info, bytes }
}
