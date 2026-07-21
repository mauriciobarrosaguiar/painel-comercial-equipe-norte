import {DatabaseSync} from 'node:sqlite'
function stmt(db,sql,params=[]){return{bind(...v){return stmt(db,sql,v)},async all(){return{results:db.prepare(sql).all(...params)}},async first(){return db.prepare(sql).get(...params)||null},async run(){const r=db.prepare(sql).run(...params);return{success:true,meta:{changes:Number(r.changes||0)}}}}}
export function testDatabase(){const db=new DatabaseSync(':memory:');db.exec(`
CREATE TABLE consultores(id TEXT PRIMARY KEY,nome TEXT,uf TEXT,ativo INTEGER,origem TEXT,atualizado_em TEXT);
CREATE TABLE clientes(id TEXT PRIMARY KEY,cnpj TEXT,razao_social TEXT,nome_fantasia TEXT,cidade TEXT,uf TEXT,consultor_id TEXT,nome_gd TEXT,grupo_economico TEXT,rede_associacao TEXT,bandeira TEXT,situacao TEXT,ativo INTEGER,carteira_importada INTEGER);
CREATE TABLE produtos(id TEXT PRIMARY KEY,ean TEXT,descricao TEXT,tipo_mix TEXT,mercado_farma_ativo INTEGER,ativo INTEGER);
CREATE TABLE pedidos(id TEXT PRIMARY KEY,pedido_origem TEXT,nota_fiscal TEXT,cliente_id TEXT,consultor_id TEXT,data_pedido TEXT,data_faturamento TEXT,status TEXT,valor_faturado REAL,origem TEXT,ativo INTEGER,atualizado_em TEXT);
CREATE TABLE itens_pedido(id TEXT PRIMARY KEY,pedido_id TEXT,produto_id TEXT,ean TEXT,descricao TEXT,quantidade_faturada REAL,valor_faturado REAL,ativo INTEGER);
CREATE TABLE metas(id TEXT PRIMARY KEY,consultor_id TEXT,escopo TEXT,ano_mes TEXT,ol_sem_combate REAL,ol_prioritarios REAL,ol_lancamentos REAL,clientes_positivados INTEGER,importacao_id TEXT,atualizado_em TEXT,UNIQUE(ano_mes,escopo,consultor_id));
CREATE TABLE metas_historico(id INTEGER PRIMARY KEY AUTOINCREMENT,meta_id TEXT,ano_mes TEXT,escopo TEXT,consultor_id TEXT,ol_sem_combate REAL,ol_prioritarios REAL,ol_lancamentos REAL,clientes_positivados INTEGER,importacao_anterior_id TEXT,nova_importacao_id TEXT,substituida_em TEXT);
CREATE TABLE importacoes(id TEXT PRIMARY KEY,tipo TEXT,nome_arquivo TEXT,total_registros INTEGER,status TEXT,criado_em TEXT);
CREATE TABLE extracoes(id TEXT PRIMARY KEY,tipo TEXT,status TEXT,total_registros INTEGER,mensagem TEXT,erro TEXT,iniciado_em TEXT,finalizado_em TEXT,criado_em TEXT);
CREATE TABLE auditorias_calculos(id TEXT PRIMARY KEY,periodo_inicio TEXT,periodo_fim TEXT,status TEXT,total_alertas INTEGER,resultado_json TEXT,criado_em TEXT);
CREATE TABLE sips(id TEXT PRIMARY KEY,nome TEXT,meta_mes REAL,pagamento_percentual REAL,acesso_publico_ativo INTEGER,ativo INTEGER);
CREATE TABLE redes(id TEXT PRIMARY KEY,nome TEXT,ativo INTEGER);
CREATE TABLE sip_redes(sip_id TEXT,rede_id TEXT,ativo INTEGER);
CREATE TABLE sip_clientes(sip_id TEXT,cnpj TEXT,cliente_id TEXT,ativo INTEGER);
CREATE TABLE sip_recados(id TEXT PRIMARY KEY,sip_id TEXT,status TEXT,ativo INTEGER);
CREATE TABLE comandos_automacao(id TEXT PRIMARY KEY,tipo TEXT,parametros_json TEXT,status TEXT,solicitado_por TEXT,mensagem TEXT,erro TEXT,solicitado_em TEXT,iniciado_em TEXT,finalizado_em TEXT,atualizado_em TEXT);
CREATE TABLE historico_mensal(id TEXT PRIMARY KEY,ano_mes TEXT,escopo TEXT,referencia_id TEXT,referencia_nome TEXT,versao INTEGER,versao_atual INTEGER,motivo_reprocessamento TEXT,resultado_json TEXT,fechado_em TEXT,criado_em TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(ano_mes,escopo,referencia_id,versao));
CREATE TABLE mercado_farma_precos(id TEXT PRIMARY KEY,uf TEXT,cnpj_referencia TEXT,produto_id TEXT,ean TEXT,produto TEXT,distribuidora TEXT,estoque REAL,desconto REAL,pf_distribuidora REAL,pf_fabrica REAL,preco_com_imposto REAL,preco_sem_imposto REAL,status TEXT,erro TEXT,atualizado_em TEXT);
INSERT INTO consultores VALUES('co1','Ana','PA',1,'PAINEL_EQUIPE','2026-07-01');
INSERT INTO clientes(id,cnpj,nome_fantasia,cidade,uf,consultor_id,nome_gd,ativo,carteira_importada) VALUES('cl1','11111111000111','Farmácia A','Belém','PA','co1','GD Norte',1,1),('cl2','22222222000122','Farmácia B','Belém','PA','co1','GD Norte',1,1);
INSERT INTO produtos VALUES('linha','111','Linha','LINHA',1,1),('prioritario','222','Prioritário','PRIORITARIO',1,1),('combate','333','Combate','COMBATE',0,1),('desconhecido','444','Desconhecido','SEM CLASSIFICACAO',0,1);
INSERT INTO pedidos VALUES('p1','P1','NF1','cl1','co1','2026-07-10','2026-07-10','FATURADO',200,'BUSSOLA',1,'2026-07-10'),('p2','P2','NF2','cl1','co1','2026-07-10','2026-07-10','NAO FATURADO',700,'BUSSOLA',1,'2026-07-10'),('p3','P3','NF3','cl1','co1','2026-07-10','2026-07-10','FATURADO',800,'BUSSOLA',0,'2026-07-10');
INSERT INTO itens_pedido VALUES('i1','p1','linha','111','Linha',1,100,1),('i2','p1','prioritario','222','Prioritário',1,50,1),('i3','p1','combate','333','Combate',1,40,1),('i4','p1','desconhecido','444','Desconhecido',1,10,1),('i5','p1','linha','111','Linha inativa',1,999,0),('i6','p2','linha','111','Linha',1,700,1),('i7','p3','linha','111','Linha',1,800,1);
INSERT INTO metas VALUES('mg','', 'gerente','2026-07',1000,300,200,2,'imp','2026-07-01'),('mc','co1','consultor','2026-07',1000,300,200,2,'imp','2026-07-01');
INSERT INTO extracoes VALUES('ex1','BUSSOLA','concluido',7,'OK','','2026-07-10T10:00:00Z','2026-07-10T10:05:00Z','2026-07-10T10:00:00Z');
INSERT INTO sips VALUES('sip1','SIP Teste',1000,80,1,1);INSERT INTO redes VALUES('rede1','Rede Teste',1);INSERT INTO sip_redes VALUES('sip1','rede1',1);INSERT INTO sip_clientes VALUES('sip1','11111111000111','cl1',1),('sip1','22222222000122','cl2',1);
INSERT INTO mercado_farma_precos VALUES('mf1','PA','111','linha','111','Linha','Distribuidora A',10,5,12,15,11,10,'OK','','2026-07-10T12:00:00Z'),('mf2','PA','111','linha','111','Linha','Distribuidora B',0,0,13,15,12,11,'OK','','2026-07-10T12:00:00Z');
`);return{prepare(sql){return stmt(db,sql)},async batch(statements){return Promise.all(statements.map(s=>s.all()))}}}
