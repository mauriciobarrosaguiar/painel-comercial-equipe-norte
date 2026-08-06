import { useEffect, useMemo, useRef, useState } from 'react'
import { readSheet } from 'read-excel-file/browser'
import './order-separator.css'

type Cell = string | number | boolean | Date | null | undefined
type Mapping = { cnpj: number; ean: number; produto: number; quantidade: number; unidade: number; uf: number }
type DistributorRule = { distribuidora: string; utilizar: boolean; prioridade: number; pedido_minimo: number }
type StateRule = { modo: 'prioridade' | 'melhor_preco' | 'misto'; distribuidoras: DistributorRule[] }
type Configuration = { versao?: number; estados: Record<string, StateRule> }
type AnalysisRow = {
  index: number; cnpj: string; uf: string; ean: string; produto: string; quantidade: number
  distribuidora: string; status: string; preco_sem_imposto: number | null; total_linha: number | null; estoque_disponivel?: number | null
}
type DistributorSummary = { distribuidora: string; itens: number; total: number; pedido_minimo: number; situacao: string }
type CnpjSummary = { cnpj: string; uf: string; modo: string; distribuidoras: DistributorSummary[]; distribuidos: number; sem_estoque: number; ean_nao_localizado: number; minimo_nao_atingido: number }
type Analysis = {
  resultados: AnalysisRow[]
  resumo: {
    geral: { cnpjs: number; produtos: number; distribuidos: number; sem_estoque: number; ean_nao_localizado: number; minimo_nao_atingido: number }
    estados: Array<{ uf: string; cnpjs: number; produtos: number; distribuidos: number; sem_estoque: number; ean_nao_localizado: number; minimo_nao_atingido: number }>
    cnpjs: CnpjSummary[]
  }
  mercado_farma_atualizado_em: string | null
}

type Props = { onBack: () => void }
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const number = new Intl.NumberFormat('pt-BR')
const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
const inferUf = (value: unknown) => {
  const normalized = ` ${normalize(value)} `
  return ['TO','PA','MT','MA','DF','GO','PI'].find(uf => normalized.includes(` ${uf} `)) || ''
}
const modeLabel = (mode: StateRule['modo']) => mode === 'melhor_preco' ? 'Melhor preço' : mode === 'misto' ? 'Prioridade + melhor preço' : 'Prioridade por distribuidora'
const formatDate = (value: string | null | undefined) => {
  if (!value) return 'Atualização não informada'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('pt-BR')
}

const aliases: Record<keyof Mapping, string[]> = {
  cnpj: ['CNPJ','CNPJ CLIENTE','CNPJ PDV','DOCUMENTO'],
  ean: ['EAN','CODIGO DE BARRAS','GTIN','COD BARRAS','CODIGO BARRAS'],
  produto: ['PRODUTO','DESCRICAO DO PRODUTO','DESCRICAO','ITEM'],
  quantidade: ['QUANTIDADE','QNTDE','QTDE','QTD','UNIDADES'],
  unidade: ['APELIDO UN NEG','UNIDADE','LOJA','FILIAL','CLIENTE','UN NEG'],
  uf: ['UF','ESTADO'],
}
const detectIndex = (headers: string[], key: keyof Mapping) => {
  const normalized = headers.map(normalize)
  const exact = normalized.findIndex(header => aliases[key].includes(header))
  if (exact >= 0) return exact
  return normalized.findIndex(header => aliases[key].some(alias => header.includes(alias)))
}
const detectMapping = (headers: string[]): Mapping => ({
  cnpj: detectIndex(headers, 'cnpj'), ean: detectIndex(headers, 'ean'), produto: detectIndex(headers, 'produto'),
  quantidade: detectIndex(headers, 'quantidade'), unidade: detectIndex(headers, 'unidade'), uf: detectIndex(headers, 'uf'),
})
const parsePasted = (text: string): Cell[][] => text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim())
  .map(line => line.split('\t').map(value => value.trim()))
const chooseHeaderRow = (rows: Cell[][]) => {
  let best = 0
  let score = -1
  rows.slice(0, 20).forEach((row, index) => {
    const headers = row.map(value => String(value ?? ''))
    const mapping = detectMapping(headers)
    const current = Object.values(mapping).filter(value => value >= 0).length
    if (current > score) { score = current; best = index }
  })
  return best
}
const cloneConfig = (config: Configuration): Configuration => JSON.parse(JSON.stringify(config))

