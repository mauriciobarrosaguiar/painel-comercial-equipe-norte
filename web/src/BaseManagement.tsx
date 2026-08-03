import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { readSheet, readSheetNames } from 'read-excel-file/browser'

type ApiBaseType = 'painel' | 'metas' | 'produtos_mix' | 'produtos_mercado_farma'
type CardType = ApiBaseType | 'metas_mix'
type RowData = Record<string, unknown>
type BaseStatus = {
  painel: number
  metas: number
  produtos_mix: number
  produtos_mercado_farma: number
  historico: Array<{ tipo: string; nome_arquivo: string; total_registros: number; status: string; criado_em: string }>
}
type Props = { adminKey: string; enabled: boolean }
type ImportState = { loading: boolean; message: string; error: string }
type CombinedWorkbook = { metas: RowData[]; produtosMix: RowData[] }

type BaseCard = {
  type: CardType
  title: string
  description: string
  required: string
}

const EMPTY_STATUS: BaseStatus = { painel: 0, metas: 0, produtos_mix: 0, produtos_mercado_farma: 0, historico: [] }
const EMPTY_IMPORT: ImportState = { loading: false, message: '', error: '' }
const BASES: BaseCard[] = [
  { type: 'painel', title: 'Painel Equipe Norte', description: 'Fonte oficial da carteira por CNPJ, consultor, GD, cidade e UF.', required: 'CNPJ, NOME PDV, CIDADE, UF, NOME GD e NOME REP' },
  { type: 'metas_mix', title: 'Metas e Produtos / Mix', description: 'Um único arquivo atualiza as metas do GD e dos consultores, além de Prioritários, Lançamentos e OL Combate.', required: 'Abas METAS, PRIORITÁRIOS_LANÇ e COMBATE' },
  { type: 'produtos_mercado_farma', title: 'Produtos do Mercado Farma', description: 'EANs usados na extração automática de preços e estoques.', required: 'EAN e PRODUTO' },
]

