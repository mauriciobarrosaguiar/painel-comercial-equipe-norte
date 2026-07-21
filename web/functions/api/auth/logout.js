import { clearSessionCookie, json } from '../../_lib/credentials.js'

export async function onRequestPost() {
  return json({ sucesso: true }, 200, { 'set-cookie': clearSessionCookie() })
}
