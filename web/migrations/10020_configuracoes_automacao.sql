CREATE TABLE IF NOT EXISTS configuracoes_automacao (
  tipo TEXT PRIMARY KEY CHECK (tipo IN ('BUSSOLA','MERCADO_FARMA','AUDITORIA')),
  ativo INTEGER NOT NULL DEFAULT 0 CHECK (ativo IN (0,1)),
  intervalo_minutos INTEGER NOT NULL DEFAULT 30 CHECK (intervalo_minutos BETWEEN 5 AND 10080),
  parametros_json TEXT NOT NULL DEFAULT '{}',
  ultima_execucao_em TEXT,
  proxima_execucao_em TEXT,
  atualizado_por TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO configuracoes_automacao(
  tipo,ativo,intervalo_minutos,parametros_json,proxima_execucao_em,atualizado_por,atualizado_em
) VALUES
  ('BUSSOLA',1,30,'{}',CURRENT_TIMESTAMP,'Migração automática',CURRENT_TIMESTAMP),
  ('MERCADO_FARMA',1,30,'{"ufs":"MA,MT,PA,PI,TO"}',CURRENT_TIMESTAMP,'Migração automática',CURRENT_TIMESTAMP),
  ('AUDITORIA',0,1440,'{}',NULL,'Migração automática',CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS idx_configuracoes_automacao_proxima
  ON configuracoes_automacao(ativo,proxima_execucao_em);
