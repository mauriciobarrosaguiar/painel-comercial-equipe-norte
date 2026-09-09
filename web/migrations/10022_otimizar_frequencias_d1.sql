-- Reduz a frequência das automações pesadas para preservar a cota diária do D1.
-- Bússola: aproximadamente 4 a 5 atualizações por dia.
-- Mercado Farma: 2 atualizações por dia.

UPDATE configuracoes_automacao
SET intervalo_minutos = 300,
    proxima_execucao_em = CASE
      WHEN ativo = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now','+300 minutes')
      ELSE NULL
    END,
    atualizado_por = 'Otimização D1',
    atualizado_em = CURRENT_TIMESTAMP
WHERE tipo = 'BUSSOLA';

UPDATE configuracoes_automacao
SET intervalo_minutos = 720,
    proxima_execucao_em = CASE
      WHEN ativo = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now','+720 minutes')
      ELSE NULL
    END,
    atualizado_por = 'Otimização D1',
    atualizado_em = CURRENT_TIMESTAMP
WHERE tipo = 'MERCADO_FARMA';
