import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequestGet as dashboard } from '../functions/api/dashboard.js'
import { onRequestGet as consultores } from '../functions/api/consultores.js'
import { onRequestGet as consultorPedidos } from '../functions/api/consultor-pedidos.js'
import { testDatabase } from './d1-fixture.js'

test('dashboard separa total, sem combate, combate e não classificados', async () => {
  const response = await dashboard({
    request: new Request('https://painel.local/api/dashboard?periodo=todo-periodo'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.equal(body.ol_total_faturado, 200)
  assert.equal(body.ol_sem_combate, 150)
  assert.equal(body.ol_prioritarios, 50)
  assert.equal(body.ol_combate, 40)
  assert.equal(body.clientes_com_venda, 1)
  assert.equal(body.clientes_sem_venda, 1)
  assert.equal(body.pedidos_nao_faturados, 3)
  assert.equal(body.valor_nao_faturado, 550)
  assert.equal(body.nao_faturados_por_consultor.length, 1)
  assert.equal(body.nao_faturados_por_consultor[0].nome, 'Ana')
  assert.equal(body.nao_faturados_por_consultor[0].pedidos_nao_faturados, 3)
  assert.equal(body.nao_faturados_por_consultor[0].valor_nao_faturado, 550)
})

test('dashboard atribui a venda ao representante do Bússola sem transferir a carteira do cliente', async () => {
  const DB = testDatabase()
  DB.raw.exec(`
    INSERT INTO consultores VALUES('co2','Bruno','PA',1,'PAINEL_EQUIPE','2026-07-01');
    INSERT INTO clientes(id,cnpj,nome_fantasia,cidade,uf,consultor_id,nome_gd,ativo,carteira_importada,setor_rep)
      VALUES('cl3','33333333000133','Farmácia C','Belém','PA','co2','GD Norte',1,1,'m0043999');
    INSERT INTO pedidos VALUES(
      'p7','P7','NF7','cl3','co2','2026-07-14','2026-07-14','FATURADO',25,
      'BUSSOLA',1,'2026-07-14','co1','Ana / Ana'
    );
    INSERT INTO itens_pedido(
      id,pedido_id,produto_id,ean,descricao,quantidade_faturada,valor_faturado,ativo,
      preco_unitario_sem_imposto,preco_unitario_com_imposto
    ) VALUES('i13','p7','linha','111','Linha',1,25,1,25,25);
  `)

  const response = await dashboard({
    request: new Request('https://painel.local/api/dashboard?periodo=todo-periodo&consultor=co1'),
    env: { DB },
  })
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.equal(body.ol_total_faturado, 225)
  assert.equal(body.ol_sem_combate, 175)
  assert.equal(body.pedidos_faturados, 2)
  assert.equal(body.clientes_ativos, 2)
  assert.equal(body.clientes_com_venda, 1)
  assert.match(body.regra_calculo.carteira, /representante de origem do Bússola/i)
})

test('módulo de consultores separa os não faturados por mix', async () => {
  const response = await consultores({
    request: new Request('https://painel.local/api/consultores?periodo=todo-periodo'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.equal(body.consultores.length, 1)
  assert.equal(body.consultores[0].ol_total_faturado, 200)
  assert.equal(body.consultores[0].ol_sem_combate, 150)
  assert.equal(body.consultores[0].ol_combate, 40)
  assert.equal(body.consultores[0].clientes_com_venda, 1)
  assert.equal(body.consultores[0].clientes_sem_venda, 1)
  assert.equal(body.consultores[0].pedidos_faturados, 1)
  assert.equal(body.consultores[0].pedidos_nao_faturados, 3)
  assert.equal(body.consultores[0].valor_nao_faturado, 550)
  assert.equal(body.consultores[0].valor_nao_faturado_sem_combate, 550)
  assert.equal(body.consultores[0].valor_nao_faturado_lancamentos, 0)
  assert.equal(body.consultores[0].valor_nao_faturado_prioritarios, 80)
  assert.equal(body.consultores[0].valor_nao_faturado_combate, 0)
  assert.equal(body.totais.pedidos_nao_faturados, 3)
  assert.equal(body.totais.valor_nao_faturado, 550)
  assert.equal(body.totais.valor_nao_faturado_sem_combate, 550)
  assert.equal(body.totais.valor_nao_faturado_lancamentos, 0)
  assert.equal(body.totais.valor_nao_faturado_prioritarios, 80)
  assert.equal(body.totais.valor_nao_faturado_combate, 0)
})

test('detalhe do consultor separa pedidos e valores não faturados por mix', async () => {
  const response = await consultorPedidos({
    request: new Request('https://painel.local/api/consultor-pedidos?periodo=todo-periodo&consultor=co1'),
    env: { DB: testDatabase() },
  })
  assert.equal(response.status, 200)
  const body = await response.json()

  assert.equal(body.consultor.nome, 'Ana')
  assert.equal(body.resumo.pedidos_faturados, 1)
  assert.equal(body.resumo.valor_faturado, 200)
  assert.equal(body.resumo.pedidos_nao_faturados, 3)
  assert.equal(body.resumo.valor_nao_faturado, 550)
  assert.equal(body.resumo.valor_nao_faturado_sem_combate, 550)
  assert.equal(body.resumo.valor_nao_faturado_lancamentos, 0)
  assert.equal(body.resumo.valor_nao_faturado_prioritarios, 80)
  assert.equal(body.resumo.valor_nao_faturado_combate, 0)
  assert.equal(body.faturados.length, 1)
  assert.equal(body.nao_faturados.length, 3)

  const p4 = body.nao_faturados.find((item) => item.pedido === 'P4')
  const p5 = body.nao_faturados.find((item) => item.pedido === 'P5')
  const p6 = body.nao_faturados.find((item) => item.pedido === 'P6')
  assert.equal(p4.valor_considerado, 200)
  assert.equal(p4.valor_sem_combate, 200)
  assert.equal(p4.valor_prioritarios, 80)
  assert.equal(p5.valor_considerado, 300)
  assert.equal(p5.valor_sem_combate, 300)
  assert.equal(p6.valor_considerado, 50)
  assert.equal(p6.valor_sem_combate, 50)
})
