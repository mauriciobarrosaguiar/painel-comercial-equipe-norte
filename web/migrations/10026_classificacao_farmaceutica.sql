-- Classificacao sanitaria independente do MIX comercial e dos precos por UF.
-- Toda classificacao exige fonte/validacao por EAN da apresentacao.
CREATE TABLE IF NOT EXISTS produto_classificacao_farmaceutica (
  ean TEXT PRIMARY KEY,
  categoria TEXT NOT NULL CHECK (categoria IN ('OTC','PRESCRICAO','CONTROLADO','ANTIMICROBIANO','NAO_CLASSIFICADO')),
  fonte TEXT NOT NULL DEFAULT 'CONFERENCIA_MANUAL',
  atualizado_por TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_produto_classificacao_categoria
  ON produto_classificacao_farmaceutica(categoria,ean);
