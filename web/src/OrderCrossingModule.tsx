import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import readWorkbook from 'read-excel-file/browser'

type MarketRow = {
  uf: string; ean: string; produto: string; distribuidora: string; estoque: number;
  preco_sem_imposto: number; preco_com_imposto: number; melhor_preco: number | null
}
type ClientRow = { produto: string; quantidade: number; ean?: string }
type Learning = Record<string, { ean: string; produto: string }>
type Result = ClientRow & {
  status: 'confirmado' | 'revisar' | 'nao_encontrado'; score: number; motivo: string;
  match?: MarketRow; alternativas: MarketRow[]
}

const STORAGE_KEY = 'painel_norte_cruzamento_aprendizado_v1'
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/(\d),(\d)/g, '$1.$2').replace(/[^A-Z0-9.+/%]+/g, ' ').replace(/\s+/g, ' ').trim()

const aliases: Array<[RegExp, string]> = [
  [/\bHCTZ\b/g, 'HIDROCLOROTIAZIDA'], [/\bCPR?\b|\bCOMP\b/g, 'COMPRIMIDO'], [/\bCAPS?\b/g, 'CAPSULA'],
  [/\bXPE\b/g, 'XAROPE'], [/\bGTS?\b/g, 'GOTAS'], [/\bSUSP\b/g, 'SUSPENSAO'], [/\bBG\b/g, 'BISNAGA'],
  [/\bPOT\b/g, 'POTASSICA'], [/\bCLOR\b/g, 'CLORIDRATO'], [/\bREV\b/g, 'REVESTIDO'],
]
const canonical = (value: unknown) => aliases.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), normalize(value))
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '')
const tokens = (value: unknown) => new Set(canonical(value).split(' ').filter(token => token.length > 1))

function dosages(value: unknown) {
  const text = canonical(value)
  const found: string[] = []
  const combo = /(\d+(?:\.\d+)?)\s*[+/]\s*(\d+(?:\.\d+)?)\s*(MCG|MG|G|ML|%)/g
  for (const match of text.matchAll(combo)) { found.push(`${Number(match[1])}${match[3]}`, `${Number(match[2])}${match[3]}`) }
  const simple = /(\d+(?:\.\d+)?)\s*(MCG|MG|G|ML|%)(?:\s*\/\s*(ML|G))?/g
  for (const match of text.matchAll(simple)) found.push(`${Number(match[1])}${match[2]}${match[3] ? `/${match[3]}` : ''}`)
  return [...new Set(found)].sort()
}
function pack(value: unknown) {
  const text = canonical(value)
  const patterns = [/\bC\s*\/?\s*(\d{1,3})\b/, /\bX\s*(\d{1,3})\b/, /\b(\d{1,3})\s*(?:COMPRIMIDO|CAPSULA|DOSES?|SACHES?)\b/]
  for (const pattern of patterns) { const match = text.match(pattern); if (match) return Number(match[1]) }
  return null
}
function form(value: unknown) {
  const text = canonical(value)
  const forms = ['COMPRIMIDO', 'CAPSULA', 'XAROPE', 'GOTAS', 'CREME', 'POMADA', 'SUSPENSAO', 'SOLUCAO', 'SPRAY', 'INJETAVEL', 'OVULO', 'GEL']
  return forms.find(item => text.includes(item)) || ''
}
function similarity(a: unknown, b: unknown) {
  const ta = tokens(a); const tb = tokens(b)
  if (!ta.size || !tb.size) return 0
  let common = 0; ta.forEach(token => { if (tb.has(token)) common += 1 })
  return common / Math.max(ta.size, tb.size)
}
function incompatible(a: string, b: string) {
  const da = dosages(a); const db = dosages(b)
  if (da.length && db.length && da.join('|') !== db.join('|')) return 'Concentração divergente'
  const pa = pack(a); const pb = pack(b)
  if (pa && pb && pa !== pb) return 'Apresentação divergente'
  const fa = form(a); const fb = form(b)
  if (fa && fb && fa !== fb) return 'Forma farmacêutica divergente'
  return ''
}
function bestRows(rows: MarketRow[]) {
  const byEan = new Map<string, MarketRow>()
  for (const row of rows) {
    const ean = digits(row.ean); if (!ean) continue
    const previous = byEan.get(ean)
    const price = Number(row.preco_sem_imposto || 0); const previousPrice = Number(previous?.preco_sem_imposto || 0)
    if (!previous || (price > 0 && (previousPrice <= 0 || price < previousPrice))) byEan.set(ean, { ...row, ean })
  }
  return [...byEan.values()]
}
function analyse(item: ClientRow, base: MarketRow[], learning: Learning): Result {
  const key = canonical(item.produto)
  const learned = learning[key]
  if (learned) {
    const hit = base.find(row => digits(row.ean) === digits(learned.ean))
    if (hit) return { ...item, status: 'confirmado', score: 100, motivo: 'Correspondência já confirmada anteriormente', match: hit, alternativas: [] }
  }
  if (item.ean && digits(item.ean).length >= 8) {
    const hit = base.find(row => digits(row.ean) === digits(item.ean))
    if (hit) return { ...item, status: 'confirmado', score: 100, motivo: 'EAN informado pelo cliente', match: hit, alternativas: [] }
  }
  const ranked = base.map(row => {
    const block = incompatible(item.produto, row.produto)
    if (block) return { row, score: 0, block }
    let score = similarity(item.produto, row.produto) * 70
    const da = dosages(item.produto); const db = dosages(row.produto)
    if (da.length && db.length && da.join('|') === db.join('|')) score += 18
    const pa = pack(item.produto); const pb = pack(row.produto)
    if (pa && pb && pa === pb) score += 8
    const fa = form(item.produto); const fb = form(row.produto)
    if (fa && fb && fa === fb) score += 4
    return { row, score: Math.min(99, Math.round(score)), block: '' }
  }).filter(item => !item.block && item.score >= 45).sort((a, b) => b.score - a.score)
  const top = ranked[0]
  if (!top) return { ...item, status: 'nao_encontrado', score: 0, motivo: 'Nenhuma apresentação compatível encontrada', alternativas: [] }
  const second = ranked[1]
  const ambiguous = !!second && top.score - second.score < 8
  const safe = top.score >= 88 && !ambiguous
  return {
    ...item, status: safe ? 'confirmado' : 'revisar', score: top.score,
    motivo: ambiguous ? 'Há mais de uma apresentação parecida' : safe ? 'Princípio, dose e apresentação compatíveis' : 'Correspondência provável: precisa de conferência',
    match: top.row, alternativas: ranked.slice(1, 4).map(item => item.row),
  }
}

