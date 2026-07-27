import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('exportação final usa arquivos PNG e não SVG dentro do ZIP', () => {
  const converter = read('src/download-report-images.ts')
  assert.match(converter, /image\/png/)
  assert.ok(converter.includes("replace(/\\.(svg|html?)$/i, '.png')"))
  assert.match(converter, /files\.push\(\{ name: pngName/)
  assert.match(converter, /new Blob\(\[archiveBuffer\], \{ type: 'application\/zip' \}\)/)
  assert.doesNotMatch(converter, /name: String\(page\.name.*\.svg/)
})
