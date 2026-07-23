export const PEDIDO_FATURADO = "pe.ativo=1 AND UPPER(TRIM(COALESCE(pe.status,''))) IN ('FATURADO','FATURADO PARCIAL','FATURADO RECUPERADO')"
export const ITEM_ATIVO = 'ip.ativo=1'
export const ITEM_FATURADO = `${PEDIDO_FATURADO} AND ${ITEM_ATIVO}`
export const PEDIDO_NAO_FATURADO = "pe.ativo=1 AND UPPER(TRIM(COALESCE(pe.status,''))) IN ('ATENDIDO','ATENDIDO PARCIAL','ENVIADO')"
export const VALOR_ITEM_NAO_FATURADO = `CASE
  WHEN UPPER(TRIM(COALESCE(pe.status,'')))='ENVIADO'
    THEN COALESCE(ip.valor_total_solicitado_sem_imposto,0)
  ELSE COALESCE(ip.total_atendido_sem_imposto,0)
END`
export const MIX_SEM_COMBATE = "UPPER(TRIM(COALESCE(pr.tipo_mix,''))) IN ('LINHA','PRIORITARIO','LANCAMENTO')"

export function textoAlto(valor) {
  return String(valor ?? '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase()
}

export function classificarMix(valor) {
  const texto = textoAlto(valor)
  if (texto.includes('PRIORIT')) return 'PRIORITARIO'
  if (texto.includes('LANC')) return 'LANCAMENTO'
  if (/\b(?:SEM|NAO)\s+COMBATE\b/.test(texto)) return 'LINHA'
  if (texto.includes('COMBATE')) return 'COMBATE'
  if (texto.includes('LINHA')) return 'LINHA'
  return 'SEM CLASSIFICACAO'
}
