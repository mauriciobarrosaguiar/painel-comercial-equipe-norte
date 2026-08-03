-- A planilha mensal informa apenas as exceções do MIX:
-- Prioritários, Lançamentos e Combate. Todo produto EMS que não estiver
-- nessas listas pertence à Linha e deve compor o OL Sem Combate.
UPDATE produtos
   SET tipo_mix='LINHA',
       atualizado_em=CURRENT_TIMESTAMP
 WHERE UPPER(TRIM(COALESCE(tipo_mix,''))) IN ('','SEM CLASSIFICACAO');

-- Novos produtos extraídos do Bússola também nascem como Linha até que
-- apareçam explicitamente em Prioritários, Lançamentos ou Combate.
CREATE TRIGGER IF NOT EXISTS trg_produtos_mix_linha_insert
AFTER INSERT ON produtos
WHEN UPPER(TRIM(COALESCE(NEW.tipo_mix,''))) IN ('','SEM CLASSIFICACAO')
BEGIN
  UPDATE produtos SET tipo_mix='LINHA' WHERE id=NEW.id;
END;

-- A substituição mensal do template não pode retirar os produtos comuns
-- do OL Sem Combate. Quando o importador limpar a classificação anterior,
-- o banco converte o produto não listado para Linha.
CREATE TRIGGER IF NOT EXISTS trg_produtos_mix_linha_update
AFTER UPDATE OF tipo_mix ON produtos
WHEN UPPER(TRIM(COALESCE(NEW.tipo_mix,''))) IN ('','SEM CLASSIFICACAO')
BEGIN
  UPDATE produtos SET tipo_mix='LINHA' WHERE id=NEW.id;
END;

-- Solicita uma única correção do histórico do mês anterior quando ainda
-- não houver fechamento. A fila é processada automaticamente pelo painel.
INSERT OR IGNORE INTO comandos_automacao(
  id,tipo,parametros_json,status,solicitado_por,mensagem
)
SELECT
  'corrigir-historico-mix-' || strftime('%Y-%m',date('now','start of month','-1 month')),
  'FECHAMENTO_MENSAL',
  json_object('ano_mes',strftime('%Y-%m',date('now','start of month','-1 month'))),
  'aguardando',
  'MIGRACAO_10021',
  'Fechar o mês anterior após corrigir a classificação dos produtos de Linha.'
WHERE EXISTS(
  SELECT 1 FROM metas
   WHERE ano_mes=strftime('%Y-%m',date('now','start of month','-1 month'))
)
AND NOT EXISTS(
  SELECT 1 FROM historico_mensal
   WHERE ano_mes=strftime('%Y-%m',date('now','start of month','-1 month'))
     AND versao_atual=1
     AND escopo='GERAL'
);
