import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequestGet as consultarExcel } from '../functions/api/consultores/resumo-excel.js'
import { onRequestGet as sipExcel } from '../functions/api/sips/resumo-geral-excel.js'
import { testDatabase } from './d1-fixture.js'

const ADMIN_KEY = 'chave-teste-segura-123'
const decoder = new TextDecoder()

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function unzipStored(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = new Map()
  let offset = 0
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true)
    const expectedCrc = view.getUint32(offset + 14, true)
    const compressedSize = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    assert.equal(method, 0, 'O XLSX deve usar entradas ZIP armazenadas sem compressão.')
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength))
    const data = bytes.subarray(dataStart, dataStart + compressedSize)
    assert.equal(crc32(data), expectedCrc, `CRC inválido em ${name}`)
    entries.set(name, data)
    offset = dataStart + compressedSize
  }
  return entries
}

async function validar(endpoint, url, nomeEsperado) {
  const response = await endpoint({
    request: new Request(url, { headers: { 'x-admin-key': ADMIN_KEY } }),
    env: { DB: testDatabase(), PAINEL_ADMIN_KEY: ADMIN_KEY },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /spreadsheetml\.sheet/)
  assert.match(response.headers.get('content-disposition') || '', new RegExp(nomeEsperado))

  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.equal(bytes[0], 0x50)
  assert.equal(bytes[1], 0x4b)
  const entries = unzipStored(bytes)
  for (const name of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
  ]) assert.ok(entries.has(name), `Entrada obrigatória ausente: ${name}`)

  const styles = decoder.decode(entries.get('xl/styles.xml'))
  const sheet = decoder.decode(entries.get('xl/worksheets/sheet1.xml'))
  assert.match(styles, /formatCode="&quot;R\$&quot; #,##0\.00;\[Red\]-&quot;R\$&quot; #,##0\.00"/)
  assert.doesNotMatch(styles, /formatCode="R\$/)
  assert.doesNotMatch(sheet, /<autoFilter/)
  assert.match(sheet, /^<\?xml[\s\S]*<worksheet[\s\S]*<\/worksheet>$/)
  for (const match of sheet.matchAll(/<c r="([^"]+)"/g)) {
    assert.match(match[1], /^[A-Z]+[1-9]\d*$/, `Referência de célula inválida: ${match[1]}`)
  }
}

test('Excel consolidado das SIPs possui pacote e formatos válidos', async () => {
  await validar(
    sipExcel,
    'https://painel.local/api/sips/resumo-geral-excel?inicio=2026-07-01&fim=2026-07-31',
    'resumo-sips-2026-07\\.xlsx',
  )
})

test('Excel dos consultores possui pacote e formatos válidos', async () => {
  await validar(
    consultarExcel,
    'https://painel.local/api/consultores/resumo-excel?periodo=personalizado&inicio=2026-07-01&fim=2026-07-31',
    'desempenho-consultores-2026-07\\.xlsx',
  )
})