function parseDelimited(text: string): ClientRow[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split(/[;\t|]/).map(part => part.trim()).filter(Boolean)
    if (parts.length > 1 && /^\d+(?:[.,]\d+)?$/.test(parts[parts.length - 1])) return { produto: parts.slice(0, -1).join(' '), quantidade: Number(parts[parts.length - 1].replace(',', '.')) || 1 }
    return { produto: line, quantidade: 1 }
  }).filter(row => row.produto.length > 2)
}
function headerIndex(matrix: unknown[][]) {
  for (let i = 0; i < Math.min(15, matrix.length); i += 1) {
    const row = (matrix[i] || []).map(value => normalize(value))
    if (row.some(value => /PRODUTO|DESCRICAO|ITEM|PRINCIPIO/.test(value))) return i
  }
  return -1
}
async function parseFile(file: File): Promise<ClientRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) {
    const workbook = await readWorkbook(file); const matrix = workbook[0]?.data || []
    const hi = headerIndex(matrix)
    if (hi < 0) return matrix.map(row => ({ produto: String(row?.[0] ?? '').trim(), quantidade: Number(row?.[1] ?? 1) || 1 })).filter(row => row.produto)
    const headers = (matrix[hi] || []).map(value => normalize(value))
    const productCol = headers.findIndex(value => /PRODUTO|DESCRICAO|ITEM|PRINCIPIO/.test(value))
    const qtyCol = headers.findIndex(value => /QTDE|QTD|QUANTIDADE/.test(value))
    const eanCol = headers.findIndex(value => /EAN|COD.*BARRA/.test(value))
    return matrix.slice(hi + 1).map(row => ({ produto: String(row?.[productCol] ?? '').trim(), quantidade: qtyCol >= 0 ? Number(row?.[qtyCol] ?? 1) || 1 : 1, ean: eanCol >= 0 ? digits(row?.[eanCol]) : '' })).filter(row => row.produto)
  }
  return parseDelimited(await file.text())
}
function csv(results: Result[]) {
  const q = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const header = ['PRODUTO CLIENTE','QTDE','EAN','PRODUTO IDENTIFICADO','ESTOQUE','DIST','MELHOR PRECO','PRECO C/ IMPOSTO','STATUS','CONFIANCA']
  const lines = results.map(r => [r.produto,r.quantidade,r.match?.ean||'',r.match?.produto||'',r.match?.estoque||'',r.match?.distribuidora||'',r.match?.preco_sem_imposto||'',r.match?.preco_com_imposto||'',r.status,r.score].map(q).join(';'))
  return '\ufeff' + [header.join(';'), ...lines].join('\n')
}

