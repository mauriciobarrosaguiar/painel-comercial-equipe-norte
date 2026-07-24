-- Guarda o objetivo de preço líquido de cada cliente vinculado a uma SIP.
ALTER TABLE sip_clientes ADD COLUMN objetivo_preco_liquido REAL NOT NULL DEFAULT 0;

-- As SIPs existentes começam com a meta mensal dividida igualmente entre os clientes ativos.
UPDATE sip_clientes
   SET objetivo_preco_liquido = COALESCE((
         SELECT s.meta_mes
           FROM sips s
          WHERE s.id = sip_clientes.sip_id
       ), 0) / COALESCE(NULLIF((
         SELECT COUNT(*)
           FROM sip_clientes sc2
          WHERE sc2.sip_id = sip_clientes.sip_id
            AND sc2.ativo = 1
       ), 0), 1)
 WHERE ativo = 1
   AND objetivo_preco_liquido = 0;

CREATE INDEX IF NOT EXISTS idx_sip_clientes_objetivo
  ON sip_clientes(sip_id, ativo, objetivo_preco_liquido);
