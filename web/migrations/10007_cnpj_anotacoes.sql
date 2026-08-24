CREATE TABLE IF NOT EXISTS cnpj_anotacoes (
  id TEXT PRIMARY KEY,
  consultor_id TEXT NOT NULL,
  cnpj TEXT NOT NULL UNIQUE,
  razao_social TEXT NOT NULL DEFAULT '',
  nome_contato TEXT NOT NULL DEFAULT '',
  telefone TEXT NOT NULL DEFAULT '',
  observacao TEXT NOT NULL DEFAULT '',
  acao_painel TEXT NOT NULL DEFAULT 'INCLUIR',
  criado_por TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cnpj_anotacoes_consultor ON cnpj_anotacoes(consultor_id);
CREATE INDEX IF NOT EXISTS idx_cnpj_anotacoes_acao ON cnpj_anotacoes(acao_painel);
