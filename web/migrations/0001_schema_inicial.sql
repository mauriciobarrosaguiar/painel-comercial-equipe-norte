PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'visualizador' CHECK (perfil IN ('administrador', 'gerente', 'consultor', 'visualizador')),
  consultor_id TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consultores (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  setor TEXT,
  email TEXT,
  uf TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY,
  cnpj TEXT NOT NULL UNIQUE,
  razao_social TEXT,
  nome_fantasia TEXT,
  cidade TEXT,
  uf TEXT,
  consultor_id TEXT,
  grupo_sip TEXT,
  proprietario_diretor TEXT,
  comprador_gerente TEXT,
  cargo TEXT,
  celular TEXT,
  email TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (consultor_id) REFERENCES consultores(id)
);

CREATE TABLE IF NOT EXISTS produtos (
  id TEXT PRIMARY KEY,
  ean TEXT NOT NULL UNIQUE,
  sku TEXT,
  descricao TEXT NOT NULL,
  laboratorio TEXT,
  tipo_mix TEXT NOT NULL DEFAULT 'SEM CLASSIFICACAO',
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  pedido_origem TEXT NOT NULL,
  nota_fiscal TEXT,
  cliente_id TEXT,
  consultor_id TEXT,
  centro_distribuicao TEXT,
  uf_centro_distribuicao TEXT,
  data_pedido TEXT,
  data_faturamento TEXT,
  status TEXT,
  valor_faturado REAL NOT NULL DEFAULT 0,
  origem TEXT NOT NULL DEFAULT 'BUSSOLA',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (origem, pedido_origem, nota_fiscal),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (consultor_id) REFERENCES consultores(id)
);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id TEXT PRIMARY KEY,
  pedido_id TEXT NOT NULL,
  produto_id TEXT,
  ean TEXT,
  descricao TEXT,
  quantidade_solicitada REAL NOT NULL DEFAULT 0,
  quantidade_atendida REAL NOT NULL DEFAULT 0,
  quantidade_faturada REAL NOT NULL DEFAULT 0,
  quantidade_cancelada REAL NOT NULL DEFAULT 0,
  preco_unitario_sem_imposto REAL NOT NULL DEFAULT 0,
  preco_unitario_com_imposto REAL NOT NULL DEFAULT 0,
  valor_faturado REAL NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE TABLE IF NOT EXISTS metas (
  id TEXT PRIMARY KEY,
  ano_mes TEXT NOT NULL,
  escopo TEXT NOT NULL CHECK (escopo IN ('gerente', 'consultor')),
  consultor_id TEXT,
  ol_sem_combate REAL NOT NULL DEFAULT 0,
  ol_prioritarios REAL NOT NULL DEFAULT 0,
  ol_lancamentos REAL NOT NULL DEFAULT 0,
  clientes_positivados REAL NOT NULL DEFAULT 0,
  demanda_sem_combate REAL NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ano_mes, escopo, consultor_id),
  FOREIGN KEY (consultor_id) REFERENCES consultores(id)
);

CREATE TABLE IF NOT EXISTS foco_semanal (
  id TEXT PRIMARY KEY,
  semana_inicio TEXT NOT NULL,
  semana_fim TEXT NOT NULL,
  produto_id TEXT,
  ean TEXT,
  descricao TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE TABLE IF NOT EXISTS mercado_farma_precos (
  id TEXT PRIMARY KEY,
  uf TEXT NOT NULL,
  cnpj_referencia TEXT,
  produto_id TEXT,
  ean TEXT NOT NULL,
  produto TEXT,
  distribuidora TEXT NOT NULL,
  estoque REAL NOT NULL DEFAULT 0,
  desconto REAL NOT NULL DEFAULT 0,
  pf_distribuidora REAL NOT NULL DEFAULT 0,
  pf_fabrica REAL NOT NULL DEFAULT 0,
  preco_com_imposto REAL NOT NULL DEFAULT 0,
  preco_sem_imposto REAL NOT NULL DEFAULT 0,
  status TEXT,
  erro TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (uf, ean, distribuidora),
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE TABLE IF NOT EXISTS extracoes (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('BUSSOLA', 'MERCADO_FARMA', 'IMPORTACAO')),
  status TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando', 'executando', 'concluido', 'erro', 'cancelado')),
  solicitado_por TEXT,
  github_run_id TEXT,
  total_registros INTEGER NOT NULL DEFAULT 0,
  mensagem TEXT,
  erro TEXT,
  iniciado_em TEXT,
  finalizado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS extracao_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extracao_id TEXT NOT NULL,
  nivel TEXT NOT NULL DEFAULT 'info',
  mensagem TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (extracao_id) REFERENCES extracoes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS importacoes (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  nome_arquivo TEXT,
  tamanho_bytes INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  total_registros INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'concluido',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor_json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clientes_consultor ON clientes(consultor_id);
CREATE INDEX IF NOT EXISTS idx_clientes_uf ON clientes(uf);
CREATE INDEX IF NOT EXISTS idx_pedidos_data ON pedidos(data_pedido);
CREATE INDEX IF NOT EXISTS idx_pedidos_consultor ON pedidos(consultor_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_itens_pedido ON itens_pedido(pedido_id);
CREATE INDEX IF NOT EXISTS idx_itens_ean ON itens_pedido(ean);
CREATE INDEX IF NOT EXISTS idx_metas_periodo ON metas(ano_mes);
CREATE INDEX IF NOT EXISTS idx_mercado_uf_ean ON mercado_farma_precos(uf, ean);
CREATE INDEX IF NOT EXISTS idx_extracoes_tipo_status ON extracoes(tipo, status);
