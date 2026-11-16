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
