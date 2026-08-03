ALTER TABLE metas_historico ADD COLUMN demanda_sem_combate REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS produtos_mix_sap (
  sku TEXT PRIMARY KEY,
  molecula TEXT,
  descricao TEXT,
  tipo_mix TEXT NOT NULL DEFAULT 'SEM CLASSIFICACAO',
  ativo INTEGER NOT NULL DEFAULT 1,
  importacao_id TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_produtos_mix_sap_tipo
  ON produtos_mix_sap(tipo_mix, ativo);

CREATE INDEX IF NOT EXISTS idx_produtos_mix_sap_importacao
  ON produtos_mix_sap(importacao_id);
