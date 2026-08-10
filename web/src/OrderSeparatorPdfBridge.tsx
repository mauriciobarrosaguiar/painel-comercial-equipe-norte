import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import OrderSeparatorModule from './OrderSeparatorModule'
import './order-separator-pdf.css'

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

type SourceKey = 'ean_detectado' | 'quant_detectada' | 'descricao_detectada' | 'codigo_interno'

type ExtractedRow = Record<SourceKey, string>

type SourceField = {
  key: SourceKey
  label: string
  example: string
}

type PdfReadResult = {
  fileName: string
  pages: number
  rows: ExtractedRow[]
  fields: SourceField[]
  cnpjCandidates: string[]
  unidade: string
  uf: string
  confidence: 'alta' | 'revisar'
  warnings: string[]
}

type PdfMapping = {
  ean: SourceKey
  quantidade: SourceKey
  produto: SourceKey | ''
}

type HeaderDetection = {
  y: number
  eanX: number
  qtyX: number
  descriptionX: number
  codeX: number | null
  eanLabel: string
  qtyLabel: string
  descriptionLabel: string
  codeLabel: string
  confident: boolean
}

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs'
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs'

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const onlyDigits = (value: unknown) => clean(value).replace(/\D/g, '')
const normalize = (value: unknown) => clean(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim()

function formatCnpj(value: string) {
  const digits = onlyDigits(value).slice(0, 14)
  if (digits.length !== 14) return value
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
}

function groupLines(items: PositionedItem[], tolerance = 2.8) {
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
  return clean([...items].sort((a, b) => a.x - b.x).map(item => item.text).join(' '))
}

function extractCnpjCandidates(items: PositionedItem[]) {
  const candidates: string[] = []
  const add = (value: string) => {
    const digits = onlyDigits(value)
    if (digits.length === 14 && !candidates.includes(digits)) candidates.push(digits)
  }

  for (const line of groupLines(items)) {
    const text = lineText(line.items)
    for (const match of text.matchAll(/(?:\d[\s.\/-]*){14}/g)) add(match[0])
  }
  return candidates
}

function extractMetadata(items: PositionedItem[]) {
  const texts = groupLines(items).map(line => lineText(line.items))
  let unidade = ''
  let uf = ''

  for (const text of texts) {
    const direct = text.match(/\bUnidade(?:\s+de\s+Neg[oó]cio)?\s*:\s*(.*?)(?=\s+Usu[aá]rio\s*:|\s+Impress[aã]o\s*:|\s+CNPJ\s*:|$)/i)
    if (direct?.[1]) {
      unidade = clean(direct[1])
      break
    }
  }

  for (const text of texts) {
    const directUf = text.match(/\bUF\s*:?\s*([A-Z]{2})\b/i)
    if (directUf?.[1]) {
      uf = directUf[1].toUpperCase()
      break
    }
  }

  return { unidade, uf }
}

function findItem(items: PositionedItem[], predicate: (normalized: string) => boolean) {
  return items.find(item => predicate(normalize(item.text))) || null
}

function detectHeader(items: PositionedItem[], width: number): HeaderDetection | null {
  const lines = groupLines(items)
  let best: { line: { y: number; items: PositionedItem[] }; score: number } | null = null

  for (const line of lines) {
    const text = ` ${normalize(lineText(line.items))} `
    const hasEan = /\bREF\b/.test(text) || /\bEAN\b/.test(text) || text.includes('COD BARRAS') || text.includes('CODIGO BARRAS')
    const hasQty = /\bQUANT\b/.test(text) || /\bQUANTIDADE\b/.test(text) || /\bQTD\b/.test(text) || /\bQTDE\b/.test(text)
    const hasDescription = text.includes('DESCRICAO') || text.includes('PRODUTO')
    const score = (hasEan ? 4 : 0) + (hasQty ? 4 : 0) + (hasDescription ? 2 : 0)
    if (score >= 8 && (!best || score > best.score)) best = { line, score }
  }

  if (!best) return null
  const headerItems = best.line.items
  const headerText = ` ${normalize(lineText(headerItems))} `

  const refItem = findItem(headerItems, value => value === 'REF' || value.startsWith('REF '))
  const eanItem = refItem || findItem(headerItems, value => value === 'EAN' || value.includes('BARRAS') || value === 'COD' || value === 'CODIGO')
  const qtyItem = findItem(headerItems, value => value.startsWith('QUANT') || value === 'QTD' || value === 'QTDE')
  const descriptionItem = findItem(headerItems, value => value.includes('DESCRICAO'))

  let eanX = eanItem?.x ?? width * 0.16
  if (!refItem && (headerText.includes('COD BARRAS') || headerText.includes('CODIGO BARRAS'))) {
    const codItems = headerItems.filter(item => {
      const value = normalize(item.text)
      return value === 'COD' || value === 'CODIGO' || value.includes('BARRAS')
    })
    if (codItems.length) eanX = Math.min(...codItems.map(item => item.x))
  }
  const qtyX = qtyItem?.x ?? width * 0.80

  const productItems = headerItems.filter(item => normalize(item.text).includes('PRODUTO'))
  const productAfterEan = productItems.find(item => item.x > eanX + 5) || null
  const productBeforeEan = [...productItems].reverse().find(item => item.x < eanX - 5) || null
  const descriptionX = descriptionItem?.x ?? productAfterEan?.x ?? Math.min(qtyX - width * 0.10, eanX + width * 0.14)

  const eanLabel = refItem ? clean(refItem.text) : headerText.includes('COD BARRAS') || headerText.includes('CODIGO BARRAS') ? 'Cód. Barras' : clean(eanItem?.text || 'EAN / Ref.')
  const qtyLabel = headerText.includes('QUANT') ? 'Quant.' : clean(qtyItem?.text || 'Qtd.')
  const descriptionLabel = clean(descriptionItem?.text || productAfterEan?.text || 'Produto / Descrição')
  const codeLabel = clean(productBeforeEan?.text || 'Produto (código interno)')

  return {
    y: best.line.y,
    eanX,
    qtyX,
    descriptionX,
    codeX: productBeforeEan?.x ?? null,
    eanLabel,
    qtyLabel,
    descriptionLabel,
    codeLabel,
    confident: Boolean(eanItem && qtyItem),
  }
}

function nearestNumeric(items: PositionedItem[], x: number) {
  const candidates = items.filter(item => /^\d+(?:[.,]\d+)?$/.test(clean(item.text)))
  return [...candidates].sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0] || null
}

