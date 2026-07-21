const encoder = new TextEncoder()
const decoder = new TextDecoder()
const VERSION = 'v1'
const CONTEXT = 'painel-equipe-norte:bussola-credentials:v1'
const SESSION_CONTEXT = 'painel-equipe-norte:session:v1'
const SESSION_COOKIE = 'painel_session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 7

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
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value) {
  const normal = String(value || '').replaceAll('-', '+').replaceAll('_', '/')
  const padded = normal + '='.repeat((4 - normal.length % 4) % 4)
  return base64ToBytes(padded)
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function deriveEncryptionKey(secret) {
  const rawKey = await sha256(`${CONTEXT}:encryption:${secret}`)
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function signSession(value, secret) {
  const rawKey = await sha256(`${SESSION_CONTEXT}:${secret}`)
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

function cookieValue(request, name) {
  const cookie = request.headers.get('cookie') || ''
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return ''
}

export async function encryptCredentials(payload, secret) {
  const key = await deriveEncryptionKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(payload))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  return [VERSION, bytesToBase64(iv), bytesToBase64(ciphertext)].join('.')
}

export async function decryptCredentials(value, secret) {
  const [version, ivBase64, ciphertextBase64] = String(value || '').split('.')
  if (version !== VERSION || !ivBase64 || !ciphertextBase64) throw new Error('Formato de credencial inválido.')
  const key = await deriveEncryptionKey(secret)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(ivBase64) }, key, base64ToBytes(ciphertextBase64))
  return JSON.parse(decoder.decode(plaintext))
}

export async function createSessionToken(user, secret, maxAge = SESSION_MAX_AGE) {
  const payload = {
    login: String(user.login || ''),
    nome: String(user.nome || ''),
    consultor_id: String(user.consultor_id || ''),
    exp: Math.floor(Date.now() / 1000) + maxAge,
  }
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)))
  const signature = bytesToBase64Url(await signSession(body, secret))
  return `${body}.${signature}`
}

export async function readSession(request, secret) {
  if (!secret) return null
  const token = cookieValue(request, SESSION_COOKIE)
  const [body, signature] = String(token || '').split('.')
  if (!body || !signature) return null
  try {
    const expected = await signSession(body, secret)
    const supplied = base64UrlToBytes(signature)
    if (!equalBytes(expected, supplied)) return null
    const payload = JSON.parse(decoder.decode(base64UrlToBytes(body)))
    if (!payload?.login || Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function sessionCookie(token, maxAge = SESSION_MAX_AGE) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export async function authorized(request, secret) {
  if (!secret) return false
  if (await readSession(request, secret)) return true
  const supplied = request.headers.get('x-admin-key') || ''
  if (!supplied) return false
  const [expectedHash, suppliedHash] = await Promise.all([
    sha256(`${CONTEXT}:auth:${secret}`),
    sha256(`${CONTEXT}:auth:${supplied}`),
  ])
  return equalBytes(expectedHash, suppliedHash)
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

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  })
}
