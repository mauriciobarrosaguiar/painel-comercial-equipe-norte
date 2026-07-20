CREATE TABLE IF NOT EXISTS auditorias_calculos (
  id TEXT PRIMARY KEY,
  periodo_inicio TEXT,
  periodo_fim TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok', 'atencao', 'critico')),
  total_alertas INTEGER NOT NULL DEFAULT 0,
  resultado_json TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auditorias_calculos_criado_em
  ON auditorias_calculos(criado_em DESC);
