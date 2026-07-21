ALTER TABLE foco_semanal ADD COLUMN meta_clientes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE foco_semanal ADD COLUMN meta_valor REAL NOT NULL DEFAULT 0;
ALTER TABLE foco_semanal ADD COLUMN observacoes TEXT;
ALTER TABLE foco_semanal ADD COLUMN criado_por TEXT;
ALTER TABLE foco_semanal ADD COLUMN atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS foco_clientes (
  foco_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (foco_id, cliente_id),
  FOREIGN KEY (foco_id) REFERENCES foco_semanal(id),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS foco_consultores (
  foco_id TEXT NOT NULL,
  consultor_id TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (foco_id, consultor_id),
  FOREIGN KEY (foco_id) REFERENCES foco_semanal(id),
  FOREIGN KEY (consultor_id) REFERENCES consultores(id)
);

CREATE INDEX IF NOT EXISTS idx_foco_periodo_ativo ON foco_semanal(semana_inicio,semana_fim,ativo);
CREATE INDEX IF NOT EXISTS idx_foco_ean_ativo ON foco_semanal(ean,ativo);
CREATE INDEX IF NOT EXISTS idx_foco_clientes_cliente ON foco_clientes(cliente_id,ativo);
CREATE INDEX IF NOT EXISTS idx_foco_consultores_consultor ON foco_consultores(consultor_id,ativo);
