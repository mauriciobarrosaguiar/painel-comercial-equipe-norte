CREATE TABLE IF NOT EXISTS metas_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_id TEXT NOT NULL,
  ano_mes TEXT NOT NULL,
  escopo TEXT NOT NULL,
  consultor_id TEXT,
  ol_sem_combate REAL NOT NULL DEFAULT 0,
  ol_prioritarios REAL NOT NULL DEFAULT 0,
  ol_lancamentos REAL NOT NULL DEFAULT 0,
  clientes_positivados REAL NOT NULL DEFAULT 0,
  importacao_anterior_id TEXT,
  nova_importacao_id TEXT NOT NULL,
  substituida_em TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metas_historico_periodo
  ON metas_historico(ano_mes, substituida_em DESC);

CREATE INDEX IF NOT EXISTS idx_metas_historico_consultor
  ON metas_historico(consultor_id, ano_mes);
