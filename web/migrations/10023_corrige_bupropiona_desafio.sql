-- Correção conferida visualmente no Catálogo A a Z do Mercado Farma em 2026-08-14.
-- SAP 11081: EAN 7896004732626
-- SAP 37606: EAN 7896004796345

UPDATE desafio_gigantes_produtos
SET ean='7896004732626',
    produto='Bupropiona 150 mg Caixa 30 Comprimidos de Liberação Lenta',
    status='IDENTIFICADO',
    mensagem='EAN conferido no Catálogo A a Z do Mercado Farma em 2026-08-14.',
    ultima_consulta_em=CURRENT_TIMESTAMP,
    atualizado_em=CURRENT_TIMESTAMP
WHERE sku='11081';

UPDATE desafio_gigantes_metas
SET ean='7896004732626',
    produto_identificado='Bupropiona 150 mg Caixa 30 Comprimidos de Liberação Lenta',
    status_identificacao='IDENTIFICADO',
    atualizado_em=CURRENT_TIMESTAMP
WHERE sku='11081';

UPDATE desafio_gigantes_produtos
SET ean='7896004796345',
    produto='CLORIDRATO DE BUPROPIONA 150MG x 30 (24H)',
    status='IDENTIFICADO',
    mensagem='EAN conferido no Catálogo A a Z do Mercado Farma em 2026-08-14.',
    ultima_consulta_em=CURRENT_TIMESTAMP,
    atualizado_em=CURRENT_TIMESTAMP
WHERE sku='37606';

UPDATE desafio_gigantes_metas
SET ean='7896004796345',
    produto_identificado='CLORIDRATO DE BUPROPIONA 150MG x 30 (24H)',
    status_identificacao='IDENTIFICADO',
    atualizado_em=CURRENT_TIMESTAMP
WHERE sku='37606';
