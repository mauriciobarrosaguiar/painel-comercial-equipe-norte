import { DatabaseSync } from 'node:sqlite'

function d1Statement(database, sql, parameters = []) {
  return {
    bind(...values) {
      return d1Statement(database, sql, values)
    },
    async all() {
      return { results: database.prepare(sql).all(...parameters) }
    },
    async run() {
      const result = database.prepare(sql).run(...parameters)
      return { success: true, meta: { changes: Number(result.changes || 0) } }
    },
  }
}

export function testDatabase() {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    CREATE TABLE consultores (id TEXT PRIMARY KEY, nome TEXT, uf TEXT, ativo INTEGER, origem TEXT);
    CREATE TABLE clientes (id TEXT PRIMARY KEY, cnpj TEXT, consultor_id TEXT, uf TEXT, ativo INTEGER, carteira_importada INTEGER);
    CREATE TABLE produtos (id TEXT PRIMARY KEY, ean TEXT, tipo_mix TEXT, mercado_farma_ativo INTEGER);
    CREATE TABLE pedidos (id TEXT PRIMARY KEY, pedido_origem TEXT, nota_fiscal TEXT, cliente_id TEXT, consultor_id TEXT, data_pedido TEXT, data_faturamento TEXT, status TEXT, valor_faturado REAL, origem TEXT, ativo INTEGER);
    CREATE TABLE itens_pedido (id TEXT PRIMARY KEY, pedido_id TEXT, produto_id TEXT, ean TEXT, descricao TEXT, quantidade_faturada REAL, valor_faturado REAL, ativo INTEGER);
    CREATE TABLE metas (consultor_id TEXT, escopo TEXT, ano_mes TEXT, ol_sem_combate REAL, ol_prioritarios REAL, ol_lancamentos REAL, clientes_positivados INTEGER);
    CREATE TABLE extracoes (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE auditorias_calculos (id TEXT PRIMARY KEY, periodo_inicio TEXT, periodo_fim TEXT, status TEXT, total_alertas INTEGER, resultado_json TEXT, criado_em TEXT);

    INSERT INTO consultores VALUES ('co1','Ana','PA',1,'PAINEL_EQUIPE');
    INSERT INTO clientes VALUES ('cl1','11111111000111','co1','PA',1,1), ('cl2','22222222000122','co1','PA',1,1);
    INSERT INTO produtos VALUES
      ('linha','111','LINHA',0),
      ('prioritario','222','PRIORITARIO',0),
      ('combate','333','COMBATE',0),
      ('desconhecido','444','SEM CLASSIFICACAO',0);
    INSERT INTO pedidos VALUES
      ('p1','P1','NF1','cl1','co1','2026-07-10','2026-07-10','FATURADO',200,'BUSSOLA',1),
      ('p2','P2','NF2','cl1','co1','2026-07-10','2026-07-10','NAO FATURADO',700,'BUSSOLA',1),
      ('p3','P3','NF3','cl1','co1','2026-07-10','2026-07-10','FATURADO',800,'BUSSOLA',0);
    INSERT INTO itens_pedido VALUES
      ('i1','p1','linha','111','Linha',1,100,1),
      ('i2','p1','prioritario','222','Prioritário',1,50,1),
      ('i3','p1','combate','333','Combate',1,40,1),
      ('i4','p1','desconhecido','444','Desconhecido',1,10,1),
      ('i5','p1','linha','111','Linha inativa',1,999,0),
      ('i6','p2','linha','111','Linha',1,700,1),
      ('i7','p3','linha','111','Linha',1,800,1);
  `)

  return {
    prepare(sql) {
      return d1Statement(database, sql)
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.all()))
    },
  }
}
