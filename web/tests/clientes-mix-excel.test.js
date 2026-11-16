import test from 'node:test'
import assert from 'node:assert/strict'
import { prepararCatalogoMix, comporPlanilhaClientes, workbookClientesMix } from '../functions/_lib/clientes-mix-excel.js'
import { periodoTresMesesBrasilia } from '../functions/_lib/mercado-farma-comercial.js'

const p = periodoTresMesesBrasilia(new Date('2026-11-16T15:00:00Z'))
const catalogo = prepararCatalogoMix([
  { id:'a',sku:'a1',ean:'7891111111111',descricao:'Medicamento prioritário',tipo_mix:'PRIORITARIO' },
  { id:'b',sku:'b1',ean:'7892222222222',descricao:'Medicamento lançamento',tipo_mix:'LANÇAMENTO' },
  { id:'c',sku:'c1',ean:'7893333333333',descricao:'Medicamento combate',tipo_mix:'COMBATE' },
])
test('separa apresentações e compara os últimos três meses líquidos', () => {
  const clientes = [
    {cnpj:'11111111000111',nome:'Farmácia A',cidade:'Belém',uf:'PA'},
    {cnpj:'22222222000122',nome:'Farmácia B',cidade:'Belém',uf:'PA'},
  ]
  const compras = [
    {cnpj:clientes[0].cnpj,ean:'7891111111111',mes:'2026-09',quantidade:10,pedidos:1},
    {cnpj:clientes[0].cnpj,ean:'7891111111111',mes:'2026-10',quantidade:-10,pedidos:0},
    {cnpj:clientes[1].cnpj,ean:'7892222222222',mes:'2026-11',quantidade:7,pedidos:2},
    {cnpj:clientes[1].cnpj,ean:'7892222222222',mes:'2026-08',quantidade:90,pedidos:1},
  ]
  const rows = comporPlanilhaClientes(clientes,catalogo,compras,p)
  assert.deepEqual(p.meses,['2026-09','2026-10','2026-11'])
  assert.equal(catalogo.length,2)
  assert.equal(rows.length,2)
  assert.equal(rows[0].prioritarios.faltantes,1)
  assert.equal(rows[0].produtos.find(x=>x.ean==='7891111111111').total,0)
  assert.equal(rows[1].lancamentos.comprados,1)
  assert.deepEqual(rows[1].produtos.find(x=>x.ean==='7892222222222').meses,[0,0,7])
  const zip=workbookClientesMix(rows,p,{busca:'Farmácia'})
  const data=new TextDecoder().decode(zip)
  assert.equal(data.slice(0,2),'PK')
  assert.match(data,/worksheets\/sheet3.xml/)
  assert.match(data,/01 11111111000111/)
  assert.match(data,/● COMPROU/)
  assert.match(data,/● NÃO COMPROU/)
  assert.match(data,/UN. 09\/26/)
  assert.match(data,/UN. 11\/26/)
})


test('XLSX multiabas respeita a sequência CT_Worksheet do Excel', () => {
  const clients = [
    { cnpj:'11111111000111',nome:'Farmácia & Filial <Centro>',cidade:'Palmas',uf:'TO' },
    { cnpj:'22222222000122',nome:'Filial 02',cidade:'Gurupi',uf:'TO' },
    { cnpj:'33333333000133',nome:'Filial 03',cidade:'Araguaína',uf:'TO' },
  ]
  const workbook = workbookClientesMix(comporPlanilhaClientes(clients,catalogo,[],p),p)
  const raw = new TextDecoder().decode(workbook)
  assert.equal(raw.slice(0,2),'PK')
  // Ordem obrigatória do tipo CT_Worksheet no ISO/IEC 29500-1:
  // sheetData -> autoFilter -> mergeCells -> pageMargins -> pageSetup.
  const pages = [...raw.matchAll(/<worksheet xmlns="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main">([\s\S]*?)<\/worksheet>/g)]
  assert.equal(pages.length, 4) // RESUMO + três CNPJs
  for (const [, xml] of pages) {
    const offsets = ['<sheetData>', '<autoFilter ', '<mergeCells ', '<pageMargins ', '<pageSetup '].map(tag => xml.indexOf(tag))
    assert.ok(offsets.every(index => index >= 0), 'Worksheet deve conter todas as seções')
    assert.deepEqual(offsets,[...offsets].sort((a,b)=>a-b),'A ordem OOXML deve ser estritamente respeitada')
    assert.ok(!xml.includes('Farmácia & Filial <Centro>'), 'Caracteres especiais não podem quebrar XML')
    assert.ok(!xml.includes('<t>Farmácia & Filial'), 'O ampersand precisa estar escapado')
  }
  assert.ok(raw.includes('Farmácia &amp; Filial &lt;Centro&gt;'))
})

test('pasta XLSX abre todas as abas por CNPJ sem precisar reparar o conteúdo', async () => {
  const { default: readAllSheets } = await import('read-excel-file/node')
  const clients = [
    { cnpj:'11111111000111',nome:'Farmácia A',cidade:'Palmas',uf:'TO' },
    { cnpj:'22222222000122',nome:'Drogaria B',cidade:'Gurupi',uf:'TO' },
  ]
  const purchases = [
    { cnpj:clients[0].cnpj,ean:'7891111111111',mes:'2026-09',quantidade:8,pedidos:1,ultima_compra:'2026-09-20' },
    { cnpj:clients[1].cnpj,ean:'7892222222222',mes:'2026-11',quantidade:3,pedidos:1,ultima_compra:'2026-11-12' },
  ]
  const bytes = workbookClientesMix(comporPlanilhaClientes(clients,catalogo,purchases,p),p)
  const buffer = Buffer.from(bytes)
  // read-excel-file 9.x retorna uma lista de { sheet, data }; readSheetNames foi removida.
  const sheets = await readAllSheets(buffer)
  assert.deepEqual(sheets.map(item => item.sheet),['RESUMO','01 11111111000111','02 22222222000122'])
  const [summary, client1, client2] = sheets.map(item => item.data)
  assert.equal(summary[0][0],'PAINEL COMERCIAL  |  COBERTURA DE MIX POR CLIENTE')
  assert.ok(client1.some(row => row[0] === 'TIPO MIX'))
  assert.ok(client2.some(row => row[0] === 'TIPO MIX'))
  assert.ok(client1.flat().some(value => String(value).includes('COMPROU')))
  assert.ok(client2.flat().some(value => String(value).includes('COMPROU')))
  assert.ok(client1.flat().includes(8))
  assert.ok(client2.flat().includes(3))
})