function joinBlock(items: PositionedItem[]) {
  if (!items.length) return ''
  return groupLines(items, 2.8)
    .map(line => lineText(line.items))
    .filter(Boolean)
    .join(' ')
    .trim()
}

function parseRowsWithHeader(items: PositionedItem[], header: HeaderDetection, width: number) {
  const eans = items
    .filter(item => item.y < header.y - 1 && /^\d{12,14}$/.test(onlyDigits(item.text)))
    .map(item => ({ ...item, digits: onlyDigits(item.text) }))
    .sort((a, b) => b.y - a.y)

  const rows: ExtractedRow[] = []
  for (let index = 0; index < eans.length; index += 1) {
    const current = eans[index]
    const previous = eans[index - 1]
    const next = eans[index + 1]
    const upper = previous ? (previous.y + current.y) / 2 : current.y + 9
    const lower = next ? (current.y + next.y) / 2 : current.y - 9
    const block = items.filter(item => item.y <= upper && item.y > lower)
    const baseline = block.filter(item => Math.abs(item.y - current.y) <= 3.6)
    const quantityItem = nearestNumeric(baseline, header.qtyX) || nearestNumeric(block, header.qtyX)
    if (!quantityItem) continue

    const descriptionStart = Math.min(header.descriptionX, header.qtyX - 12)
    const description = joinBlock(block.filter(item => item.x >= descriptionStart - 4 && item.x < header.qtyX - 4 && onlyDigits(item.text) !== current.digits))

    let internalCode = ''
    if (header.codeX !== null) {
      const codeItem = nearestNumeric(baseline.filter(item => item.x < header.eanX - 3), header.codeX)
      if (codeItem) internalCode = clean(codeItem.text)
    }

    rows.push({
      ean_detectado: current.digits,
      quant_detectada: clean(quantityItem.text),
      descricao_detectada: description,
      codigo_interno: internalCode,
    })
  }
  return rows
}

