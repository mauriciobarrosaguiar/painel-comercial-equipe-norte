function pascoa(ano) {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(ano, mes - 1, dia))
}

function adicionarDias(data, dias) {
  const nova = new Date(data)
  nova.setUTCDate(nova.getUTCDate() + dias)
  return nova
}

function chaveData(data) {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}-${String(data.getUTCDate()).padStart(2, '0')}`
}

function feriadosComerciais(ano) {
  const fixos = ['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25']
  const datas = new Set(fixos.map((item) => `${ano}-${item}`))
  const domingoPascoa = pascoa(ano)
  ;[-48, -47, -2, 60].forEach((dias) => datas.add(chaveData(adicionarDias(domingoPascoa, dias))))
  return datas
}

export function diasUteis(inicio, fim, limite = fim) {
  if (!inicio || !fim) return 0
  const dataInicio = new Date(`${inicio}T12:00:00Z`)
  const dataFim = new Date(`${fim}T12:00:00Z`)
  const dataLimite = new Date(`${limite}T12:00:00Z`)
  const final = dataLimite < dataFim ? dataLimite : dataFim
  const feriadosPorAno = new Map()
  let total = 0
  for (let atual = new Date(dataInicio); atual <= final; atual.setUTCDate(atual.getUTCDate() + 1)) {
    const diaSemana = atual.getUTCDay()
    if (diaSemana === 0 || diaSemana === 6) continue
    const ano = atual.getUTCFullYear()
    if (!feriadosPorAno.has(ano)) feriadosPorAno.set(ano, feriadosComerciais(ano))
    if (!feriadosPorAno.get(ano).has(chaveData(atual))) total += 1
  }
  return total
}

export function hojeSaoPaulo(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora)
}

export function calendarioDoPeriodo(periodo, agora = new Date()) {
  const hoje = hojeSaoPaulo(agora)
  const inicioMes = `${hoje.slice(0, 7)}-01`
  const fimMes = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0)).toISOString().slice(0, 10)
  const ativa = periodo.inicio === inicioMes && periodo.fim === fimMes
  return { ativa, hoje, dias_uteis_total: diasUteis(periodo.inicio, periodo.fim),
    dias_uteis_restantes: ativa ? diasUteis(hoje, fimMes) : 0,
    inclui_hoje: ativa && diasUteis(hoje, hoje) === 1 }
}

export function metasDiarias(periodo, realizados, metas, agora = new Date()) {
  const calendario = calendarioDoPeriodo(periodo, agora)
  const numero = valor => Number.isFinite(Number(valor)) ? Number(valor) : 0
  const centavos = valor => Math.round(numero(valor) * 100)
  return Object.fromEntries(['ol_sem_combate', 'ol_prioritarios', 'ol_lancamentos'].map(chave => {
    const meta = Math.max(0, centavos(metas[chave]))
    const realizado = centavos(realizados[chave])
    const saldo = Math.max(0, meta - realizado)
    return [chave, { ...calendario, sem_meta: meta === 0, atingida: meta > 0 && saldo === 0,
      falta: saldo / 100,
      valor: calendario.ativa && meta > 0 && calendario.dias_uteis_restantes > 0
        ? Math.ceil(saldo / calendario.dias_uteis_restantes) / 100 : null,
      faltas: Object.fromEntries([80, 90, 100].map(n => [n, Math.max(0, Math.round(meta * n / 100) - realizado) / 100])) }]
  }))
}

