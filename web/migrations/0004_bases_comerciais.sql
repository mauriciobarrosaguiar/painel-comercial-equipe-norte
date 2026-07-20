PRAGMA foreign_keys = ON;

ALTER TABLE consultores ADD COLUMN origem TEXT NOT NULL DEFAULT 'LEGADO';

ALTER TABLE clientes ADD COLUMN nome_gd TEXT;
ALTER TABLE clientes ADD COLUMN situacao TEXT;
ALTER TABLE clientes ADD COLUMN grupo_economico TEXT;
ALTER TABLE clientes ADD COLUMN rede_associacao TEXT;
ALTER TABLE clientes ADD COLUMN bandeira TEXT;
ALTER TABLE clientes ADD COLUMN setor_rep TEXT;
ALTER TABLE clientes ADD COLUMN foco_pex TEXT;
ALTER TABLE clientes ADD COLUMN positivacao TEXT;
ALTER TABLE clientes ADD COLUMN carteira_importada INTEGER NOT NULL DEFAULT 0;

ALTER TABLE produtos ADD COLUMN mercado_farma_ativo INTEGER NOT NULL DEFAULT 0;

-- Os vínculos existentes vieram incorretamente da coluna REPRESENTANTE do Bússola.
-- A carteira será reconstruída exclusivamente pela base PAINEL EQUIPE NORTE.
UPDATE pedidos SET consultor_id = NULL;
UPDATE clientes SET consultor_id = NULL, carteira_importada = 0;
UPDATE consultores SET ativo = 0, origem = 'BUSSOLA_LEGADO';

CREATE INDEX IF NOT EXISTS idx_clientes_carteira ON clientes(carteira_importada, ativo);
CREATE INDEX IF NOT EXISTS idx_clientes_gd ON clientes(nome_gd);
CREATE INDEX IF NOT EXISTS idx_consultores_origem ON consultores(origem, ativo);
CREATE INDEX IF NOT EXISTS idx_produtos_mercado_farma ON produtos(mercado_farma_ativo, ativo);
