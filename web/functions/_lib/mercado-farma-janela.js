// Janela oficial de acesso ao Mercado Farma: 07:00 até 19:59, Brasília.
export const MENSAGEM_JANELA_MERCADO_FARMA = 'Mercado Farma: extrações permitidas somente entre 07h e 20h (horário de Brasília). Das 20h às 06h59, novas extrações ficam bloqueadas.'

export function horarioPermitidoMercadoFarma(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora)
  const hora = Number(partes.find(parte => parte.type === 'hour')?.value)
  return Number.isInteger(hora) && hora >= 7 && hora < 20
}
