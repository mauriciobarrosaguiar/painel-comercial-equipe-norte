-- Mantém versões antigas de pedidos e itens sem que participem dos cálculos atuais.
ALTER TABLE pedidos ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pedidos ADD COLUMN ultima_extracao_id TEXT;

ALTER TABLE itens_pedido ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1;
ALTER TABLE itens_pedido ADD COLUMN ultima_extracao_id TEXT;

CREATE INDEX IF NOT EXISTS idx_pedidos_data_faturamento
  ON pedidos(data_faturamento);
CREATE INDEX IF NOT EXISTS idx_pedidos_origem_ativo_status
  ON pedidos(origem, ativo, status);
CREATE INDEX IF NOT EXISTS idx_pedidos_numero
  ON pedidos(pedido_origem);
CREATE INDEX IF NOT EXISTS idx_itens_pedido_ativo
  ON itens_pedido(pedido_id, ativo);
CREATE INDEX IF NOT EXISTS idx_itens_produto
  ON itens_pedido(produto_id);
