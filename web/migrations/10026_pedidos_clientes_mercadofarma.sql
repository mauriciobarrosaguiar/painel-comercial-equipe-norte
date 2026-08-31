-- Pedidos dos clientes no Mercado Farma + novo tipo de automacao
-- Mantem todos os comandos existentes e amplia o CHECK para PEDIDOS_CLIENTES.

PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS comandos_automacao_novo;
CREATE TABLE comandos_automacao_novo (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('BUSSOLA','MERCADO_FARMA','PEDIDOS_CLIENTES','AUDITORIA','FECHAMENTO_MENSAL','MIGRAR_BASES')),
  parametros_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','executando','concluido','erro','cancelado')),
  solicitado_por TEXT,
  mensagem TEXT,
  erro TEXT,
  solicitado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  iniciado_em TEXT,
  finalizado_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO comandos_automacao_novo(
  id,tipo,parametros_json,status,solicitado_por,mensagem,erro,
  solicitado_em,iniciado_em,finalizado_em,atualizado_em
)
SELECT
  id,tipo,parametros_json,status,solicitado_por,mensagem,erro,
  solicitado_em,iniciado_em,finalizado_em,atualizado_em
FROM comandos_automacao;

DROP TABLE comandos_automacao;
ALTER TABLE comandos_automacao_novo RENAME TO comandos_automacao;
CREATE INDEX IF NOT EXISTS idx_comandos_status ON comandos_automacao(status,solicitado_em);
CREATE INDEX IF NOT EXISTS idx_comandos_tipo ON comandos_automacao(tipo,status,solicitado_em DESC);

PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS mercadofarma_pedidos (
  id TEXT PRIMARY KEY,
  cnpj TEXT NOT NULL,
  cliente_nome TEXT NOT NULL DEFAULT '',
  cliente_uf TEXT NOT NULL DEFAULT '',
  consultor_nome TEXT NOT NULL DEFAULT '',
  pedido_numero TEXT NOT NULL,
  pedido_interno TEXT NOT NULL DEFAULT '',
  pedido_distribuidor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  distribuidora TEXT NOT NULL DEFAULT '',
  laboratorio TEXT NOT NULL DEFAULT '',
  data_criacao TEXT NOT NULL,
  hora_criacao TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT '',
  criado_por TEXT NOT NULL DEFAULT '',
  data_solicitacao TEXT NOT NULL DEFAULT '',
  data_emissao TEXT NOT NULL DEFAULT '',
  numero_nfe TEXT NOT NULL DEFAULT '',
  subtotal REAL NOT NULL DEFAULT 0,
  total_pedido REAL NOT NULL DEFAULT 0,
  total_atendido REAL NOT NULL DEFAULT 0,
  total_faturado REAL NOT NULL DEFAULT 0,
  desconto REAL NOT NULL DEFAULT 0,
  qtd_itens INTEGER NOT NULL DEFAULT 0,
  extraido_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cnpj,pedido_numero)
);

CREATE INDEX IF NOT EXISTS idx_mf_pedidos_data ON mercadofarma_pedidos(data_criacao DESC);
CREATE INDEX IF NOT EXISTS idx_mf_pedidos_cliente ON mercadofarma_pedidos(cnpj,data_criacao DESC);
CREATE INDEX IF NOT EXISTS idx_mf_pedidos_uf ON mercadofarma_pedidos(cliente_uf,data_criacao DESC);
CREATE INDEX IF NOT EXISTS idx_mf_pedidos_status ON mercadofarma_pedidos(status,data_criacao DESC);
CREATE INDEX IF NOT EXISTS idx_mf_pedidos_distribuidora ON mercadofarma_pedidos(distribuidora,data_criacao DESC);

CREATE TABLE IF NOT EXISTS mercadofarma_pedido_itens (
  id TEXT PRIMARY KEY,
  pedido_id TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  pedido_numero TEXT NOT NULL,
  posicao INTEGER NOT NULL DEFAULT 0,
  ean TEXT NOT NULL DEFAULT '',
  produto TEXT NOT NULL DEFAULT '',
  solicitado REAL NOT NULL DEFAULT 0,
  atendido REAL NOT NULL DEFAULT 0,
  cancelado REAL NOT NULL DEFAULT 0,
  faturado REAL NOT NULL DEFAULT 0,
  valor_unitario REAL NOT NULL DEFAULT 0,
  desconto REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '',
  extraido_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pedido_id) REFERENCES mercadofarma_pedidos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mf_pedido_itens_pedido ON mercadofarma_pedido_itens(pedido_id,posicao);
CREATE INDEX IF NOT EXISTS idx_mf_pedido_itens_ean ON mercadofarma_pedido_itens(ean);
CREATE INDEX IF NOT EXISTS idx_mf_pedido_itens_status ON mercadofarma_pedido_itens(status);

CREATE TABLE IF NOT EXISTS mercadofarma_pedidos_execucoes (
  id TEXT PRIMARY KEY,
  uf TEXT NOT NULL,
  inicio_periodo TEXT NOT NULL,
  fim_periodo TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('executando','concluido','erro')),
  clientes_total INTEGER NOT NULL DEFAULT 0,
  clientes_processados INTEGER NOT NULL DEFAULT 0,
  clientes_com_erro INTEGER NOT NULL DEFAULT 0,
  pedidos_total INTEGER NOT NULL DEFAULT 0,
  itens_total INTEGER NOT NULL DEFAULT 0,
  mensagem TEXT NOT NULL DEFAULT '',
  erro TEXT NOT NULL DEFAULT '',
  iniciado_em TEXT NOT NULL,
  finalizado_em TEXT
);

CREATE INDEX IF NOT EXISTS idx_mf_pedidos_exec_periodo ON mercadofarma_pedidos_execucoes(inicio_periodo,fim_periodo,iniciado_em DESC);
CREATE INDEX IF NOT EXISTS idx_mf_pedidos_exec_uf ON mercadofarma_pedidos_execucoes(uf,iniciado_em DESC);
