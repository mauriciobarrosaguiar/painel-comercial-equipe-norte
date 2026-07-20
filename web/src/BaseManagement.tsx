import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { readSheet } from 'read-excel-file/browser'

type BaseType = 'painel' | 'metas' | 'produtos_mix' | 'produtos_mercado_farma'
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

const EMPTY_STATUS: BaseStatus = { painel: 0, metas: 0, produtos_mix: 0, produtos_mercado_farma: 0, historico: [] }
const EMPTY_IMPORT: ImportState = { loading: false, message: '', error: '' }
const BASES: Array<{ type: BaseType; title: string; description: string; required: string }> = [
  { type: 'painel', title: 'Painel Equipe Norte', description: 'Fonte oficial da carteira por CNPJ, consultor, GD, cidade e UF.', required: 'CNPJ, NOME PDV, CIDADE, UF, NOME GD e NOME REP' },
  { type: 'metas', title: 'Metas Comerciais', description: 'Metas de OL e clientes positivados por consultor e GD.', required: 'CONSULTOR/COLABORADOR e colunas de metas' },
  { type: 'produtos_mix', title: 'Produtos / Mix', description: 'Classificação de cada EAN como Linha, Combate, Prioritário ou Lançamento.', required: 'EAN, PRODUTO e TIPO MIX' },
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
function findHeader(matrix: unknown[][], type: BaseType) {
  for (let index = 0; index < Math.min(matrix.length, 30); index += 1) {
    const row = matrix[index] || []
    if (type === 'painel' && hasAny(row, ['cnpj']) && hasAny(row, ['nome_pdv', 'nome_fantasia', 'razao_social'])) return index
    if ((type === 'produtos_mix' || type === 'produtos_mercado_farma') && hasAny(row, ['ean'])) return index
    if (type === 'metas' && hasAny(row, ['consultor', 'colaborador'])) return index
  }
  return -1
}
function metricHeader(value: unknown) {
  const key = slug(value)
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
    return ['consultor', 'colaborador', 'cargo', 'escopo'].includes(currentKey)
      ? currentKey
      : metricHeader(previous[column] || current[column]) || `coluna_${column + 1}`
  })
  return matrix.slice(headerIndex + 1).map((values) => {
    const row: RowData = {}
    headers.forEach((header, column) => { row[header] = values?.[column] ?? '' })
    if (!row.consultor && row.colaborador) row.consultor = row.colaborador
    const cargo = String(row.cargo ?? '').toUpperCase()
    row.escopo = cargo.includes('DISTRITAL') || cargo.includes('GERENTE') ? 'gerente' : 'consultor'
    return row
  }).filter(rowHasData)
}
async function parseWorkbook(file: File, type: BaseType) {
  if (file.size > 20 * 1024 * 1024) throw new Error('O arquivo excede o limite seguro de 20 MB.')
  const extension = file.name.toLowerCase().split('.').pop()
  if (extension === 'xls') throw new Error('O formato .xls antigo não é aceito por segurança. Salve o arquivo como .xlsx ou .csv.')
  if (extension !== 'xlsx' && extension !== 'csv') throw new Error('Use uma planilha .xlsx ou .csv.')
  const matrix = extension === 'csv'
    ? parseDelimited(await file.text())
    : await readSheet(file)
  const headerIndex = findHeader(matrix, type)
  if (headerIndex < 0) throw new Error('Não encontrei os cabeçalhos esperados nessa planilha.')
  if (type === 'metas') return parseMetas(matrix, headerIndex)
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
function validateRows(type: BaseType, rows: RowData[]) {
  if (!rows.length) throw new Error('O arquivo possui apenas cabeçalhos ou não contém linhas válidas.')
  if (rows.length > 30000) throw new Error('A planilha excede o limite de 30.000 linhas.')
  if (type === 'painel') {
    const valid = rows.filter((row) => String(row.cnpj ?? '').trim() && String(row.uf ?? '').trim() && String(row.nome_rep ?? row.consultor ?? '').trim())
    if (!valid.length) throw new Error('A base não possui clientes com CNPJ, UF e NOME REP preenchidos.')
  }
  if (type === 'produtos_mix') {
    const classified = rows.filter((row) => String(row.tipo_mix ?? row.classificacao ?? row.categoria ?? '').trim())
    if (!classified.length) throw new Error('Esta planilha não possui a coluna TIPO MIX ou nenhuma classificação preenchida.')
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
  const [states, setStates] = useState<Record<BaseType, ImportState>>({
    painel: { ...EMPTY_IMPORT }, metas: { ...EMPTY_IMPORT }, produtos_mix: { ...EMPTY_IMPORT }, produtos_mercado_farma: { ...EMPTY_IMPORT },
  })
  const counts = useMemo<Record<BaseType, number>>(() => ({
    painel: status.painel, metas: status.metas, produtos_mix: status.produtos_mix, produtos_mercado_farma: status.produtos_mercado_farma,
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
  function patch(type: BaseType, values: Partial<ImportState>) {
    setStates((current) => ({ ...current, [type]: { ...current[type], ...values } }))
  }
  async function importFile(type: BaseType, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    patch(type, { loading: true, message: '', error: '' })
    try {
      const rows = await parseWorkbook(file, type)
      validateRows(type, rows)
      const response = await fetch('/api/admin/bases', {
        method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ tipo: type, rows, nome_arquivo: file.name, ano_mes: month }),
      })
      const data = await response.json() as { erro?: string; total?: number; bases?: BaseStatus }
      if (!response.ok) throw new Error(data.erro || 'A importação não foi concluída.')
      if (data.bases) setStatus(data.bases)
      patch(type, { loading: false, message: `${Number(data.total || rows.length).toLocaleString('pt-BR')} registros importados com sucesso.`, error: '' })
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
          return (
            <article className="base-card" key={base.type}>
              <div className="base-card-top"><div><h3>{base.title}</h3><p>{base.description}</p></div><span className={counts[base.type] > 0 ? 'base-count ready' : 'base-count missing'}>{counts[base.type] > 0 ? `${counts[base.type].toLocaleString('pt-BR')} registros` : 'Base ausente'}</span></div>
              <small><strong>Colunas esperadas:</strong> {base.required}</small>
              {base.type === 'metas' && <label className="month-field"><span>Mês das metas</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>}
              {state.error && <div className="alert alert-error">{state.error}</div>}
              {state.message && <div className="alert alert-success">{state.message}</div>}
              <label className={`file-button ${state.loading ? 'disabled' : ''}`}><input type="file" accept=".xlsx,.csv" disabled={state.loading} onChange={(event) => void importFile(base.type, event)} />{state.loading ? 'Lendo e importando…' : counts[base.type] > 0 ? 'Substituir planilha' : 'Selecionar planilha'}</label>
            </article>
          )
        })}
      </div>
      {status.historico.length > 0 && <div className="import-history"><h3>Últimas importações</h3>{status.historico.map((item, index) => <div className="history-row" key={`${item.tipo}-${item.criado_em}-${index}`}><div><strong>{item.tipo}</strong><span>{item.nome_arquivo}</span></div><div><strong>{Number(item.total_registros || 0).toLocaleString('pt-BR')}</strong><span>{formatDate(item.criado_em)}</span></div></div>)}</div>}
    </section>
  )
}