function slug(value: unknown) {
  return String(value ?? '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
function hasAny(row: unknown[], aliases: string[]) {
  const values = new Set(row.map(slug))
  return aliases.some((alias) => values.has(alias))
}
function rowHasData(row: RowData) {
  return Object.values(row).some((value) => String(value ?? '').trim() !== '')
}
function findHeader(matrix: unknown[][], type: ApiBaseType) {
  for (let index = 0; index < Math.min(matrix.length, 30); index += 1) {
    const row = matrix[index] || []
    if (type === 'painel' && hasAny(row, ['cnpj']) && hasAny(row, ['nome_pdv', 'nome_fantasia', 'razao_social'])) return index
    if (type === 'produtos_mercado_farma' && hasAny(row, ['ean'])) return index
    if (type === 'produtos_mix' && (hasAny(row, ['ean']) || hasAny(row, ['cod_sap', 'codigo_sap', 'sku']))) return index
    if (type === 'metas' && hasAny(row, ['consultor', 'colaborador'])) return index
  }
  return -1
}
function metricHeader(value: unknown) {
  const key = slug(value)
  if (key.includes('demanda') && key.includes('sem') && key.includes('combate')) return 'demanda_sem_combate'
  if (key.includes('faturamento') && key.includes('bu')) return 'faturamento_bu'
  if (key.includes('sem') && key.includes('combate')) return 'ol_sem_combate'
  if (key.includes('priorit')) return 'ol_prioritarios'
  if (key.includes('lanc') || key.includes('amento')) return 'ol_lancamentos'
  if (key.includes('cliente') && (key.includes('posit') || key.includes('ativ'))) return 'clientes_positivados'
  return key
}
function parseMetas(matrix: unknown[][], headerIndex: number) {
  const current = matrix[headerIndex] || []
  const previous = headerIndex > 0 ? matrix[headerIndex - 1] || [] : []
  const headers = Array.from({ length: Math.max(current.length, previous.length) }, (_, column) => {
    const currentKey = slug(current[column])
    return ['reg', 'setor', 'consultor', 'colaborador', 'cargo', 'escopo'].includes(currentKey)
      ? currentKey
      : metricHeader(previous[column] || current[column]) || `coluna_${column + 1}`
  })
  return matrix.slice(headerIndex + 1).map((values) => {
    const row: RowData = {}
    headers.forEach((header, column) => { row[header] = values?.[column] ?? '' })
    if (!row.consultor && row.colaborador) row.consultor = row.colaborador
    const cargo = String(row.cargo ?? '').toUpperCase()
    row.escopo = cargo.includes('DISTRITAL') || cargo.includes('GERENTE') || /^G\s*D\b/.test(cargo) ? 'gerente' : 'consultor'
    return row
  }).filter((row) => rowHasData(row) && String(row.consultor ?? '').trim() !== '')
}
function parseMixBlocks(matrix: unknown[][], defaultType = '') {
  const headerIndex = matrix.findIndex((row) => row.some((value) => ['cod_sap', 'codigo_sap', 'sku'].includes(slug(value))))
  if (headerIndex < 0) return []
  const header = matrix[headerIndex] || []
  const starts = header.reduce<number[]>((columns, value, column) => {
    if (['cod_sap', 'codigo_sap', 'sku'].includes(slug(value))) columns.push(column)
    return columns
  }, [])
  const rows: RowData[] = []
  for (const values of matrix.slice(headerIndex + 1)) {
    for (const start of starts) {
      const sku = values?.[start]
      if (String(sku ?? '').trim() === '') continue
      const flag = slug(values?.[start + 4])
      if (['nao', 'n', '0', 'inativo', 'excluir'].includes(flag)) continue
      rows.push({
        sku,
        cod_sap: sku,
        molecula: values?.[start + 1] ?? '',
        produto: values?.[start + 2] ?? '',
        descricao: values?.[start + 2] ?? '',
        tipo_mix: values?.[start + 3] || defaultType,
      })
    }
  }
  return rows
}
function validateFile(file: File, multiSheet = false) {
  if (file.size > 20 * 1024 * 1024) throw new Error('O arquivo excede o limite seguro de 20 MB.')
  const extension = file.name.toLowerCase().split('.').pop()
  if (extension === 'xls') throw new Error('O formato .xls antigo não é aceito por segurança. Salve o arquivo como .xlsx.')
  if (multiSheet && extension !== 'xlsx') throw new Error('O arquivo conjunto de metas e MIX precisa estar no formato .xlsx.')
  if (!multiSheet && extension !== 'xlsx' && extension !== 'csv') throw new Error('Use uma planilha .xlsx ou .csv.')
  return extension
}
function findSheet(sheetNames: string[], matcher: (name: string) => boolean) {
  return sheetNames.find((name) => matcher(slug(name))) || ''
}
async function parseCombinedWorkbook(file: File): Promise<CombinedWorkbook> {
  validateFile(file, true)
  const sheetNames = await readSheetNames(file)
  const metasSheet = findSheet(sheetNames, (name) => name === 'metas' || name.includes('meta'))
  const prioritariosSheet = findSheet(sheetNames, (name) => name.includes('priorit') || name.includes('lanc'))
  const combateSheet = findSheet(sheetNames, (name) => name === 'combate' || name.includes('combate'))
  const missing = [
    !metasSheet && 'METAS',
    !prioritariosSheet && 'PRIORITÁRIOS_LANÇ',
    !combateSheet && 'COMBATE',
  ].filter(Boolean)
  if (missing.length) throw new Error(`Não encontrei as abas obrigatórias: ${missing.join(', ')}.`)

  const [metasMatrix, prioritariosMatrix, combateMatrix] = await Promise.all([
    readSheet(file, { sheet: metasSheet }),
    readSheet(file, { sheet: prioritariosSheet }),
    readSheet(file, { sheet: combateSheet }),
  ])
  const metasHeader = findHeader(metasMatrix, 'metas')
  if (metasHeader < 0) throw new Error('A aba METAS não possui os cabeçalhos COLABORADOR/CONSULTOR esperados.')
  const metas = parseMetas(metasMatrix, metasHeader)
  const mixRows = [
    ...parseMixBlocks(prioritariosMatrix),
    ...parseMixBlocks(combateMatrix, 'COMBATE'),
  ]
  const deduplicated = new Map<string, RowData>()
  for (const row of mixRows) {
    const key = String(row.sku ?? row.cod_sap ?? '').replace(/\D/g, '')
    if (key) deduplicated.set(key, row)
  }
  return { metas, produtosMix: [...deduplicated.values()] }
}
async function parseWorkbook(file: File, type: ApiBaseType) {
  const extension = validateFile(file)
  const matrix = extension === 'csv'
    ? parseDelimited(await file.text())
    : await readSheet(file)
  const headerIndex = findHeader(matrix, type)
  if (headerIndex < 0) throw new Error('Não encontrei os cabeçalhos esperados nessa planilha.')
  if (type === 'metas') return parseMetas(matrix, headerIndex)
  if (type === 'produtos_mix' && !hasAny(matrix[headerIndex] || [], ['ean'])) return parseMixBlocks(matrix)
  const headers = (matrix[headerIndex] || []).map((value, index) => slug(value) || `coluna_${index + 1}`)
  return matrix.slice(headerIndex + 1).map((values) => {
    const row: RowData = {}
    headers.forEach((header, column) => { row[header] = values?.[column] ?? '' })
    return row
  }).filter(rowHasData)
}
function parseDelimited(contents: string) {
  const firstLine = contents.split(/\r?\n/, 1)[0] || ''
  const separators = [',', ';', '\t']
  const separator = separators.reduce((best, current) =>
    firstLine.split(current).length > firstLine.split(best).length ? current : best, ';')
  const rows: unknown[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index]
    if (character === '"') {
      if (quoted && contents[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (!quoted && character === separator) {
      row.push(cell)
      cell = ''
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && contents[index + 1] === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
function validateRows(type: ApiBaseType, rows: RowData[]) {
  if (!rows.length) throw new Error('O arquivo possui apenas cabeçalhos ou não contém linhas válidas.')
  if (rows.length > 30000) throw new Error('A planilha excede o limite de 30.000 linhas.')
  if (type === 'painel') {
    const valid = rows.filter((row) => String(row.cnpj ?? '').trim() && String(row.uf ?? '').trim() && String(row.nome_rep ?? row.consultor ?? '').trim())
    if (!valid.length) throw new Error('A base não possui clientes com CNPJ, UF e NOME REP preenchidos.')
  }
  if (type === 'produtos_mix') {
    const classified = rows.filter((row) => String(row.tipo_mix ?? row.classificacao ?? row.categoria ?? '').trim())
    const identified = rows.filter((row) => String(row.ean ?? row.sku ?? row.cod_sap ?? row.codigo_sap ?? '').trim())
    if (!classified.length) throw new Error('A planilha não possui classificações de MIX preenchidas.')
    if (!identified.length) throw new Error('A planilha não possui EAN ou COD SAP para identificar os produtos.')
  }
  if (type === 'produtos_mercado_farma' && !rows.some((row) => String(row.ean ?? '').trim())) {
    throw new Error('A planilha não possui EANs preenchidos.')
  }
  if (type === 'metas' && !rows.some((row) => String(row.consultor ?? row.colaborador ?? '').trim())) {
    throw new Error('A planilha não possui consultores ou colaboradores preenchidos.')
  }
}
function currentMonth() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

export default function BaseManagement({ adminKey, enabled }: Props) {
  const [status, setStatus] = useState<BaseStatus>(EMPTY_STATUS)
  const [month, setMonth] = useState(currentMonth())
  const [generalError, setGeneralError] = useState('')
  const [states, setStates] = useState<Record<CardType, ImportState>>({
    painel: { ...EMPTY_IMPORT },
    metas: { ...EMPTY_IMPORT },
    produtos_mix: { ...EMPTY_IMPORT },
    metas_mix: { ...EMPTY_IMPORT },
    produtos_mercado_farma: { ...EMPTY_IMPORT },
  })
  const counts = useMemo<Record<ApiBaseType, number>>(() => ({
    painel: status.painel,
    metas: status.metas,
    produtos_mix: status.produtos_mix,
    produtos_mercado_farma: status.produtos_mercado_farma,
  }), [status])

  async function requestStatus() {
    if (!enabled) return
    const response = await fetch('/api/admin/bases', { cache: 'no-store', headers: { 'x-admin-key': adminKey } })
    const data = await response.json() as BaseStatus & { erro?: string }
    if (!response.ok) throw new Error(data.erro || 'Não foi possível consultar as bases.')
    setStatus(data)
  }
  useEffect(() => {
    if (!enabled) return
    setGeneralError('')
    void requestStatus().catch((reason) => setGeneralError(reason instanceof Error ? reason.message : String(reason)))
  }, [enabled, adminKey])
  function patch(type: CardType, values: Partial<ImportState>) {
    setStates((current) => ({ ...current, [type]: { ...current[type], ...values } }))
  }
  function cardReady(type: CardType) {
    if (type === 'metas_mix') return status.metas > 0 && status.produtos_mix > 0
    return counts[type] > 0
  }
  function cardCount(type: CardType) {
    if (type === 'metas_mix') return `${status.metas.toLocaleString('pt-BR')} metas · ${status.produtos_mix.toLocaleString('pt-BR')} produtos MIX`
    const total = counts[type]
    return total > 0 ? `${total.toLocaleString('pt-BR')} registros` : 'Base ausente'
  }
  async function importFile(type: CardType, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    patch(type, { loading: true, message: '', error: '' })
    try {
      let payload: Record<string, unknown>
      let expectedTotal = 0
      if (type === 'metas_mix') {
        const combined = await parseCombinedWorkbook(file)
        validateRows('metas', combined.metas)
        validateRows('produtos_mix', combined.produtosMix)
        expectedTotal = combined.metas.length + combined.produtosMix.length
        payload = {
          tipo: 'metas_mix',
          rows: combined.metas,
          mix_rows: combined.produtosMix,
          nome_arquivo: file.name,
          ano_mes: month,
        }
      } else {
        const rows = await parseWorkbook(file, type)
        validateRows(type, rows)
        expectedTotal = rows.length
        payload = { tipo: type, rows, nome_arquivo: file.name, ano_mes: month }
      }
      const response = await fetch('/api/admin/bases', {
        method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify(payload),
      })
      const data = await response.json() as {
        erro?: string
        total?: number
        bases?: BaseStatus
        metas?: { total?: number; consultores?: number }
        produtos_mix?: { total?: number; classificados?: number; nao_encontrados?: number }
      }
      if (!response.ok) throw new Error(data.erro || 'A importação não foi concluída.')
      if (data.bases) setStatus(data.bases)
      const message = type === 'metas_mix'
        ? `${Number(data.metas?.total || 0).toLocaleString('pt-BR')} metas e ${Number(data.produtos_mix?.total || 0).toLocaleString('pt-BR')} produtos MIX lidos. ${Number(data.produtos_mix?.classificados || 0).toLocaleString('pt-BR')} produtos já classificados no painel${Number(data.produtos_mix?.nao_encontrados || 0) > 0 ? `; ${Number(data.produtos_mix?.nao_encontrados || 0).toLocaleString('pt-BR')} códigos SAP serão aplicados quando aparecerem no Bússola` : ''}.`
        : `${Number(data.total || expectedTotal).toLocaleString('pt-BR')} registros importados com sucesso.`
      patch(type, { loading: false, message, error: '' })
    } catch (reason) {
      patch(type, { loading: false, message: '', error: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  if (!enabled) return null

  return (
    <section className="bases-section">
      <div className="bases-heading">
        <div><span className="eyebrow">Bases oficiais</span><h2>Importação e atualização</h2><p>O Bússola fornece pedidos e faturamento. Carteira, metas e produtos vêm das planilhas abaixo.</p></div>
        <button className="outline-button" type="button" onClick={() => void requestStatus()}>Atualizar situação</button>
      </div>
      {generalError && <div className="alert alert-error">{generalError}</div>}
      <div className="base-cards">
        {BASES.map((base) => {
          const state = states[base.type]
          const ready = cardReady(base.type)
          return (
            <article className="base-card" key={base.type}>
              <div className="base-card-top"><div><h3>{base.title}</h3><p>{base.description}</p></div><span className={ready ? 'base-count ready' : 'base-count missing'}>{cardCount(base.type)}</span></div>
              <small><strong>Estrutura esperada:</strong> {base.required}</small>
              {base.type === 'metas_mix' && <label className="month-field"><span>Mês das metas</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>}
              {state.error && <div className="alert alert-error">{state.error}</div>}
              {state.message && <div className="alert alert-success">{state.message}</div>}
              <label className={`file-button ${state.loading ? 'disabled' : ''}`}><input type="file" accept={base.type === 'metas_mix' ? '.xlsx' : '.xlsx,.csv'} disabled={state.loading} onChange={(event) => void importFile(base.type, event)} />{state.loading ? 'Lendo as abas e importando…' : ready ? 'Substituir planilha' : 'Selecionar planilha'}</label>
            </article>
          )
        })}
      </div>
      {status.historico.length > 0 && <div className="import-history"><h3>Últimas importações</h3>{status.historico.map((item, index) => <div className="history-row" key={`${item.tipo}-${item.criado_em}-${index}`}><div><strong>{item.tipo}</strong><span>{item.nome_arquivo}</span></div><div><strong>{Number(item.total_registros || 0).toLocaleString('pt-BR')}</strong><span>{formatDate(item.criado_em)}</span></div></div>)}</div>}
    </section>
  )
}
