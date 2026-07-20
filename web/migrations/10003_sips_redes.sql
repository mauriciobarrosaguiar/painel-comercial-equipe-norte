CREATE TABLE IF NOT EXISTS sips (
  id TEXT PRIMARY KEY,
  id_legado TEXT,
  nome TEXT NOT NULL,
  meta_mes REAL NOT NULL DEFAULT 0,
  pagamento_percentual REAL NOT NULL DEFAULT 0,
  acesso_publico_ativo INTEGER NOT NULL DEFAULT 1,
  acesso_publico_expira_em TEXT,
  origem TEXT NOT NULL DEFAULT 'LEGADO',
  ativo INTEGER NOT NULL DEFAULT 1,
  importacao_id TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS redes (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  origem TEXT NOT NULL DEFAULT 'LEGADO_SIP',
  ativo INTEGER NOT NULL DEFAULT 1,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sip_redes (
  sip_id TEXT NOT NULL,
  rede_id TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  importacao_id TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sip_id, rede_id),
  FOREIGN KEY (sip_id) REFERENCES sips(id),
  FOREIGN KEY (rede_id) REFERENCES redes(id)
);

CREATE TABLE IF NOT EXISTS sip_clientes (
  sip_id TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  cliente_id TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  importacao_id TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sip_id, cnpj),
  FOREIGN KEY (sip_id) REFERENCES sips(id),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS sip_recados (
  id TEXT PRIMARY KEY,
  sip_id TEXT NOT NULL,
  titulo TEXT NOT NULL,
  comentario TEXT,
  status TEXT NOT NULL DEFAULT 'Pendente',
  imagem_nome TEXT,
  imagem_tipo TEXT,
  imagem_base64 TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  importacao_id TEXT,
  FOREIGN KEY (sip_id) REFERENCES sips(id)
);

CREATE TABLE IF NOT EXISTS sip_migracao_erros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  importacao_id TEXT NOT NULL,
  sip_id TEXT,
  tipo TEXT NOT NULL,
  referencia TEXT,
  mensagem TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sips_ativo ON sips(ativo, nome);
CREATE INDEX IF NOT EXISTS idx_sip_clientes_cliente ON sip_clientes(cliente_id, ativo);
CREATE INDEX IF NOT EXISTS idx_sip_clientes_cnpj ON sip_clientes(cnpj, ativo);
CREATE INDEX IF NOT EXISTS idx_sip_redes_rede ON sip_redes(rede_id, ativo);
CREATE INDEX IF NOT EXISTS idx_sip_recados_sip ON sip_recados(sip_id, ativo);
CREATE INDEX IF NOT EXISTS idx_sip_erros_importacao ON sip_migracao_erros(importacao_id);
