CREATE TABLE IF NOT EXISTS foco_historico (
  id TEXT PRIMARY KEY,
  semana_inicio TEXT NOT NULL,
  semana_fim TEXT NOT NULL,
  resultado_json TEXT NOT NULL,
  total_produtos INTEGER NOT NULL DEFAULT 0,
  total_consultores INTEGER NOT NULL DEFAULT 0,
  fechado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(semana_inicio, semana_fim)
);

CREATE INDEX IF NOT EXISTS idx_foco_historico_periodo
  ON foco_historico(semana_fim DESC, semana_inicio DESC);
