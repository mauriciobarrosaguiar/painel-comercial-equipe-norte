// A classificacao e sanitaria e por EAN/apresentacao; nunca derivar do MIX comercial
// nem inferir apenas pelo principio ativo ou nome do medicamento.
export const CATEGORIAS_FARMACEUTICAS = Object.freeze([
  'OTC', 'PRESCRICAO', 'CONTROLADO', 'ANTIMICROBIANO', 'NAO_CLASSIFICADO',
])

export function categoriaFarmaceutica(value) {
  const normal = String(value ?? '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[\s-]+/g, '_')
  const aliases = {
    MIP: 'OTC', ISENTO: 'OTC', ISENTO_DE_PRESCRICAO: 'OTC',
    RECEITA: 'PRESCRICAO', SOB_PRESCRICAO: 'PRESCRICAO',
    CONTROLADOS: 'CONTROLADO', CONTROLE_ESPECIAL: 'CONTROLADO',
    ANTIBIOTICO: 'ANTIMICROBIANO', ANTIBIOTICOS: 'ANTIMICROBIANO',
    NAO_CLASSIFICADO: 'NAO_CLASSIFICADO', PENDENTE: 'NAO_CLASSIFICADO',
  }
  const categoria = aliases[normal] || normal
  return CATEGORIAS_FARMACEUTICAS.includes(categoria) ? categoria : null
}

export const ROTULOS_FARMACEUTICOS = Object.freeze({
  OTC: 'OTC / MIP (sem receita)',
  PRESCRICAO: 'Sob prescrição',
  CONTROLADO: 'Controlado',
  ANTIMICROBIANO: 'Antimicrobiano',
  NAO_CLASSIFICADO: 'A classificar',
})
