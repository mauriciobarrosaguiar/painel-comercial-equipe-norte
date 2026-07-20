const encoder = new TextEncoder()
const decoder = new TextDecoder()
const VERSION = 'v1'
const CONTEXT = 'painel-equipe-norte:bussola-credentials:v1'

function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function deriveEncryptionKey(secret) {
  const rawKey = await sha256(`${CONTEXT}:encryption:${secret}`)
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptCredentials(payload, secret) {
  const key = await deriveEncryptionKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(payload))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  )
  return [VERSION, bytesToBase64(iv), bytesToBase64(ciphertext)].join('.')
}

export async function decryptCredentials(value, secret) {
  const [version, ivBase64, ciphertextBase64] = String(value || '').split('.')
  if (version !== VERSION || !ivBase64 || !ciphertextBase64) {
    throw new Error('Formato de credencial inválido.')
  }
  const key = await deriveEncryptionKey(secret)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivBase64) },
    key,
    base64ToBytes(ciphertextBase64),
  )
  return JSON.parse(decoder.decode(plaintext))
}

export async function authorized(request, secret) {
  if (!secret) return false
  const supplied = request.headers.get('x-admin-key') || ''
  if (!supplied) return false
  const [expectedHash, suppliedHash] = await Promise.all([
    sha256(`${CONTEXT}:auth:${secret}`),
    sha256(`${CONTEXT}:auth:${supplied}`),
  ])
  let difference = 0
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= expectedHash[index] ^ suppliedHash[index]
  }
  return difference === 0
}

export function maskUsername(username) {
  const value = String(username || '').trim()
  if (!value) return ''
  if (value.includes('@')) {
    const [name, domain] = value.split('@')
    const visible = name.slice(0, Math.min(3, name.length))
    return `${visible}${'*'.repeat(Math.max(3, name.length - visible.length))}@${domain}`
  }
  if (value.length <= 4) return `${value[0] || ''}***`
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(3, value.length - 5))}${value.slice(-2)}`
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
