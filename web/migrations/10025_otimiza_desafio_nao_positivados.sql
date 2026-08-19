-- Reduz leituras/CPU da extração Cliente x Produto do Desafio de Gigantes.
CREATE INDEX IF NOT EXISTS idx_dg_metas_mes_consultor_ean
  ON desafio_gigantes_metas(ano_mes, escopo, consultor_id, status_identificacao, ean);

CREATE INDEX IF NOT EXISTS idx_clientes_consultor_carteira
  ON clientes(consultor_id, ativo, carteira_importada, id);

CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_datas
  ON pedidos(cliente_id, ativo, data_faturamento, data_pedido);

CREATE INDEX IF NOT EXISTS idx_itens_pedido_pedido_ean
  ON itens_pedido(pedido_id, ativo, ean);

CREATE INDEX IF NOT EXISTS idx_mercado_farma_precos_ean_uf
  ON mercado_farma_precos(ean, uf, estoque);
