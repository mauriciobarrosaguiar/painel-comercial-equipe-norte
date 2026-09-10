CREATE TABLE IF NOT EXISTS desafio_gigantes_arquivos (
  ano_mes TEXT PRIMARY KEY,
  nome_arquivo TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  tamanho_bytes INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  importado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS desafio_gigantes_arquivo_chunks (
  ano_mes TEXT NOT NULL,
  indice INTEGER NOT NULL,
  conteudo_base64 TEXT NOT NULL,
  PRIMARY KEY (ano_mes, indice)
);

CREATE INDEX IF NOT EXISTS idx_desafio_gigantes_arquivo_chunks_mes
  ON desafio_gigantes_arquivo_chunks(ano_mes, indice);
