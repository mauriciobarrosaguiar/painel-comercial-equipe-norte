ALTER TABLE foco_consultores ADD COLUMN meta_quantidade REAL NOT NULL DEFAULT 0;
ALTER TABLE foco_consultores ADD COLUMN meta_valor REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS colaboradores_acesso (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  email TEXT,
  nome TEXT NOT NULL,
  consultor_id TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  ultimo_acesso_em TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (consultor_id) REFERENCES consultores(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_colaboradores_email ON colaboradores_acesso(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_colaboradores_consultor ON colaboradores_acesso(consultor_id,ativo);

WITH acessos_corporativos AS (
  SELECT co.id consultor_id,co.nome,
    LOWER(TRIM(MIN(CASE WHEN LOWER(TRIM(COALESCE(cl.setor_rep,''))) GLOB 'm[0-9]*' OR LOWER(TRIM(COALESCE(cl.setor_rep,''))) LIKE '%@ems.com.br' THEN cl.setor_rep END))) acesso
  FROM consultores co
  JOIN clientes cl ON cl.consultor_id=co.id AND cl.carteira_importada=1
  WHERE co.ativo=1 AND co.origem='PAINEL_EQUIPE'
  GROUP BY co.id,co.nome
)
INSERT OR IGNORE INTO colaboradores_acesso(id,login,email,nome,consultor_id,ativo)
SELECT 'ac-'||consultor_id,
  CASE WHEN INSTR(acesso,'@')>0 THEN SUBSTR(acesso,1,INSTR(acesso,'@')-1) ELSE acesso END,
  CASE WHEN INSTR(acesso,'@')>0 THEN acesso ELSE acesso||'@ems.com.br' END,
  nome,consultor_id,1
FROM acessos_corporativos WHERE COALESCE(acesso,'')<>'';

INSERT OR IGNORE INTO colaboradores_acesso(id,login,email,nome,consultor_id,ativo)
VALUES('ac-mauricio','m0043497','m0043497@ems.com.br','Maurício Barros de Aguiar',(SELECT id FROM consultores WHERE UPPER(nome) LIKE '%MAURICIO%' LIMIT 1),1);

CREATE TABLE IF NOT EXISTS historico_clientes_importado (
  id TEXT PRIMARY KEY,
  ano_mes TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  cliente_id TEXT,
  faturamento REAL NOT NULL DEFAULT 0,
  pedidos INTEGER NOT NULL DEFAULT 0,
  produtos INTEGER NOT NULL DEFAULT 0,
  quantidade REAL NOT NULL DEFAULT 0,
  origem_arquivo TEXT,
  importado_por TEXT,
  importado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ano_mes,cnpj),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE INDEX IF NOT EXISTS idx_historico_cliente_mes ON historico_clientes_importado(cliente_id,ano_mes);
CREATE INDEX IF NOT EXISTS idx_historico_cnpj_mes ON historico_clientes_importado(cnpj,ano_mes);
