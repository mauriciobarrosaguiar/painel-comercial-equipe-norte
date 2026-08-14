CREATE TABLE IF NOT EXISTS desafio_gigantes_fechamentos (
  id TEXT PRIMARY KEY,
  ano_mes TEXT NOT NULL,
  escopo TEXT NOT NULL CHECK(escopo IN ('gerente','consultor')),
  referencia_id TEXT NOT NULL DEFAULT '',
  referencia_nome TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  fechado_em TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ano_mes, escopo, referencia_id)
);

CREATE INDEX IF NOT EXISTS idx_desafio_gigantes_fechamentos_mes
  ON desafio_gigantes_fechamentos(ano_mes, escopo, referencia_nome);
