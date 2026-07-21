CREATE TABLE IF NOT EXISTS comandos_automacao (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('BUSSOLA','MERCADO_FARMA','AUDITORIA','FECHAMENTO_MENSAL','MIGRAR_BASES')),
  parametros_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','executando','despachado','concluido','erro','cancelado')),
  solicitado_por TEXT,
  mensagem TEXT,
  erro TEXT,
  solicitado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  iniciado_em TEXT,
  finalizado_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comandos_automacao_status
  ON comandos_automacao(status, solicitado_em);
CREATE INDEX IF NOT EXISTS idx_comandos_automacao_tipo
  ON comandos_automacao(tipo, status, solicitado_em DESC);

CREATE TABLE IF NOT EXISTS historico_mensal (
  id TEXT PRIMARY KEY,
  ano_mes TEXT NOT NULL,
  escopo TEXT NOT NULL CHECK (escopo IN ('GERAL','CONSULTOR','GD','UF','SIP','REDE')),
  referencia_id TEXT NOT NULL DEFAULT '',
  referencia_nome TEXT NOT NULL DEFAULT '',
  versao INTEGER NOT NULL DEFAULT 1,
  versao_atual INTEGER NOT NULL DEFAULT 1,
  motivo_reprocessamento TEXT,
  resultado_json TEXT NOT NULL,
  fechado_em TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ano_mes, escopo, referencia_id, versao)
);

CREATE INDEX IF NOT EXISTS idx_historico_mensal_periodo
  ON historico_mensal(ano_mes, versao_atual, escopo);
CREATE INDEX IF NOT EXISTS idx_historico_mensal_referencia
  ON historico_mensal(escopo, referencia_id, ano_mes);

CREATE TABLE IF NOT EXISTS mercado_farma_precos_historico (
  id TEXT PRIMARY KEY,
  extracao_id TEXT,
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
  extraido_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);

CREATE INDEX IF NOT EXISTS idx_mf_historico_ean_data
  ON mercado_farma_precos_historico(ean, extraido_em DESC);
CREATE INDEX IF NOT EXISTS idx_mf_historico_uf_distribuidora
  ON mercado_farma_precos_historico(uf, distribuidora, extraido_em DESC);