export default function OrderSeparatorModule({ onBack }: Props) {
  const [step, setStep] = useState(1)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Cell[][]>([])
  const [mapping, setMapping] = useState<Mapping>({ cnpj: -1, ean: -1, produto: -1, quantidade: -1, unidade: -1, uf: -1 })
  const [fileName, setFileName] = useState('pedidos-separados')
  const [paste, setPaste] = useState('')
  const [config, setConfig] = useState<Configuration>({ estados: {} })
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<string | null>(null)
  const [activeUf, setActiveUf] = useState('TO')
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [error, setError] = useState('')
  const [expandedCnpj, setExpandedCnpj] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    fetch('/api/separador-pedidos-config', { cache: 'no-store' })
      .then(async response => {
        const json = await response.json()
        if (!response.ok) throw new Error(json.detalhe || json.erro || 'Falha ao carregar configurações')
        setConfig(json.configuracao || { estados: {} })
        setSavedAt(json.atualizado_em || null)
        setMarketUpdatedAt(json.mercado_farma_atualizado_em || null)
        const firstUf = Object.keys(json.configuracao?.estados || {})[0]
        if (firstUf) setActiveUf(firstUf)
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoadingConfig(false))
  }, [])

  const detectedUfs = useMemo(() => {
    const result = new Set<string>()
    for (const row of rows) {
      const direct = mapping.uf >= 0 ? String(row[mapping.uf] ?? '').trim().toUpperCase().slice(0, 2) : ''
      const inferred = direct || (mapping.unidade >= 0 ? inferUf(row[mapping.unidade]) : '')
      if (inferred) result.add(inferred)
    }
    return [...result].sort()
  }, [rows, mapping])
  const stateTabs = detectedUfs.length ? detectedUfs : Object.keys(config.estados).sort()
  const currentRule = config.estados[activeUf]
  const mappedPreview = rows.slice(0, 5)
  const resultsByIndex = useMemo(() => new Map((analysis?.resultados || []).map(item => [item.index, item])), [analysis])

  function loadRows(raw: Cell[][], name: string) {
    const headerIndex = chooseHeaderRow(raw)
    const detectedHeaders = (raw[headerIndex] || []).map((value, index) => String(value ?? '').trim() || `COLUNA ${index + 1}`)
    const data = raw.slice(headerIndex + 1).filter(row => row.some(value => String(value ?? '').trim() !== ''))
    if (!detectedHeaders.length || !data.length) throw new Error('A planilha não possui cabeçalho e linhas válidas para análise.')
    setHeaders(detectedHeaders)
    setRows(data)
    setMapping(detectMapping(detectedHeaders))
    setFileName(name.replace(/\.[^.]+$/, '') || 'pedidos-separados')
    setAnalysis(null)
    setStep(2)
    setError('')
  }

  async function upload(file: File) {
    try {
      const parsed = await readSheet(file)
      loadRows(parsed as Cell[][], file.name)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  function usePaste() {
    try { loadRows(parsePasted(paste), 'dados-colados') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  function updateRule(uf: string, updater: (rule: StateRule) => StateRule) {
    setConfig(current => {
      const next = cloneConfig(current)
      next.estados[uf] = updater(next.estados[uf] || { modo: 'prioridade', distribuidoras: [] })
      return next
    })
  }

  function moveDistributor(index: number, direction: -1 | 1) {
    if (!currentRule) return
    const target = index + direction
    if (target < 0 || target >= currentRule.distribuidoras.length) return
    updateRule(activeUf, rule => {
      const list = [...rule.distribuidoras]
      const [item] = list.splice(index, 1)
      list.splice(target, 0, item)
      return { ...rule, distribuidoras: list.map((entry, position) => ({ ...entry, prioridade: position + 1 })) }
    })
  }

  async function saveConfig() {
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/separador-pedidos-config', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ configuracao: config }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.detalhe || json.erro || 'Falha ao salvar configurações')
      setConfig(json.configuracao)
      setSavedAt(json.atualizado_em)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      throw reason
    } finally { setSaving(false) }
  }

  function validateMapping() {
    if (mapping.cnpj < 0 || mapping.ean < 0 || mapping.quantidade < 0) {
      setError('Confirme as colunas de CNPJ, EAN e quantidade antes de continuar.')
      return false
    }
    return true
  }

  async function analyze() {
    if (!validateMapping()) return
    const missing = detectedUfs.filter(uf => !config.estados[uf] || !config.estados[uf].distribuidoras.some(item => item.utilizar))
    if (missing.length) { setError(`Selecione ao menos uma distribuidora para: ${missing.join(', ')}.`); return }
    setAnalyzing(true); setError(''); setStep(4)
    try {
      await saveConfig()
      const response = await fetch('/api/separador-pedidos-analisar', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ headers, rows, mapping, configuracao: config }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.detalhe || json.erro || 'Falha ao analisar pedidos')
      setAnalysis(json)
      setMarketUpdatedAt(json.mercado_farma_atualizado_em || marketUpdatedAt)
      setStep(5)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setStep(3)
    } finally { setAnalyzing(false) }
  }

  async function exportFile() {
    if (!analysis) return
    setError('')
    try {
      const response = await fetch('/api/separador-pedidos-exportar', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ headers, rows, resultados: analysis.resultados, nome_arquivo: `${fileName}-separado` }),
      })
      if (!response.ok) throw new Error(await response.text())
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${fileName}-separado.xlsx`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const stepLabels = ['Importar planilha', 'Confirmar colunas', 'Configurar regras', 'Analisar', 'Resultado']

  return (
    <main className="separator-page">
      <section className="separator-heading">
        <div>
          <button className="separator-back" type="button" onClick={onBack}>← Voltar ao painel</button>
          <span className="separator-eyebrow">Mercado Farma · automação de pedidos</span>
          <h1>Separador de Pedidos</h1>
          <p>Separe cada CNPJ por estado, estoque, prioridade, melhor preço e pedido mínimo.</p>
        </div>
        <div className="separator-update-card">
          <span>Base utilizada</span>
          <strong>Preços sem imposto</strong>
          <small>Mercado Farma: {formatDate(marketUpdatedAt)}</small>
        </div>
      </section>

      <nav className="separator-steps" aria-label="Etapas da separação">
        {stepLabels.map((label, index) => (
          <button key={label} type="button" className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''}
            onClick={() => index + 1 < step && setStep(index + 1)}>
            <b>{index + 1}</b><span>{label}</span>
          </button>
        ))}
      </nav>

      {error && <div className="separator-alert error"><b>Não foi possível continuar.</b><span>{error}</span></div>}

      {step === 1 && (
        <section className="separator-panel">
          <div className="separator-panel-title"><div><span>1</span><div><h2>Importar ou colar planilha</h2><p>Os dados originais serão preservados na exportação.</p></div></div></div>
          <div className="separator-import-grid">
            <article className="separator-upload-card">
              <div className="separator-file-icon">▦</div><h3>Anexar arquivo Excel</h3><p>Formatos aceitos: .xlsx e .xls</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
              <button className="separator-dropzone" type="button" onClick={() => fileRef.current?.click()}><b>☁</b><span>Clique para selecionar a planilha</span></button>
            </article>
            <article className="separator-upload-card">
              <div className="separator-file-icon">▤</div><h3>Colar dados do Excel</h3><p>Copie no Excel e cole abaixo com Ctrl + V.</p>
              <textarea value={paste} onChange={event => setPaste(event.target.value)} placeholder={'Cole aqui as linhas com cabeçalho\nCNPJ\tEAN\tProduto\tQuantidade...'} />
              <button className="separator-primary" type="button" disabled={!paste.trim()} onClick={usePaste}>Usar dados colados</button>
            </article>
          </div>
          <div className="separator-tip"><b>Importante:</b> a planilha precisa conter CNPJ, EAN e quantidade. Produto, unidade e UF ajudam na conferência.</div>
        </section>
      )}

      {step === 2 && (
        <section className="separator-panel">
          <div className="separator-panel-title"><div><span>2</span><div><h2>Confirmar colunas identificadas</h2><p>{rows.length} linhas encontradas em {fileName}.</p></div></div></div>
          <div className="separator-success">✓ Planilha carregada. Confirme o relacionamento das colunas antes de continuar.</div>
          <div className="separator-table-wrap"><table className="separator-map-table"><thead><tr><th>Campo necessário</th><th>Coluna identificada</th><th>Prévia</th></tr></thead><tbody>
            {(Object.keys(mapping) as Array<keyof Mapping>).map(key => (
              <tr key={key}><td><b>{key === 'cnpj' ? 'CNPJ' : key === 'ean' ? 'EAN / Código de barras' : key === 'produto' ? 'Produto / Descrição' : key === 'quantidade' ? 'Quantidade' : key === 'unidade' ? 'Unidade / Apelido' : 'UF / Estado'}</b>{['cnpj','ean','quantidade'].includes(key) && <em>Obrigatório</em>}</td>
                <td><select value={mapping[key]} onChange={event => setMapping(current => ({ ...current, [key]: Number(event.target.value) }))}><option value={-1}>Não utilizar</option>{headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}</select></td>
                <td>{mapping[key] >= 0 ? String(rows[0]?.[mapping[key]] ?? '—') : '—'}</td></tr>
            ))}
          </tbody></table></div>
          <h3 className="separator-preview-title">Prévia dos dados originais</h3>
          <div className="separator-table-wrap"><table><thead><tr>{headers.slice(0, 8).map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{mappedPreview.map((row, index) => <tr key={index}>{headers.slice(0, 8).map((_, column) => <td key={column}>{String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>
          <div className="separator-actions"><button className="separator-secondary" type="button" onClick={() => setStep(1)}>Voltar</button><button className="separator-primary" type="button" onClick={() => { if (validateMapping()) { const first = detectedUfs.find(uf => config.estados[uf]) || stateTabs[0]; if (first) setActiveUf(first); setStep(3); setError('') } }}>Confirmar e continuar</button></div>
        </section>
      )}

      {step === 3 && (
        <section className="separator-panel">
          <div className="separator-panel-title"><div><span>3</span><div><h2>Configurar regras por estado</h2><p>As configurações ficam salvas para as próximas análises.</p></div></div><small>Último salvamento: {formatDate(savedAt)}</small></div>
          {loadingConfig ? <div className="separator-loading">Carregando distribuidoras disponíveis…</div> : (
            <div className="separator-rules-layout">
              <aside className="separator-state-list"><h3>Estados da planilha</h3>{stateTabs.map(uf => <button type="button" key={uf} className={activeUf === uf ? 'active' : ''} onClick={() => setActiveUf(uf)}><span>{uf}</span><small>{rows.filter(row => { const direct = mapping.uf >= 0 ? String(row[mapping.uf] ?? '').toUpperCase().slice(0, 2) : ''; return (direct || inferUf(mapping.unidade >= 0 ? row[mapping.unidade] : '')) === uf }).length} itens</small></button>)}</aside>
              <div className="separator-rule-editor">
                {!currentRule ? <div className="separator-alert error">Não há distribuidoras extraídas do Mercado Farma para {activeUf}.</div> : <>
                  <div className="separator-rule-top"><label><span>Modo de análise para {activeUf}</span><select value={currentRule.modo} onChange={event => updateRule(activeUf, rule => ({ ...rule, modo: event.target.value as StateRule['modo'] }))}><option value="prioridade">Prioridade por distribuidora</option><option value="melhor_preco">Melhor preço sem imposto</option><option value="misto">Prioridade + melhor preço</option></select></label><div className="separator-mode-explain"><b>{modeLabel(currentRule.modo)}</b><span>{currentRule.modo === 'prioridade' ? 'Segue a ordem definida. O preço apenas calcula o pedido mínimo.' : currentRule.modo === 'melhor_preco' ? 'Escolhe o menor preço sem imposto entre as distribuidoras selecionadas.' : 'Respeita o nível de prioridade e usa o menor preço dentro do mesmo nível.'}</span></div></div>
                  <div className="separator-table-wrap"><table className="separator-rules-table"><thead><tr><th>Usar</th><th>Ordem</th><th>Distribuidora</th><th>Prioridade</th><th>Pedido mínimo sem imposto</th></tr></thead><tbody>{currentRule.distribuidoras.map((rule, index) => <tr key={rule.distribuidora} className={!rule.utilizar ? 'disabled' : ''}><td><input type="checkbox" checked={rule.utilizar} onChange={event => updateRule(activeUf, state => ({ ...state, distribuidoras: state.distribuidoras.map((item, position) => position === index ? { ...item, utilizar: event.target.checked } : item) }))} /></td><td><div className="separator-order-buttons"><button type="button" onClick={() => moveDistributor(index, -1)} disabled={index === 0}>↑</button><button type="button" onClick={() => moveDistributor(index, 1)} disabled={index === currentRule.distribuidoras.length - 1}>↓</button></div></td><td><b>{rule.distribuidora}</b><small>Atende {activeUf}</small></td><td><input type="number" min="1" value={rule.prioridade} onChange={event => updateRule(activeUf, state => ({ ...state, distribuidoras: state.distribuidoras.map((item, position) => position === index ? { ...item, prioridade: Math.max(1, Number(event.target.value)) } : item) }))} /></td><td><div className="separator-money-input"><span>R$</span><input type="number" min="0" step="0.01" value={rule.pedido_minimo} onChange={event => updateRule(activeUf, state => ({ ...state, distribuidoras: state.distribuidoras.map((item, position) => position === index ? { ...item, pedido_minimo: Math.max(0, Number(event.target.value)) } : item) }))} /></div></td></tr>)}</tbody></table></div>
                  <div className="separator-tip">Cada estado utiliza somente suas próprias distribuidoras. Pedidos mínimos são calculados separadamente para cada CNPJ.</div>
                </>}
              </div>
            </div>
          )}
          <div className="separator-state-summary">{detectedUfs.map(uf => { const rule = config.estados[uf]; return <article key={uf}><div><b>{uf}</b><span>{rule ? modeLabel(rule.modo) : 'Sem configuração'}</span></div><p>{rule?.distribuidoras.filter(item => item.utilizar).sort((a,b) => a.prioridade-b.prioridade).map(item => item.distribuidora).join(' → ') || 'Nenhuma distribuidora selecionada'}</p></article> })}</div>
          <div className="separator-actions"><button className="separator-secondary" type="button" onClick={() => setStep(2)}>Voltar</button><button className="separator-secondary" type="button" disabled={saving} onClick={() => void saveConfig()}>{saving ? 'Salvando…' : 'Salvar prioridades'}</button><button className="separator-primary" type="button" disabled={analyzing} onClick={() => void analyze()}>Confirmar e iniciar análise</button></div>
        </section>
      )}

      {step === 4 && (
        <section className="separator-panel separator-analysis-progress">
          <div className="separator-spinner" /><h2>Analisando pedidos…</h2><p>Separando CNPJs por estado e aplicando as configurações salvas.</p>
          <ul><li>Identificando CNPJs e estados</li><li>Consultando EANs, estoques e preços sem imposto</li><li>Aplicando prioridade ou melhor preço</li><li>Validando pedido mínimo por CNPJ</li><li>Redistribuindo itens quando necessário</li><li>Preparando o resultado final</li></ul>
          <div className="separator-progress-bar"><span /></div><small>{analyzing ? 'Aguarde alguns instantes…' : 'Finalizando…'}</small>
        </section>
      )}

      {step === 5 && analysis && (
        <section className="separator-panel">
          <div className="separator-panel-title"><div><span>5</span><div><h2>Resultado da separação</h2><p>Resumo organizado por estado, CNPJ e distribuidora.</p></div></div><button className="separator-primary" type="button" onClick={() => void exportFile()}>Exportar planilha final ↓</button></div>
          <div className="separator-metrics"><article><span>CNPJs analisados</span><b>{number.format(analysis.resumo.geral.cnpjs)}</b></article><article><span>Produtos analisados</span><b>{number.format(analysis.resumo.geral.produtos)}</b></article><article className="good"><span>Distribuídos</span><b>{number.format(analysis.resumo.geral.distribuidos)}</b></article><article className="warn"><span>Sem estoque</span><b>{number.format(analysis.resumo.geral.sem_estoque)}</b></article><article className="bad"><span>EAN não localizado</span><b>{number.format(analysis.resumo.geral.ean_nao_localizado)}</b></article></div>
          <div className="separator-state-results">{analysis.resumo.estados.map(state => <article key={state.uf}><div><b>{state.uf}</b><span>{state.cnpjs} CNPJ(s)</span></div><dl><dt>Produtos</dt><dd>{state.produtos}</dd><dt>Distribuídos</dt><dd>{state.distribuidos}</dd><dt>Sem estoque</dt><dd>{state.sem_estoque}</dd></dl></article>)}</div>
          <div className="separator-table-wrap"><table className="separator-result-table"><thead><tr><th>Estado</th><th>CNPJ</th><th>Modo</th><th>Distribuidora</th><th>Itens</th><th>Total sem imposto</th><th>Pedido mínimo</th><th>Situação</th></tr></thead><tbody>{analysis.resumo.cnpjs.flatMap(cnpj => cnpj.distribuidoras.length ? cnpj.distribuidoras.map((dist, index) => <tr key={`${cnpj.cnpj}-${dist.distribuidora}`}><td>{index === 0 ? cnpj.uf : ''}</td><td>{index === 0 ? <button className="separator-link-button" type="button" onClick={() => setExpandedCnpj(expandedCnpj === cnpj.cnpj ? '' : cnpj.cnpj)}>{cnpj.cnpj}</button> : ''}</td><td>{index === 0 ? modeLabel(cnpj.modo as StateRule['modo']) : ''}</td><td><b>{dist.distribuidora}</b></td><td>{dist.itens}</td><td>{money.format(dist.total)}</td><td>{dist.pedido_minimo > 0 ? money.format(dist.pedido_minimo) : 'Sem mínimo'}</td><td><span className={`separator-status ${dist.situacao === 'ATINGIU' || dist.situacao === 'SEM MÍNIMO' ? 'ok' : 'fail'}`}>{dist.situacao}</span></td></tr>) : [<tr key={cnpj.cnpj}><td>{cnpj.uf}</td><td><button className="separator-link-button" type="button" onClick={() => setExpandedCnpj(expandedCnpj === cnpj.cnpj ? '' : cnpj.cnpj)}>{cnpj.cnpj}</button></td><td>{modeLabel(cnpj.modo as StateRule['modo'])}</td><td colSpan={5}>Nenhum pedido distribuído</td></tr>])}</tbody></table></div>
          {expandedCnpj && <section className="separator-detail"><div className="separator-detail-title"><div><h3>Detalhes do CNPJ {expandedCnpj}</h3><p>As informações originais permanecem intactas na exportação.</p></div><button type="button" onClick={() => setExpandedCnpj('')}>Fechar ×</button></div><div className="separator-table-wrap"><table><thead><tr><th>EAN</th><th>Produto</th><th>Quantidade</th><th>Distribuidora para envio</th><th>Status</th><th>Preço sem imposto</th><th>Total da linha</th></tr></thead><tbody>{analysis.resultados.filter(item => item.cnpj === expandedCnpj).map(item => <tr key={item.index}><td>{item.ean}</td><td>{item.produto}</td><td>{item.quantidade}</td><td><b>{item.distribuidora}</b></td><td><span className={`separator-status ${item.status === 'DISTRIBUÍDO' ? 'ok' : 'fail'}`}>{item.status}</span></td><td>{item.preco_sem_imposto === null ? '—' : money.format(item.preco_sem_imposto)}</td><td>{item.total_linha === null ? '—' : money.format(item.total_linha)}</td></tr>)}</tbody></table></div></section>}
          <h3 className="separator-preview-title">Prévia da planilha final</h3>
          <div className="separator-table-wrap"><table><thead><tr>{headers.slice(0, 6).map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}<th>Distribuidora para envio</th><th>Status da análise</th></tr></thead><tbody>{rows.slice(0, 12).map((row, index) => { const result = resultsByIndex.get(index); return <tr key={index}>{headers.slice(0, 6).map((_, column) => <td key={column}>{String(row[column] ?? '')}</td>)}<td className={result?.status === 'DISTRIBUÍDO' ? 'result-ok' : 'result-fail'}><b>{result?.distribuidora || '—'}</b></td><td>{result?.status || '—'}</td></tr> })}</tbody></table></div>
          <div className="separator-actions"><button className="separator-secondary" type="button" onClick={() => { setAnalysis(null); setStep(3) }}>Ajustar regras</button><button className="separator-secondary" type="button" onClick={() => { setAnalysis(null); setRows([]); setHeaders([]); setStep(1) }}>Nova análise</button><button className="separator-primary" type="button" onClick={() => void exportFile()}>Exportar planilha final</button></div>
        </section>
      )}
    </main>
  )
}
