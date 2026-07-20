CREATE TABLE IF NOT EXISTS integracao_credenciais (
  integracao TEXT PRIMARY KEY,
  usuario_mascarado TEXT NOT NULL,
  credencial_cifrada TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'configurada',
  mensagem_status TEXT,
  testado_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_integracao_credenciais_status
  ON integracao_credenciais(status);
