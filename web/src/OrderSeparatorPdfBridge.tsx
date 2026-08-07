import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import OrderSeparatorModule from './OrderSeparatorModule'

type PdfTextItem = {
  str: string
  transform: number[]
}

type PositionedItem = {
  text: string
  x: number
  y: number
}

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (source: { data: Uint8Array }) => { promise: Promise<any> }
}

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs'
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs'
const PDF_HEADERS = ['CNPJ', 'Unidade', 'Cód. Barras', 'Produto', 'Fabricante', 'Preço Compra', 'Desc. (%)', 'Qtd.', 'Total']

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const onlyDigits = (value: unknown) => clean(value).replace(/\D/g, '')

function groupLines(items: PositionedItem[], tolerance = 2.5) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Array<{ y: number; items: PositionedItem[] }> = []
  for (const item of sorted) {
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
    .map(line => ({ ...line, items: line.items.sort((a, b) => a.x - b.x) }))
}

function lineText(items: PositionedItem[]) {
  return clean(items.sort((a, b) => a.x - b.x).map(item => item.text).join(' '))
}

function extractPageMetadata(items: PositionedItem[]) {
  const lines = groupLines(items)
  const texts = lines.map(line => lineText([...line.items]))
  const joined = texts.join('\n')
  const cnpjMatch = joined.match(/CNPJ\s*:?\s*((?:\d[.\/-]?){14,18})/i)
  const cnpj = cnpjMatch?.[1] ? clean(cnpjMatch[1]) : ''

  let unidade = ''
  for (const text of texts) {
    const direct = text.match(/\bUnidade\s*:\s*(.*?)(?=\s+CNPJ\s*:|\s+Cotação\s*:|$)/i)
    if (direct?.[1]) {
      unidade = clean(direct[1])
      break
    }
  }
  if (!unidade) {
    for (const text of texts) {
      const business = text.match(/Unidade\s+de\s+Negócio\s*:\s*(.*?)(?=\s+Usuário\s*:|\s+Impressão\s*:|$)/i)
      if (business?.[1]) {
        unidade = clean(business[1])
        break
      }
    }
  }
  return { cnpj, unidade }
}

function joinColumn(items: PositionedItem[]) {
  if (!items.length) return ''
  return groupLines(items, 2.6)
    .map(line => lineText([...line.items]))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+%/g, ' %')
    .trim()
}

function parseTableRows(items: PositionedItem[], width: number, cnpj: string, unidade: string) {
  const eans = items
    .filter(item => item.x < width * 0.17 && /^\d{12,14}$/.test(onlyDigits(item.text)))
    .map(item => ({ ...item, ean: onlyDigits(item.text) }))
    .sort((a, b) => b.y - a.y)

  const rows: string[][] = []
  for (let index = 0; index < eans.length; index += 1) {
    const current = eans[index]
    const previous = eans[index - 1]
    const next = eans[index + 1]
    const upper = previous ? (previous.y + current.y) / 2 : current.y + 10
    const lower = next ? (current.y + next.y) / 2 : current.y - 10
    const block = items.filter(item => item.y <= upper && item.y > lower)

    const product = joinColumn(block.filter(item => item.x >= width * 0.17 && item.x < width * 0.47))
    const manufacturer = joinColumn(block.filter(item => item.x >= width * 0.47 && item.x < width * 0.61))
    const purchasePrice = joinColumn(block.filter(item => item.x >= width * 0.61 && item.x < width * 0.74))
    const discount = joinColumn(block.filter(item => item.x >= width * 0.74 && item.x < width * 0.82))
    const quantity = joinColumn(block.filter(item => item.x >= width * 0.82 && item.x < width * 0.89))
    const total = joinColumn(block.filter(item => item.x >= width * 0.89))

    if (!product || !quantity) continue
    rows.push([cnpj, unidade, current.ean, product, manufacturer, purchasePrice, discount, quantity, total])
  }
  return rows
}

