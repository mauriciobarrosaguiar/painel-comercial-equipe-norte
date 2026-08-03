PRAGMA foreign_keys = ON;

-- Mantém o dono atual do cliente em pedidos.consultor_id, conforme a carteira oficial.
-- O novo campo registra quem originou o pedido no Bússola para a apuração de vendas.
ALTER TABLE pedidos ADD COLUMN consultor_bussola_id TEXT;
ALTER TABLE pedidos ADD COLUMN representante_bussola TEXT;

CREATE INDEX IF NOT EXISTS idx_pedidos_consultor_bussola
  ON pedidos(consultor_bussola_id, ativo, data_faturamento, data_pedido);