export default function OrderCrossingModule({ onBack }: { onBack: () => void }) {
  const [uf, setUf] = useState('TO'); const [ufs, setUfs] = useState<string[]>([])
  const [base, setBase] = useState<MarketRow[]>([]); const [items, setItems] = useState<ClientRow[]>([])
  const [pasted, setPasted] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const [learning, setLearning] = useState<Learning>(() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} } })
  useEffect(() => {
    setLoading(true); setError('')
    fetch(`/api/mercado-farma?uf=${encodeURIComponent(uf)}&estoque=1&limite=5000`, { cache: 'no-store' })
      .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.erro || 'Falha ao carregar preços.'); setUfs(data.filtros?.ufs || []); setBase(bestRows(data.resultados || [])) })
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoading(false))
  }, [uf])
  const results = useMemo(() => items.map(item => analyse(item, base, learning)), [items, base, learning])
  const counts = useMemo(() => ({ ok: results.filter(r => r.status === 'confirmado').length, review: results.filter(r => r.status === 'revisar').length, miss: results.filter(r => r.status === 'nao_encontrado').length }), [results])
  function remember(result: Result, match: MarketRow) {
    const next = { ...learning, [canonical(result.produto)]: { ean: digits(match.ean), produto: match.produto } }; setLearning(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
    try { setItems(await parseFile(file)); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  function download() {
    const blob = new Blob([csv(results)], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `cruzamento-pedidos-${uf}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  return <main className="content">
    <section className="hero"><div><span className="eyebrow">Cotação inteligente</span><h1>Cruzamento de Pedidos</h1><p>Identifica o produto mesmo com abreviações, bloqueia divergências de dose/apresentação e cruza com preço, estoque e distribuidora do Mercado Farma.</p></div><div className="hero-actions"><button className="secondary-button" onClick={onBack}>Voltar</button>{results.length > 0 && <button className="primary-button" onClick={download}>Baixar CSV</button>}</div></section>
    <section className="filters"><label><span>UF da cotação</span><select value={uf} onChange={e => setUf(e.target.value)}>{(ufs.length ? ufs : ['TO','MA','MT','PA','PI']).map(item => <option key={item}>{item}</option>)}</select></label><div><span style={{fontSize:12,fontWeight:700}}>Base disponível</span><strong style={{display:'block',marginTop:8}}>{loading ? 'Carregando…' : `${base.length.toLocaleString('pt-BR')} EANs com estoque`}</strong></div></section>
    {error && <div className="alert alert-error">{error}</div>}
    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:16,marginTop:18}}>
      <article className="base-card"><h3>Anexar lista do cliente</h3><p>Excel (.xlsx), CSV ou TXT. Procuro automaticamente as colunas de produto, quantidade e EAN.</p><label className="file-button"><input type="file" accept=".xlsx,.csv,.txt" onChange={e => void upload(e)}/>Selecionar arquivo</label></article>
      <article className="base-card"><h3>Ou colar a lista</h3><p>Use uma linha por produto. Para quantidade, use <b>produto;quantidade</b>.</p><textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={7} placeholder={'Fexofenadina 180mg c/10;6\nLosartana + HCTZ 50/12,5 c/30;12'} style={{width:'100%',boxSizing:'border-box',padding:12,borderRadius:12,border:'1px solid #d6d9df'}}/><button className="outline-button" type="button" onClick={() => setItems(parseDelimited(pasted))}>Analisar texto</button></article>
    </section>
    {results.length > 0 && <>
      <section className="integration-status-grid" style={{marginTop:20}}><div><span>Itens</span><strong>{results.length}</strong></div><div><span>Confirmados</span><strong>{counts.ok}</strong></div><div><span>Conferir</span><strong>{counts.review}</strong></div><div><span>Não encontrados</span><strong>{counts.miss}</strong></div></section>
      <div className="alert" style={{marginTop:16}}><b>Regra de segurança:</b> dose, apresentação e forma farmacêutica explicitamente diferentes nunca são aceitas só por semelhança do nome. Itens duvidosos ficam para conferência.</div>
      <section style={{display:'grid',gap:12,marginTop:16}}>{results.map((result, index) => <article className="base-card" key={`${result.produto}-${index}`}>
        <div style={{display:'flex',gap:12,justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap'}}><div><small>PRODUTO DO CLIENTE · QTDE {result.quantidade}</small><h3 style={{margin:'5px 0'}}>{result.produto}</h3><span>{result.motivo}</span></div><span className={result.status === 'confirmado' ? 'base-count ready' : result.status === 'revisar' ? 'base-count' : 'base-count missing'}>{result.status === 'confirmado' ? 'Confirmado' : result.status === 'revisar' ? 'Conferir' : 'Não encontrado'} · {result.score}%</span></div>
        {result.match && <div style={{marginTop:14,padding:14,borderRadius:12,background:'#f7f8fa'}}><b>{result.match.produto}</b><div style={{display:'flex',gap:18,flexWrap:'wrap',marginTop:8}}><span>EAN <b>{result.match.ean}</b></span><span>Estoque <b>{Number(result.match.estoque||0).toLocaleString('pt-BR')}</b></span><span>Dist <b>{result.match.distribuidora}</b></span><span>Melhor preço <b>{money.format(Number(result.match.preco_sem_imposto||0))}</b></span><span>Com imposto <b>{money.format(Number(result.match.preco_com_imposto||0))}</b></span></div>{result.status === 'revisar' && <button className="outline-button" style={{marginTop:10}} onClick={() => remember(result, result.match!)}>Confirmar este produto e aprender</button>}</div>}
        {result.status === 'revisar' && result.alternativas.length > 0 && <details style={{marginTop:10}}><summary>Ver outras apresentações possíveis</summary><div style={{display:'grid',gap:8,marginTop:8}}>{result.alternativas.map(alt => <button key={alt.ean} className="outline-button" style={{textAlign:'left'}} onClick={() => remember(result, alt)}>{alt.produto} · EAN {alt.ean}</button>)}</div></details>}
      </article>)}</section>
    </>}
  </main>
}
