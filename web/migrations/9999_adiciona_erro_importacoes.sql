-- Compatibilidade com bancos D1 criados pela estrutura inicial.
-- A migração das bases legadas registra o detalhe de falhas nesta coluna.
ALTER TABLE importacoes ADD COLUMN erro TEXT;
