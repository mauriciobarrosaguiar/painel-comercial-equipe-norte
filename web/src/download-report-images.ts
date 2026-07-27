export type ReportImagePage = {
  name: string
  svg: string
  width: number
  height: number
}

type ReportImagePayload = {
  filename: string
  pages: ReportImagePage[]
}

const encoder = new TextEncoder()

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value: number) {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

function u32(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true)
  return bytes
}

function concat(parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function zip(files: Array<{ name: string; data: Uint8Array }>) {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  const dateTime = dosDateTime()
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = file.data
    const crc = crc32(data)
    const local = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dateTime.time), u16(dateTime.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ])
    localParts.push(local)
    centralParts.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dateTime.time), u16(dateTime.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]))
    offset += local.length
  }

  const central = concat(centralParts)
  return concat([
    ...localParts,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0),
  ])
}

async function svgToPng(page: ReportImagePage) {
  const blob = new Blob([page.svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = page.width
    canvas.height = page.height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('O navegador não conseguiu preparar a imagem.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, page.width, page.height)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Não foi possível converter a imagem.')), 'image/png', 1))
    return new Uint8Array(await png.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function downloadReportImages(query: string) {
  const response = await fetch(`/api/relatorio-imagens?${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(await response.text())
  const payload = await response.json() as ReportImagePayload
  if (!payload.pages?.length) throw new Error('Nenhuma imagem foi gerada para este período.')

  const files: Array<{ name: string; data: Uint8Array }> = []
  for (const page of payload.pages) files.push({ name: page.name, data: await svgToPng(page) })
  const archive = zip(files)
  const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = payload.filename || 'relatorios-painel.zip'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
