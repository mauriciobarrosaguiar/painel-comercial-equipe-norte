import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'

type BaseType = 'painel' | 'metas' | 'produtos_mix' | 'produtos_mercado_farma'

type BaseStatus = {
  painel: number
  metas: number
  produtos_mix: number
  produtos_mercado_farma: number
  historico: Array<{
    tipo: string
    nome_arquivo: string
    total_registros: number
    status: string
    criado_em: string
  }>
}

type Props = {
  adminKey: string
  enabled: boolean
}

type ImportState = {
  loading: boolean
  message: string
  error: string
}

const EMPTY_STATUS: BaseStatus = {
  painel: 0,
  metas: 0,
  produtos_mix: 0,
  produtos_mercado_farma: 0,
  historico: [],
}

const BASES: Array<{
  type: BaseType
  title: string
  description: string
  required: string
}> = [
  {
    type: 'painel',
    title: 'Painel Equipe Norte',
    description: 'Define a carteira por CNPJ, consultor, GD, cidade e UF. É a fonte oficial para os filtros e clientes com ou sem venda.',
    required: 'CNPJ, NOME PDV, CIDADE, UF, NOME GD e NOME REP',
  },
  {
    type: 'metas',
    title: 'Metas Comerciais',
    description: 'Importa metas de OL sem combate, prioritários, lançamentos e clientes positivados por consultor e GD.',
    required: 'CONSULTOR/COLABORADOR e colunas de metas',
  },
  {
    type: 'produtos_mix',
    title: 'Produtos / Mix',
    description: 'Classifica cada EAN como Linha, Combate, Prioritário ou Lançamento para calcular corretamente os indicadores OL.',
    required: 'EAN, PRODUTO e TIPO MIX',
  },
  {
    type: 'produtos_mercado_farma',
    title: 'Produtos do Mercado Farma',
    description: 'Lista os EANs que devem entrar na extração automática de preços e estoques do Mercado Farma.',
    required: 'EAN e PRODUTO',
  },
]

