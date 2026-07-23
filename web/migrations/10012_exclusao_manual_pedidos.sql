-- Permite excluir manualmente pedidos sem que a próxima extração os reative.
ALTER TABLE pedidos ADD COLUMN excluido_manual INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pedidos_excluido_manual
  ON pedidos(excluido_manual, ativo);

CREATE TRIGGER IF NOT EXISTS trg_pedidos_excluidos_permanecem_inativos
AFTER UPDATE OF ativo ON pedidos
WHEN NEW.excluido_manual=1 AND NEW.ativo<>0
BEGIN
  UPDATE pedidos SET ativo=0 WHERE id=NEW.id;
END;