async function readPdfRows(file: File) {
  let pdfjs: PdfJsModule
  try {
    pdfjs = await import(/* @vite-ignore */ PDFJS_URL) as PdfJsModule
  } catch {
    throw new Error('Não foi possível carregar o leitor de PDF. Verifique a conexão e tente novamente.')
  }

  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL
  const data = new Uint8Array(await file.arrayBuffer())
  const document = await pdfjs.getDocument({ data }).promise
  const allRows: string[][] = []
  let lastCnpj = ''
  let lastUnit = ''
  let textItems = 0

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items = (content.items as PdfTextItem[])
      .filter(item => typeof item?.str === 'string' && item.str.trim() && Array.isArray(item.transform))
      .map(item => ({ text: clean(item.str), x: Number(item.transform[4] || 0), y: Number(item.transform[5] || 0) }))
    textItems += items.length
    if (!items.length) continue

    const metadata = extractPageMetadata(items)
    if (metadata.cnpj) lastCnpj = metadata.cnpj
    if (metadata.unidade) lastUnit = metadata.unidade
    allRows.push(...parseTableRows(items, Number(viewport.width || 595), lastCnpj, lastUnit))
  }

  if (!textItems) {
    throw new Error('Este PDF não possui texto selecionável. Use um PDF gerado pelo sistema ou anexe a planilha Excel correspondente.')
  }
  if (!allRows.length) {
    throw new Error('Não encontrei a tabela de produtos no PDF. O PDF precisa conter Código de Barras/EAN, Produto e Quantidade.')
  }
  if (!allRows.some(row => onlyDigits(row[0]).length === 14)) {
    throw new Error('Os produtos foram encontrados, mas não consegui identificar o CNPJ no PDF.')
  }

  return [PDF_HEADERS, ...allRows]
}

function toTsv(rows: string[][]) {
  return rows.map(row => row.map(value => clean(value).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter) setter.call(textarea, value)
  else textarea.value = value
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

function PdfUploadPortal() {
  const [target, setTarget] = useState<Element | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const locate = () => setTarget(document.querySelector('.separator-import-grid'))
    locate()
    const observer = new MutationObserver(locate)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  async function uploadPdf(file: File) {
    setLoading(true)
    setMessage('Lendo PDF e identificando os produtos…')
    try {
      const parsed = await readPdfRows(file)
      const textarea = document.querySelector<HTMLTextAreaElement>('.separator-import-grid textarea')
      if (!textarea) throw new Error('A área de importação não está disponível. Volte à etapa 1 e tente novamente.')
      setNativeTextareaValue(textarea, toTsv(parsed))
      setMessage(`PDF identificado: ${parsed.length - 1} produto(s). Preparando a conferência…`)
      window.setTimeout(() => {
        const button = [...document.querySelectorAll<HTMLButtonElement>('.separator-import-grid button')]
          .find(item => item.textContent?.includes('Usar dados colados'))
        button?.click()
      }, 180)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  if (!target) return null
  return createPortal(
    <article className="separator-upload-card" style={{ gridColumn: '1 / -1' }}>
      <div className="separator-file-icon">PDF</div>
      <h3>Anexar arquivo PDF</h3>
      <p>O sistema identifica CNPJ, código de barras/EAN, produto e quantidade no pedido.</p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        hidden
        onChange={event => {
          const file = event.target.files?.[0]
          if (file) void uploadPdf(file)
        }}
      />
      <button className="separator-dropzone" type="button" disabled={loading} onClick={() => inputRef.current?.click()}>
        <b>{loading ? '…' : '☁'}</b>
        <span>{loading ? 'Lendo o PDF…' : 'Clique para selecionar o PDF'}</span>
      </button>
      <small style={{ display: 'block', marginTop: 10 }}>
        {message || 'PDF com texto selecionável, como o pedido de compra gerado pelo sistema.'}
      </small>
    </article>,
    target,
  )
}

export default function OrderSeparatorPdfBridge({ onBack }: { onBack: () => void }) {
  return (
    <>
      <OrderSeparatorModule onBack={onBack} />
      <PdfUploadPortal />
    </>
  )
}
