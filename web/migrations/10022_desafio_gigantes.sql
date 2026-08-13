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

CREATE TABLE IF NOT EXISTS desafio_gigantes_metas (
  id TEXT PRIMARY KEY,
  ano_mes TEXT NOT NULL,
  escopo TEXT NOT NULL,
  consultor_id TEXT,
  nome_colaborador TEXT NOT NULL,
  setor TEXT NOT NULL,
  sku TEXT NOT NULL,
  produto_planilha TEXT,
  meta_positivacao REAL NOT NULL DEFAULT 0,
  meta_giro REAL NOT NULL DEFAULT 0,
  ean TEXT,
  produto_identificado TEXT,
  status_identificacao TEXT NOT NULL DEFAULT 'PENDENTE',
  importacao_id TEXT,
  atualizado_em TEXT NOT NULL,
  UNIQUE(ano_mes, escopo, setor, sku)
);

CREATE INDEX IF NOT EXISTS idx_desafio_gigantes_metas_mes
  ON desafio_gigantes_metas(ano_mes, escopo, consultor_id);

CREATE INDEX IF NOT EXISTS idx_desafio_gigantes_metas_sku
  ON desafio_gigantes_metas(sku);