function slug(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function hasAny(row: unknown[], aliases: string[]) {
  const values = new Set(row.map(slug))
  return aliases.some((alias) => values.has(alias))
}

function rowHasData(row: Record<string, unknown>) {
  return Object.values(row).some((value) => String(value ?? '').trim() !== '')
}

function findHeader(matrix: unknown[][], type: BaseType) {
  const limit = Math.min(matrix.length, 30)
  for (let index = 0; index < limit; index += 1) {
    const row = matrix[index] || []
    if (type === 'painel' && hasAny(row, ['cnpj']) && hasAny(row, ['nome_pdv', 'nome_fantasia', 'razao_social'])) return index
    if ((type === 'produtos_mix' || type === 'produtos_mercado_farma') && hasAny(row, ['ean'])) return index
    if (type === 'metas' && hasAny(row, ['consultor', 'colaborador'])) return index
  }
  return -1
}

function metricHeader(value: unknown) {
  const key = slug(value)
  if (key.includes('demanda') && key.includes('combate')) return 'demanda_sem_combate'
  if (key.includes('sem') && key.includes('combate')) return 'ol_sem_combate'
  if (key.includes('priorit')) return 'ol_prioritarios'
  if (key.includes('lanc') || key.includes('amento')) return 'ol_lancamentos'
  if (key.includes('cliente') && (key.includes('posit') || key.includes('ativ'))) return 'clientes_positivados'
  return key
}

function parseMetas(matrix: unknown[][], headerIndex: number) {
  const current = matrix[headerIndex] || []
  const previous = headerIndex > 0 ? matrix[headerIndex - 1] || [] : []
  const width = Math.max(current.length, previous.length)
  const headers: string[] = []

  for (let column = 0; column < width; column += 1) {
    const currentKey = slug(current[column])
    if (['consultor', 'colaborador', 'cargo', 'escopo'].includes(currentKey)) {
      headers.push(currentKey)
    } else {
      headers.push(metricHeader(previous[column] || current[column]) || `coluna_${column + 1}`)
    }
  }

  return matrix.slice(headerIndex + 1).map((values) => {
    const row: Record<string, unknown> = {}
    headers.forEach((header, column) => { row[header] = values?.[column] ?? '' })
    if (!row.consultor && row.colaborador) row.consultor = row.colaborador
    const cargo = String(row.cargo ?? '').toUpperCase()
    row.escopo = cargo.includes('DISTRITAL') || cargo.includes('GERENTE') ? 'gerente' : 'consultor'
    return row
  }).filter(rowHasData)
}

function parseWorkbook(file: File, type: BaseType) {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: 'array', raw: false })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) throw new Error('A planilha não possui nenhuma aba.')
    const sheet = workbook.Sheets[sheetName]
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false })
    const headerIndex = findHeader(matrix, type)
    if (headerIndex < 0) throw new Error('Não encontrei os cabeçalhos esperados nessa planilha.')

    if (type === 'metas') return parseMetas(matrix, headerIndex)

    const headers = (matrix[headerIndex] || []).map((value, index) => slug(value) || `coluna_${index + 1}`)
    return matrix.slice(headerIndex + 1).map((values) => {
      const row: Record<string, unknown> = {}
      headers.forEach((header, column) => { row[header] = values?.[column] ?? '' })
      return row
    }).filter(rowHasData)
  })
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
    painel: { loading: false, message: '', error: '' },
    metas: { loading: false, message: '', error: '' },
    produtos_mix: { loading: false, message: '', error: '' },
    produtos_mercado_farma: { loading: false, message: '', error: '' },
  })

  const counts = useMemo<Record<BaseType, number>>(() => ({
    painel: status.painel,
    metas: status.metas,
    produtos_mix: status.produtos_mix,
    produtos_mercado_farma: status.produtos_mercado_farma,
  }), [status])

  async function requestStatus() {
    if (!enabled) return
    const response = await fetch('/api/admin/bases', {
      cache: 'no-store',
      headers: { 'x-admin-key': adminKey },
    })
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
    setGeneralError('')
    try {
      const rows = await parseWorkbook(file, type)
      if (!rows.length) throw new Error('O arquivo possui apenas cabeçalhos ou não contém linhas válidas.')
      if (rows.length > 30000) throw new Error('A planilha excede o limite de 30.000 linhas por importação.')

      const response = await fetch('/api/admin/bases', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ tipo: type, rows, nome_arquivo: file.name, ano_mes: month }),
      })
      const data = await response.json() as { erro?: string; total?: number; consultores?: number; bases?: BaseStatus }
      if (!response.ok) throw new Error(data.erro || 'A importação não foi concluída.')
      if (data.bases) setStatus(data.bases)
      patch(type, {
        loading: false,
        message: `${Number(data.total || rows.length).toLocaleString('pt-BR')} registros importados com sucesso.`,
        error: '',
      })
    } catch (reason) {
      patch(type, { loading: false, message: '', error: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  if (!enabled) return null

  return (
    <section className="bases-section">
      <div className="bases-heading">
        <div>
          <span className="eyebrow">Bases oficiais</span>
          <h2>Importação e atualização</h2>
          <p>O Bússola fornece apenas pedidos e faturamento. A carteira, metas e classificação de produtos vêm das planilhas abaixo.</p>
        </div>
        <button className="outline-button" type="button" onClick={() => void requestStatus()}>
          Atualizar situação
        </button>
      </div>

      {generalError && <div className="alert alert-error">{generalError}</div>}

      <div className="base-cards">
        {BASES.map((base) => {
          const state = states[base.type]
          return (
            <article className="base-card" key={base.type}>
              <div className="base-card-top">
                <div>
                  <h3>{base.title}</h3>
                  <p>{base.description}</p>
                </div>
                <span className={counts[base.type] > 0 ? 'base-count ready' : 'base-count missing'}>
                  {counts[base.type] > 0 ? `${counts[base.type].toLocaleString('pt-BR')} registros` : 'Base ausente'}
                </span>
              </div>
              <small><strong>Colunas esperadas:</strong> {base.required}</small>
              {base.type === 'metas' && (
                <label className="month-field">
                  <span>Mês das metas</span>
                  <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
                </label>
              )}
              {state.error && <div className="alert alert-error">{state.error}</div>}
              {state.message && <div className="alert alert-success">{state.message}</div>}
              <label className={`file-button ${state.loading ? 'disabled' : ''}`}>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  disabled={state.loading}
                  onChange={(event) => void importFile(base.type, event)}
                />
                {state.loading ? 'Lendo e importando…' : counts[base.type] > 0 ? 'Substituir planilha' : 'Selecionar planilha'}
              </label>
            </article>
          )
        })}
      </div>

      {status.historico.length > 0 && (
        <div className="import-history">
          <h3>Últimas importações</h3>
          {status.historico.map((item, index) => (
            <div className="history-row" key={`${item.tipo}-${item.criado_em}-${index}`}>
              <div><strong>{item.tipo}</strong><span>{item.nome_arquivo}</span></div>
              <div><strong>{Number(item.total_registros || 0).toLocaleString('pt-BR')}</strong><span>{formatDate(item.criado_em)}</span></div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
