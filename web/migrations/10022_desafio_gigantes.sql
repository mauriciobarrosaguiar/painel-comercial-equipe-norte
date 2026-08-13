CREATE TABLE IF NOT EXISTS desafio_gigantes_produtos (
  sku TEXT PRIMARY KEY,
  ean TEXT,
  produto TEXT,
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  tentativas INTEGER NOT NULL DEFAULT 0,
  ultima_consulta_em TEXT,
  mensagem TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_desafio_gigantes_produtos_status
  ON desafio_gigantes_produtos(status, ultima_consulta_em);
