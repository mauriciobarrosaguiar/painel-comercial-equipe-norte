ALTER TABLE clientes ADD COLUMN carteira_importacao_id TEXT;
ALTER TABLE produtos ADD COLUMN mix_importacao_id TEXT;
ALTER TABLE produtos ADD COLUMN mercado_farma_importacao_id TEXT;
ALTER TABLE metas ADD COLUMN importacao_id TEXT;

CREATE INDEX IF NOT EXISTS idx_clientes_importacao ON clientes(carteira_importacao_id);
CREATE INDEX IF NOT EXISTS idx_produtos_mix_importacao ON produtos(mix_importacao_id);
CREATE INDEX IF NOT EXISTS idx_produtos_mf_importacao ON produtos(mercado_farma_importacao_id);
