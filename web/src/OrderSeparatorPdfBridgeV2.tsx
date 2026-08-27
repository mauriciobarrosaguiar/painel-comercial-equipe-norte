import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import OrderSeparatorModule from './OrderSeparatorModule'

type PdfTextItem = { str?: string; transform?: number[] }
type PositionedItem = { text: string; x: number; y: number }
type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (source: { data: Uint8Array }) => { promise: Promise<any> }
}
type ExtractedRow = { ean: string; quantidade: string; descricao: string; codigoInterno: string; cnpj: string; unidade: string; uf: string }
type SourceKey = keyof ExtractedRow
type SourceField = { key: SourceKey; label: string; example: string }
type HeaderInfo = {
  y: number
  eanX: number
  quantidadeX: number
  descricaoX: number
  descricaoFimX: number
  codigoX: number | null
  eanLabel: string
  quantidadeLabel: string
  descricaoLabel: string
  codigoLabel: string
}
type PdfResult = {
  fileName: string
  pages: number
  rows: ExtractedRow[]
  fields: SourceField[]
  cnpjs: string[]
  unidade: string
  uf: string
  warnings: string[]
}

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs'
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs'

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const digits = (value: unknown) => clean(value).replace(/\D/g, '')
const normalize = (value: unknown) => clean(value)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
const formatCnpj = (value: string) => {
  const n = digits(value).slice(0, 14)
  if (n.length !== 14) return value
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`
}

function groupLines(items: PositionedItem[], tolerance = 2.8) {
  const lines: Array<{ y: number; items: PositionedItem[] }> = []
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find(candidate => Math.abs(candidate.y - item.y) <= tolerance)
    if (line) {
      line.items.push(item)
      line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length
    } else {
      lines.push({ y: item.y, items: [item] })
    }
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map(line => ({ ...line, items: [...line.items].sort((a, b) => a.x - b.x) }))
}

function lineText(items: PositionedItem[]) {
  return clean([...items].sort((a, b) => a.x - b.x).map(item => item.text).join(' '))
}

function extractCnpjs(items: PositionedItem[]) {
  const found: string[] = []
  for (const line of groupLines(items)) {
    const text = lineText(line.items)
    for (const match of text.matchAll(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)) {
      const value = digits(match[0])
      if (value.length === 14 && !found.includes(value)) found.push(value)
    }
  }
  return found
}

function extractCnpjEvents(items: PositionedItem[]) {
  const events: Array<{ y: number; cnpj: string }> = []
  for (const line of groupLines(items)) {
    const text = lineText(line.items)
    if (!/\bCNPJ\s*:/i.test(text)) continue
    const match = text.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/)
    const cnpj = digits(match?.[0] || '')
    if (cnpj.length === 14) events.push({ y: line.y, cnpj })
  }
  return events.sort((a, b) => b.y - a.y)
}

function inferUfFromText(value: string) {
  const normalized = ` ${normalize(value)} `
  return ['TO','PA','MT','MA','DF','GO','PI'].find(value => normalized.includes(` ${value} `)) || ''
}

function extractOrderMetadata(items: PositionedItem[], headerY: number) {
  const candidates = groupLines(items)
    .filter(line => line.y > headerY && line.y - headerY < 120)
    .sort((a, b) => a.y - b.y)
  for (const line of candidates) {
    const text = lineText(line.items)
    if (/Unidade\s+de\s+Neg[oó]cio\s*:/i.test(text)) continue
    const match = text.match(/\bUnidade\s*:\s*(.+)$/i)
    if (match?.[1]) {
      const unidade = clean(match[1])
      return { unidade, uf: inferUfFromText(unidade) }
    }
  }
  return { unidade: '', uf: '' }
}

function extractMetadata(items: PositionedItem[]) {
  const lines = groupLines(items).map(line => lineText(line.items))
  let unidade = ''
  let uf = ''
  for (const text of lines) {
    const match = text.match(/\bUnidade(?:\s+de\s+Neg[oó]cio)?\s*:\s*(.*?)(?=\s+Usu[aá]rio\s*:|\s+Impress[aã]o\s*:|\s+CNPJ\s*:|$)/i)
    if (match?.[1]) { unidade = clean(match[1]); break }
  }
  for (const text of lines) {
    const match = text.match(/\bUF\s*:?\s*([A-Z]{2})\b/i)
    if (match?.[1]) { uf = match[1].toUpperCase(); break }
  }
  return { unidade, uf }
}

function findHeader(items: PositionedItem[], width: number): HeaderInfo | null {
  let selected: { y: number; items: PositionedItem[]; score: number } | null = null
  for (const line of groupLines(items)) {
    const text = ` ${normalize(lineText(line.items))} `
    const hasEan = /\bREF\b/.test(text) || /\bEAN\b/.test(text) || text.includes('COD BARRAS') || text.includes('CODIGO BARRAS')
    const hasQty = /\bQUANT\b/.test(text) || /\bQUANTIDADE\b/.test(text) || /\bQTD\b/.test(text) || /\bQTDE\b/.test(text)
    const hasDescription = text.includes('DESCRICAO') || text.includes('PRODUTO')
    const score = (hasEan ? 5 : 0) + (hasQty ? 5 : 0) + (hasDescription ? 3 : 0)
    if (score >= 10 && (!selected || score > selected.score)) selected = { ...line, score }
  }
  if (!selected) return null

  const headerItems = selected.items
  const find = (predicate: (value: string) => boolean) => headerItems.find(item => predicate(normalize(item.text))) || null
  const ref = find(value => value === 'REF' || value.startsWith('REF '))
  const ean = ref || find(value => value === 'EAN' || value.includes('BARRAS') || value === 'COD' || value === 'CODIGO')
  const qty = find(value => value.startsWith('QUANT') || value === 'QTD' || value === 'QTDE')
  const desc = find(value => value.includes('DESCRICAO'))
  if (!ean || !qty) return null

  const productHeaders = headerItems.filter(item => normalize(item.text).includes('PRODUTO'))
  const productAfterEan = productHeaders.find(item => item.x > ean.x + 5) || null
  const productBeforeEan = [...productHeaders].reverse().find(item => item.x < ean.x - 5) || null
  const descriptionHeader = desc || productAfterEan
  const descricaoX = descriptionHeader?.x ?? Math.min(qty.x - width * 0.10, ean.x + width * 0.14)

  // O início visual da descrição costuma ficar bem antes do texto centralizado do cabeçalho "Descrição".
  // Por isso, nunca usamos descricaoX como limite esquerdo da célula; o EAN é a âncora esquerda.
  const afterDescription = headerItems
    .filter(item => item.x > descricaoX + 5)
    .sort((a, b) => a.x - b.x)[0]
  const descricaoFimX = Math.min(qty.x - 3, (afterDescription?.x ?? qty.x) - 3)

  return {
    y: selected.y,
    eanX: ean.x,
    quantidadeX: qty.x,
    descricaoX,
    descricaoFimX,
    codigoX: productBeforeEan?.x ?? null,
    eanLabel: ref ? clean(ref.text) : normalize(lineText(headerItems)).includes('COD BARRAS') ? 'Cód. Barras' : clean(ean.text || 'EAN'),
    quantidadeLabel: clean(qty.text || 'Quantidade'),
    descricaoLabel: clean(descriptionHeader?.text || 'Descrição'),
    codigoLabel: clean(productBeforeEan?.text || 'Produto (código interno)'),
  }
}

function findHeaders(items: PositionedItem[], width: number) {
  const result: HeaderInfo[] = []
  for (const line of groupLines(items)) {
    const text = ` ${normalize(lineText(line.items))} `
    const hasEan = /\bREF\b/.test(text) || /\bEAN\b/.test(text) || text.includes('COD BARRAS') || text.includes('CODIGO BARRAS')
    const hasQty = /\bQUANT\b/.test(text) || /\bQUANTIDADE\b/.test(text) || /\bQTD\b/.test(text) || /\bQTDE\b/.test(text)
    if (!hasEan || !hasQty) continue
    const header = findHeader(line.items, width)
    if (header) result.push(header)
  }
  return result.sort((a, b) => b.y - a.y)
}

function nearestNumeric(items: PositionedItem[], targetX: number) {
  return items
    .filter(item => /^\d+(?:[.,]\d+)?$/.test(clean(item.text)))
    .sort((a, b) => Math.abs(a.x - targetX) - Math.abs(b.x - targetX))[0] || null
}

function joinBlock(items: PositionedItem[]) {
  return groupLines(items, 2.8)
    .map(line => lineText(line.items))
    .filter(Boolean)
    .join(' ')
    .trim()
}

function parseRows(items: PositionedItem[], header: HeaderInfo, width: number, lowerBound = Number.NEGATIVE_INFINITY) {
  const anchors = items
    .filter(item => item.y < header.y - 1 && item.y > lowerBound && /^\d{12,14}$/.test(digits(item.text)))
    .filter(item => Math.abs(item.x - header.eanX) < width * 0.16)
    .map(item => ({ ...item, ean: digits(item.text) }))
    .sort((a, b) => b.y - a.y)

  const rows: ExtractedRow[] = []
  for (let index = 0; index < anchors.length; index += 1) {
    const current = anchors[index]
    const previous = anchors[index - 1]
    const next = anchors[index + 1]
    const typicalGap = previous ? Math.abs(previous.y - current.y) : next ? Math.abs(current.y - next.y) : 15
    const upper = current.y + 5.5
    const naturalLower = next ? next.y + 2 : current.y - Math.max(11, Math.min(26, typicalGap - 1))
    const lower = Math.max(lowerBound, naturalLower)
    const block = items.filter(item => item.y <= upper && item.y > lower)
    const baseline = block.filter(item => Math.abs(item.y - current.y) <= 4)
    const quantity = nearestNumeric(baseline, header.quantidadeX) || nearestNumeric(block, header.quantidadeX)
    if (!quantity) continue

    // Correção principal: a descrição começa logo após a coluna do EAN, e não na posição
    // horizontal do título "Descrição" (que normalmente vem centralizado na célula).
    const descriptionItems = block.filter(item => {
      if (digits(item.text) === current.ean) return false
      return item.x > current.x + 5 && item.x < header.descricaoFimX
    })
    const descricao = joinBlock(descriptionItems)

    let codigoInterno = ''
    if (header.codigoX !== null) {
      const code = nearestNumeric(baseline.filter(item => item.x < current.x - 3), header.codigoX)
      if (code) codigoInterno = clean(code.text)
    }

    rows.push({
      ean: current.ean,
      quantidade: clean(quantity.text),
      descricao,
      codigoInterno,
      cnpj: '',
      unidade: '',
      uf: '',
    })
  }
  return rows
}

function parseFallback(items: PositionedItem[], width: number) {
  const anchors = items
    .filter(item => /^\d{12,14}$/.test(digits(item.text)))
    .map(item => ({ ...item, ean: digits(item.text) }))
    .sort((a, b) => b.y - a.y)
  const rows: ExtractedRow[] = []
  for (let index = 0; index < anchors.length; index += 1) {
    const current = anchors[index]
    const next = anchors[index + 1]
    const block = items.filter(item => item.y <= current.y + 5 && item.y > (next ? next.y + 2 : current.y - 16))
    const numbers = block
      .filter(item => item.x > current.x + 20 && /^\d+(?:[.,]\d+)?$/.test(clean(item.text)))
      .sort((a, b) => a.x - b.x)
    const quantity = numbers[0]
    if (!quantity) continue
    rows.push({
      ean: current.ean,
      quantidade: clean(quantity.text),
      descricao: joinBlock(block.filter(item => item.x > current.x + 8 && item.x < quantity.x - 4)),
      codigoInterno: '',
      cnpj: '',
      unidade: '',
      uf: '',
    })
  }
  return rows
}

async function readPdf(file: File): Promise<PdfResult> {
  let pdfjs: PdfJsModule
  try {
    pdfjs = await import(/* @vite-ignore */ PDFJS_URL) as PdfJsModule
  } catch {
    throw new Error('Não foi possível carregar o leitor de PDF. Verifique a conexão e tente novamente.')
  }
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const rows: ExtractedRow[] = []
  const cnpjs: string[] = []
  const warnings: string[] = []
  let unidade = ''
  let uf = ''
  let activeCnpj = ''
  let activeUnidade = ''
  let activeUf = ''
  let eanLabel = 'EAN / Ref.'
  let quantidadeLabel = 'Quantidade'
  let descricaoLabel = 'Descrição'
  let codigoLabel = 'Produto (código interno)'
  let textCount = 0

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const width = Number(viewport.width || 595)
    const content = await page.getTextContent()
    const items = (content.items as PdfTextItem[])
      .filter(item => typeof item?.str === 'string' && item.str.trim() && Array.isArray(item.transform))
      .map(item => ({ text: clean(item.str), x: Number(item.transform?.[4] || 0), y: Number(item.transform?.[5] || 0) }))
    textCount += items.length
    if (!items.length) continue

    for (const cnpj of extractCnpjs(items)) if (!cnpjs.includes(cnpj)) cnpjs.push(cnpj)
    const meta = extractMetadata(items)
    if (!unidade && meta.unidade) unidade = meta.unidade
    if (!uf && meta.uf) uf = meta.uf

    const events = extractCnpjEvents(items)
    const headers = findHeaders(items, width)

    if (headers.length) {
      for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
        const header = headers[headerIndex]
        eanLabel = header.eanLabel || eanLabel
        quantidadeLabel = header.quantidadeLabel || quantidadeLabel
        descricaoLabel = header.descricaoLabel || descricaoLabel
        codigoLabel = header.codigoLabel || codigoLabel

        const nearestCnpjAbove = events
          .filter(event => event.y > header.y)
          .sort((a, b) => a.y - b.y)[0]
        if (nearestCnpjAbove) activeCnpj = nearestCnpjAbove.cnpj

        const blockMeta = extractOrderMetadata(items, header.y)
        if (blockMeta.unidade) activeUnidade = blockMeta.unidade
        if (blockMeta.uf) activeUf = blockMeta.uf

        const nextHeaderY = headers[headerIndex + 1]?.y ?? Number.NEGATIVE_INFINITY
        const nextCnpjY = events
          .filter(event => event.y < header.y)
          .sort((a, b) => b.y - a.y)[0]?.y ?? Number.NEGATIVE_INFINITY
        const lowerBound = Math.max(nextHeaderY, nextCnpjY)

        const parsedRows = parseRows(items, header, width, lowerBound)
        for (const row of parsedRows) {
          row.cnpj = activeCnpj
          row.unidade = activeUnidade
          row.uf = activeUf
          rows.push(row)
        }
      }
    } else {
      const fallbackRows = parseFallback(items, width)
      for (const row of fallbackRows) {
        row.cnpj = activeCnpj
        row.unidade = activeUnidade
        row.uf = activeUf
        rows.push(row)
      }
      warnings.push(`Página ${pageNumber}: cabeçalho não identificado com segurança. Confira os vínculos.`)
    }

    if (events.length) activeCnpj = events[events.length - 1].cnpj
  }

  if (!textCount) throw new Error('Este PDF não possui texto selecionável.')
  if (!rows.length) throw new Error('Não encontrei linhas de produtos com EAN e quantidade no PDF.')
  if (!cnpjs.length) warnings.push('CNPJ não identificado automaticamente. O pedido poderá seguir sem CNPJ, desde que uma UF seja informada.')
  if (cnpjs.length > 1) warnings.push(`${cnpjs.length} CNPJs encontrados. Os produtos foram separados automaticamente por bloco; páginas de continuação permanecem no último CNPJ até aparecer o próximo.`)
  if (rows.some(row => !row.descricao)) warnings.push('Alguns nomes de produto não foram identificados. Confira a coluna Produto / Descrição antes de confirmar.')
  if (cnpjs.length > 1 && rows.some(row => !row.cnpj)) warnings.push('Algumas linhas ficaram sem CNPJ. Confira a transição entre os blocos do PDF antes de continuar.')

  const first = rows[0]
  const fields: SourceField[] = [
    { key: 'ean', label: eanLabel, example: first?.ean || '' },
    { key: 'quantidade', label: quantidadeLabel, example: first?.quantidade || '' },
    { key: 'descricao', label: descricaoLabel, example: first?.descricao || '' },
  ]
  if (rows.some(row => row.codigoInterno)) fields.push({ key: 'codigoInterno', label: codigoLabel, example: first?.codigoInterno || '' })
  return { fileName: file.name, pages: document.numPages, rows, fields, cnpjs, unidade, uf, warnings }
}

function toTsv(rows: string[][]) {
  return rows.map(row => row.map(value => clean(value).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')
}

function setTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter) setter.call(textarea, value)
  else textarea.value = value
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

function PdfPortal() {
  const [target, setTarget] = useState<Element | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [parsed, setParsed] = useState<PdfResult | null>(null)
  const [eanField, setEanField] = useState<SourceKey>('ean')
  const [qtyField, setQtyField] = useState<SourceKey>('quantidade')
  const [productField, setProductField] = useState<SourceKey>('descricao')
  const [cnpj, setCnpj] = useState('')
  const [unidade, setUnidade] = useState('')
  const [uf, setUf] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const locate = () => setTarget(document.querySelector('.separator-import-grid'))
    locate()
    const observer = new MutationObserver(locate)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  const preview = useMemo(() => parsed?.rows.slice(0, 10) || [], [parsed])
  const multiCnpj = Boolean(parsed && parsed.cnpjs.length > 1 && parsed.rows.some(row => digits(row.cnpj).length === 14))
  const cnpjSummary = useMemo(() => {
    if (!parsed) return []
    const map = new Map<string, number>()
    for (const row of parsed.rows) {
      const key = digits(row.cnpj)
      if (key.length === 14) map.set(key, (map.get(key) || 0) + 1)
    }
    return [...map.entries()].map(([value, count]) => ({ cnpj: value, count }))
  }, [parsed])

  async function upload(file: File) {
    setLoading(true)
    setMessage('Lendo PDF e identificando EAN, descrição e quantidade…')
    setParsed(null)
    try {
      const result = await readPdf(file)
      setParsed(result)
      setCnpj(result.cnpjs[0] || '')
      setUnidade(result.unidade)
      setUf(result.uf)
      setEanField('ean')
      setQtyField('quantidade')
      setProductField('descricao')
      setMessage(`PDF lido: ${result.rows.length} produto(s). Confira os vínculos abaixo.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function confirm() {
    if (!parsed) return
    const hasRowCnpj = parsed.rows.some(row => digits(row.cnpj).length === 14)
    const manualCnpj = digits(cnpj)
    const manualUf = uf.toUpperCase().slice(0, 2)
    if (!hasRowCnpj && manualCnpj && manualCnpj.length !== 14) { setMessage('O CNPJ informado é inválido. Corrija ou deixe em branco para pedido sem CNPJ.'); return }
    if (!hasRowCnpj && !manualCnpj && !/^[A-Z]{2}$/.test(manualUf)) { setMessage('Este PDF não possui CNPJ por bloco. Informe a UF que deverá atender este pedido.'); return }
    const standardized = parsed.rows.map(row => {
      const rowCnpj = digits(row.cnpj)
      const outputCnpj = rowCnpj.length === 14 ? formatCnpj(rowCnpj) : manualCnpj.length === 14 ? formatCnpj(manualCnpj) : ''
      const outputUnidade = clean(row.unidade || unidade)
      const outputUf = clean(row.uf || manualUf).toUpperCase().slice(0, 2)
      return [outputCnpj, outputUnidade, outputUf, clean(row[eanField]), clean(row[productField]), clean(row[qtyField])]
    }).filter(row => digits(row[3]).length >= 8 && Number(String(row[5]).replace(',', '.')) > 0)
    if (!standardized.length) { setMessage('Os vínculos escolhidos não formaram linhas válidas. Revise EAN e Quantidade.'); return }
    const textarea = document.querySelector<HTMLTextAreaElement>('.separator-import-grid textarea')
    if (!textarea) { setMessage('Área de colagem não encontrada. Volte à etapa 1 e tente novamente.'); return }
    setTextarea(textarea, toTsv([['CNPJ', 'Unidade', 'UF', 'EAN', 'Produto', 'Quantidade'], ...standardized]))
    setMessage(`Leitura confirmada: ${standardized.length} produto(s). Abrindo conferência final…`)
    window.setTimeout(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('.separator-import-grid button')]
        .find(item => item.textContent?.includes('Usar dados colados'))
      button?.click()
    }, 160)
  }

  if (!target) return null
  return createPortal(
    <article className="separator-upload-card" style={{ gridColumn: '1 / -1' }}>
      <div className="separator-file-icon">PDF</div>
      <h3>Anexar arquivo PDF</h3>
      <p>O sistema lê o pedido e permite ligar Ref. → EAN, Quant. → Quantidade e Descrição → Produto.</p>
      <input ref={inputRef} type="file" accept=".pdf,application/pdf" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
      <button className="separator-dropzone" type="button" disabled={loading} onClick={() => inputRef.current?.click()}>
        <b>{loading ? '…' : '☁'}</b><span>{loading ? 'Lendo o PDF…' : 'Clique para selecionar o PDF'}</span>
      </button>
      <small style={{ display: 'block', marginTop: 10 }}>{message || 'PDF com texto selecionável.'}</small>

      {parsed && <section style={{ marginTop: 22, textAlign: 'left', borderTop: '1px solid #dce6ed', paddingTop: 18 }}>
        {parsed.warnings.length > 0 && <div className="separator-tip" style={{ display: 'block' }}>
          {parsed.warnings.map(warning => <div key={warning}>⚠ {warning}</div>)}
        </div>}

        {multiCnpj ? <div className="separator-success" style={{ display: 'block', marginTop: 14 }}>
          <b>Separação automática por CNPJ ativada.</b>
          <div style={{ marginTop: 7 }}>{cnpjSummary.map(item => <div key={item.cnpj}>{formatCnpj(item.cnpj)} · {item.count} produto(s)</div>)}</div>
          <small>Quando a lista continua em outra página sem novo CNPJ, ela permanece vinculada ao CNPJ anterior.</small>
        </div> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(180px,1fr))', gap: 12, marginTop: 14 }}>
          <label><b>CNPJ do cliente (opcional)</b>
            {parsed.cnpjs.length > 0 && <select style={{ width: '100%', minHeight: 42, marginTop: 6 }} value={digits(cnpj)} onChange={event => setCnpj(event.target.value)}>
              {parsed.cnpjs.map(value => <option key={value} value={value}>{formatCnpj(value)}</option>)}
            </select>}
            <input style={{ width: '100%', minHeight: 42, marginTop: 6, boxSizing: 'border-box' }} value={cnpj} onChange={event => setCnpj(event.target.value)} placeholder="Digite o CNPJ ou deixe em branco" />
          </label>
          <label><b>Unidade / Loja</b><input style={{ width: '100%', minHeight: 42, marginTop: 6, boxSizing: 'border-box' }} value={unidade} onChange={event => setUnidade(event.target.value)} /></label>
          <label><b>UF do pedido</b><input style={{ width: '100%', minHeight: 42, marginTop: 6, boxSizing: 'border-box' }} maxLength={2} value={uf} onChange={event => setUf(event.target.value.toUpperCase().slice(0, 2))} placeholder="Ex.: MT" /></label>
        </div>}

        <h4 style={{ marginBottom: 8 }}>Ligue as informações do PDF aos campos corretos</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(180px,1fr))', gap: 12 }}>
          <label><b>EAN / Código de barras</b><select style={{ width: '100%', minHeight: 42, marginTop: 6 }} value={eanField} onChange={event => setEanField(event.target.value as SourceKey)}>{parsed.fields.map(field => <option key={field.key} value={field.key}>{field.label} · ex.: {field.example || '—'}</option>)}</select><small>Ex.: Ref. → EAN</small></label>
          <label><b>Quantidade</b><select style={{ width: '100%', minHeight: 42, marginTop: 6 }} value={qtyField} onChange={event => setQtyField(event.target.value as SourceKey)}>{parsed.fields.map(field => <option key={field.key} value={field.key}>{field.label} · ex.: {field.example || '—'}</option>)}</select><small>Ex.: Quant. → Quantidade</small></label>
          <label><b>Produto / Descrição</b><select style={{ width: '100%', minHeight: 42, marginTop: 6 }} value={productField} onChange={event => setProductField(event.target.value as SourceKey)}>{parsed.fields.map(field => <option key={field.key} value={field.key}>{field.label} · ex.: {field.example || '—'}</option>)}</select><small>Ex.: Descrição → Produto</small></label>
        </div>

        <h4 style={{ marginBottom: 8 }}>Prévia da ligação</h4>
        <div className="separator-table-wrap"><table><thead><tr>{multiCnpj && <th>CNPJ</th>}<th>EAN</th><th>Produto</th><th>Quantidade</th></tr></thead><tbody>
          {preview.map((row, index) => <tr key={`${row.ean}-${index}`}>{multiCnpj && <td><b>{digits(row.cnpj).length === 14 ? formatCnpj(row.cnpj) : '—'}</b></td>}<td>{clean(row[eanField]) || '—'}</td><td>{clean(row[productField]) || '—'}</td><td>{clean(row[qtyField]) || '—'}</td></tr>)}
        </tbody></table></div>
        <div className="separator-actions"><button className="separator-secondary" type="button" onClick={() => { setParsed(null); setMessage('Leitura descartada. Selecione outro PDF.') }}>Descartar leitura</button><button className="separator-primary" type="button" onClick={confirm}>Confirmar leitura do PDF</button></div>
      </section>}
    </article>, target,
  )
}

export default function OrderSeparatorPdfBridgeV2({ onBack }: { onBack: () => void }) {
  return <><OrderSeparatorModule onBack={onBack} /><PdfPortal /></>
}
