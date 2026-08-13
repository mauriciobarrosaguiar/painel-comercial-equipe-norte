CREATE TABLE IF NOT EXISTS cruzamento_pedidos_aprendizado (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_cnpj TEXT NOT NULL DEFAULT '',
  texto_cliente TEXT NOT NULL,
  texto_normalizado TEXT NOT NULL,
  ean TEXT NOT NULL,
  produto_oficial TEXT NOT NULL DEFAULT '',
  confirmacoes INTEGER NOT NULL DEFAULT 1,
  rejeicoes INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cruzamento_aprendizado_cliente_texto
ON cruzamento_pedidos_aprendizado(cliente_cnpj, texto_normalizado);

CREATE INDEX IF NOT EXISTS idx_cruzamento_aprendizado_ean
ON cruzamento_pedidos_aprendizado(ean);