function parseRowsFallback(items: PositionedItem[], width: number) {
  const eans = items
    .filter(item => /^\d{12,14}$/.test(onlyDigits(item.text)))
    .map(item => ({ ...item, digits: onlyDigits(item.text) }))
    .sort((a, b) => b.y - a.y)

  const rows: ExtractedRow[] = []
  for (const current of eans) {
    const sameLine = items.filter(item => Math.abs(item.y - current.y) <= 3.5)
    const rightNumbers = sameLine
      .filter(item => item.x > current.x + 30 && item.x < current.x + width * 0.72 && /^\d+(?:[.,]\d+)?$/.test(clean(item.text)))
      .sort((a, b) => a.x - b.x)
    const quantity = rightNumbers[0]
    if (!quantity) continue
    const description = joinBlock(sameLine.filter(item => item.x > current.x + 10 && item.x < quantity.x - 4))
    rows.push({
      ean_detectado: current.digits,
      quant_detectada: clean(quantity.text),
      descricao_detectada: description,
      codigo_interno: '',
    })
  }
  return rows
}

async function readPdf(file: File): Promise<PdfReadResult> {
  let pdfjs: PdfJsModule
  try {
    pdfjs = await import(/* @vite-ignore */ PDFJS_URL) as PdfJsModule
  } catch {
    throw new Error('Não foi possível carregar o leitor de PDF. Verifique a conexão e tente novamente.')
  }

  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL
  const data = new Uint8Array(await file.arrayBuffer())
  const document = await pdfjs.getDocument({ data }).promise
  const allRows: ExtractedRow[] = []
  const cnpjCandidates: string[] = []
  const warnings: string[] = []
  let unidade = ''
  let uf = ''
  let textItems = 0
  let confidentPages = 0
  let eanLabel = 'EAN / Ref.'
  let qtyLabel = 'Quantidade / Quant.'
  let descriptionLabel = 'Produto / Descrição'
  let codeLabel = 'Produto (código interno)'

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items = (content.items as PdfTextItem[])
      .filter(item => typeof item?.str === 'string' && item.str.trim() && Array.isArray(item.transform))
      .map(item => ({ text: clean(item.str), x: Number(item.transform[4] || 0), y: Number(item.transform[5] || 0) }))
    textItems += items.length
    if (!items.length) continue

    for (const candidate of extractCnpjCandidates(items)) {
      if (!cnpjCandidates.includes(candidate)) cnpjCandidates.push(candidate)
    }
    const metadata = extractMetadata(items)
    if (!unidade && metadata.unidade) unidade = metadata.unidade
    if (!uf && metadata.uf) uf = metadata.uf

    const header = detectHeader(items, Number(viewport.width || 595))
    if (header) {
      if (header.confident) confidentPages += 1
      if (eanLabel === 'EAN / Ref.') eanLabel = header.eanLabel
      if (qtyLabel === 'Quantidade / Quant.') qtyLabel = header.qtyLabel
      if (descriptionLabel === 'Produto / Descrição') descriptionLabel = header.descriptionLabel
      if (codeLabel === 'Produto (código interno)') codeLabel = header.codeLabel
      allRows.push(...parseRowsWithHeader(items, header, Number(viewport.width || 595)))
    } else {
      allRows.push(...parseRowsFallback(items, Number(viewport.width || 595)))
      warnings.push(`Página ${pageNumber}: não consegui reconhecer o cabeçalho com segurança; revise os vínculos antes de continuar.`)
    }
  }

  if (!textItems) {
    throw new Error('Este PDF não possui texto selecionável. Use um PDF gerado pelo sistema ou anexe a planilha Excel correspondente.')
  }
  if (!allRows.length) {
    throw new Error('Não encontrei linhas de produtos no PDF. O arquivo precisa conter EAN/Referência e quantidade em formato de tabela.')
  }
  if (!cnpjCandidates.length) warnings.push('CNPJ não identificado automaticamente. Informe o CNPJ do cliente antes de continuar.')
  if (cnpjCandidates.length > 1) warnings.push('Encontrei mais de um CNPJ no PDF. Confirme qual é o CNPJ do cliente, pois o outro pode ser do fornecedor.')

  const first = allRows[0]
  const fields: SourceField[] = [
    { key: 'ean_detectado', label: eanLabel || 'EAN / Ref.', example: first?.ean_detectado || '' },
    { key: 'quant_detectada', label: qtyLabel || 'Quantidade / Quant.', example: first?.quant_detectada || '' },
    { key: 'descricao_detectada', label: descriptionLabel || 'Produto / Descrição', example: first?.descricao_detectada || '' },
  ]
  if (allRows.some(row => row.codigo_interno)) {
    fields.push({ key: 'codigo_interno', label: codeLabel || 'Produto (código interno)', example: first?.codigo_interno || '' })
  }

  return {
    fileName: file.name,
    pages: document.numPages,
    rows: allRows,
    fields,
    cnpjCandidates,
    unidade,
    uf,
    confidence: confidentPages > 0 && warnings.length === 0 ? 'alta' : 'revisar',
    warnings,
  }
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
  const [parsed, setParsed] = useState<PdfReadResult | null>(null)
  const [mapping, setMapping] = useState<PdfMapping>({ ean: 'ean_detectado', quantidade: 'quant_detectada', produto: 'descricao_detectada' })
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

  const preview = useMemo(() => parsed?.rows.slice(0, 6) || [], [parsed])
  const selectedCnpjIsValid = onlyDigits(cnpj).length === 14

  async function uploadPdf(file: File) {
    setLoading(true)
    setMessage('Lendo PDF e identificando campos e produtos…')
    setParsed(null)
    try {
      const result = await readPdf(file)
      setParsed(result)
      setCnpj(result.cnpjCandidates[0] || '')
      setUnidade(result.unidade)
      setUf(result.uf)
      setMapping({ ean: 'ean_detectado', quantidade: 'quant_detectada', produto: 'descricao_detectada' })
      setMessage(`PDF lido: ${result.rows.length} produto(s). Confirme os vínculos abaixo antes de continuar.`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function confirmPdf() {
    if (!parsed) return
    if (!selectedCnpjIsValid) {
      setMessage('Informe ou selecione um CNPJ válido do cliente para continuar.')
      return
    }
    if (!mapping.ean || !mapping.quantidade) {
      setMessage('Ligue o campo de EAN e o campo de Quantidade às informações corretas do PDF.')
      return
    }

    const standardized = parsed.rows
      .map(row => [
        formatCnpj(cnpj),
        unidade,
        uf.toUpperCase().slice(0, 2),
        clean(row[mapping.ean]),
        mapping.produto ? clean(row[mapping.produto]) : '',
        clean(row[mapping.quantidade]),
      ])
      .filter(row => onlyDigits(row[3]).length >= 8 && Number(String(row[5]).replace(',', '.')) > 0)

    if (!standardized.length) {
      setMessage('Os vínculos escolhidos não formaram linhas válidas. Revise principalmente EAN e Quantidade.')
      return
    }

    const textarea = document.querySelector<HTMLTextAreaElement>('.separator-import-grid textarea')
    if (!textarea) {
      setMessage('A área de importação não está disponível. Volte à etapa 1 e tente novamente.')
      return
    }
    const rows = [['CNPJ', 'Unidade', 'UF', 'EAN', 'Produto', 'Quantidade'], ...standardized]
    setNativeTextareaValue(textarea, toTsv(rows))
    setMessage(`Leitura confirmada: ${standardized.length} produto(s). Preparando a conferência das colunas…`)
    window.setTimeout(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('.separator-import-grid button')]
        .find(item => item.textContent?.includes('Usar dados colados'))
      button?.click()
    }, 180)
  }

  if (!target) return null
  return createPortal(
    <article className="separator-upload-card separator-pdf-card">
      <div className="separator-file-icon">PDF</div>
      <h3>Anexar arquivo PDF</h3>
      <p>O sistema lê o pedido, identifica os campos e pede sua confirmação quando houver dúvida.</p>
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
      <small className={message && parsed?.confidence === 'revisar' ? 'separator-pdf-message warning' : 'separator-pdf-message'}>
        {message || 'Ex.: Ref. → EAN e Quant. → Quantidade. PDFs com texto selecionável.'}
      </small>

      {parsed && (
        <section className="separator-pdf-review">
          <div className="separator-pdf-review-head">
            <div>
              <span>Conferência obrigatória</span>
              <h4>Confirme o que cada informação significa</h4>
              <p>{parsed.fileName} · {parsed.pages} página(s) · {parsed.rows.length} produto(s)</p>
            </div>
            <b className={parsed.confidence === 'alta' ? 'ok' : 'review'}>{parsed.confidence === 'alta' ? 'Leitura boa' : 'Revisar'}</b>
          </div>

          {parsed.warnings.length > 0 && (
            <div className="separator-pdf-warnings">
              {parsed.warnings.map(warning => <span key={warning}>⚠ {warning}</span>)}
            </div>
          )}

          <div className="separator-pdf-cnpj">
            <label>
              <span>CNPJ do cliente <em>Obrigatório</em></span>
              {parsed.cnpjCandidates.length > 0 && (
                <select value={onlyDigits(cnpj)} onChange={event => setCnpj(event.target.value)}>
                  {parsed.cnpjCandidates.map(candidate => <option key={candidate} value={candidate}>{formatCnpj(candidate)}</option>)}
                  {!parsed.cnpjCandidates.includes(onlyDigits(cnpj)) && onlyDigits(cnpj).length === 14 && <option value={onlyDigits(cnpj)}>{formatCnpj(cnpj)} (manual)</option>}
                </select>
              )}
              <input value={cnpj} onChange={event => setCnpj(event.target.value)} placeholder="Digite o CNPJ se não tiver sido identificado" />
              <small>{selectedCnpjIsValid ? '✓ CNPJ válido para análise' : 'Informe 14 dígitos. Se houver CNPJ do fornecedor, selecione o CNPJ do cliente.'}</small>
            </label>
            <label><span>Unidade / Loja</span><input value={unidade} onChange={event => setUnidade(event.target.value)} placeholder="Opcional" /></label>
            <label><span>UF</span><input value={uf} onChange={event => setUf(event.target.value.toUpperCase().slice(0, 2))} maxLength={2} placeholder="TO" /></label>
          </div>

          <div className="separator-pdf-link-grid">
            <label>
              <span>EAN / Código de barras <em>Obrigatório</em></span>
              <select value={mapping.ean} onChange={event => setMapping(current => ({ ...current, ean: event.target.value as SourceKey }))}>
                {parsed.fields.map(field => <option key={field.key} value={field.key}>{field.label} · ex.: {field.example || '—'}</option>)}
              </select>
              <small>Exemplo: <b>Ref.</b> → <b>EAN</b></small>
            </label>
            <label>
              <span>Quantidade <em>Obrigatório</em></span>
              <select value={mapping.quantidade} onChange={event => setMapping(current => ({ ...current, quantidade: event.target.value as SourceKey }))}>
                {parsed.fields.map(field => <option key={field.key} value={field.key}>{field.label} · ex.: {field.example || '—'}</option>)}
              </select>
              <small>Exemplo: <b>Quant.</b> → <b>Quantidade</b></small>
            </label>
            <label>
              <span>Produto / Descrição</span>
              <select value={mapping.produto} onChange={event => setMapping(current => ({ ...current, produto: event.target.value as SourceKey | '' }))}>
                <option value="">Não utilizar</option>
                {parsed.fields.map(field => <option key={field.key} value={field.key}>{field.label} · ex.: {field.example || '—'}</option>)}
              </select>
            </label>
          </div>

          <div className="separator-pdf-preview">
            <div><b>Prévia da ligação</b><span>Confira antes de confirmar</span></div>
            <div className="separator-table-wrap">
              <table>
                <thead><tr><th>EAN</th><th>Produto</th><th>Quantidade</th></tr></thead>
                <tbody>{preview.map((row, index) => (
                  <tr key={`${row.ean_detectado}-${index}`}>
                    <td>{clean(row[mapping.ean]) || '—'}</td>
                    <td>{mapping.produto ? clean(row[mapping.produto]) || '—' : '—'}</td>
                    <td>{clean(row[mapping.quantidade]) || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div className="separator-pdf-actions">
            <button className="separator-secondary" type="button" onClick={() => { setParsed(null); setMessage('Selecione outro PDF ou utilize Excel/colar dados.') }}>Descartar leitura</button>
            <button className="separator-primary" type="button" onClick={confirmPdf}>Confirmar leitura do PDF</button>
          </div>
        </section>
      )}
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
