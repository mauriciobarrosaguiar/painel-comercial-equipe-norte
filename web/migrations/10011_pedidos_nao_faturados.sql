-- Preserva os valores sem imposto informados pelo Bússola para pedidos ainda não faturados.
ALTER TABLE itens_pedido ADD COLUMN valor_total_solicitado_sem_imposto REAL NOT NULL DEFAULT 0;
ALTER TABLE itens_pedido ADD COLUMN total_atendido_sem_imposto REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pedidos_pendentes_data
  ON pedidos(ativo, status, data_pedido);
