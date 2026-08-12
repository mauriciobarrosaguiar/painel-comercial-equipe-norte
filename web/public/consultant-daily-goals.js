(() => {
  const CURRENT_PERIOD = 'mes-atual'
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

  const parseMoney = (value) => {
    const match = String(value || '').match(/R\$\s*([\d.]+(?:,\d{1,2})?)/i)
    if (!match) return 0
    return Number(match[1].replaceAll('.', '').replace(',', '.')) || 0
  }

  const remainingBusinessDays = () => {
    const now = new Date()
    const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    let total = 0

    while (cursor <= end) {
      const weekday = cursor.getDay()
      if (weekday !== 0 && weekday !== 6) total += 1
      cursor.setDate(cursor.getDate() + 1)
    }
    return total
  }

  const currentMonthView = () => {
    const periodSelect = document.querySelector('.consultants-filters select')
    return !periodSelect || periodSelect.value === CURRENT_PERIOD
  }

  const ensureStyles = () => {
    if (document.getElementById('consultant-daily-goal-styles')) return
    const style = document.createElement('style')
    style.id = 'consultant-daily-goal-styles'
    style.textContent = `
      .consultant-daily-goal{display:block!important;margin-top:7px!important;padding-top:6px;border-top:1px dashed #dce7ed;color:#0c6548!important;font-size:.68rem!important;font-weight:750;line-height:1.35!important}
      .consultant-daily-goal b{color:#0c6548;font-weight:850}
      .consultant-daily-goal.is-reached b{color:#0f7a55}
      .consultant-daily-goal.is-missing b{color:#b43b3b}
      .consultant-daily-goal-note{display:block;margin-top:5px;color:#6b7888;font-size:.68rem;line-height:1.35}
    `
    document.head.appendChild(style)
  }

  const removeDailyGoals = () => {
    document.querySelectorAll('.consultant-daily-goal').forEach((node) => node.remove())
    document.querySelectorAll('.consultant-daily-goal-note').forEach((node) => node.remove())
  }

  const updateMetric = (metric, daysLeft) => {
    const valueNode = metric.querySelector(':scope > strong')
    const metaNode = Array.from(metric.querySelectorAll(':scope > small')).find((node) => (
      !node.classList.contains('consultant-daily-goal') && /^Meta\s/i.test((node.textContent || '').trim())
    ))
    if (!valueNode || !metaNode) return

    const currentValue = parseMoney(valueNode.textContent)
    const targetValue = parseMoney(metaNode.textContent)
    let dailyNode = metric.querySelector(':scope > .consultant-daily-goal')

    if (!targetValue) {
      if (dailyNode) dailyNode.remove()
      return
    }

    const remaining = Math.max(0, targetValue - currentValue)
    const reached = remaining <= 0
    const dailyValue = daysLeft > 0 ? remaining / daysLeft : remaining
    const label = reached
      ? 'Meta diária: <b>atingida ✓</b>'
      : daysLeft > 0
        ? `Meta diária: <b>${money.format(dailyValue)}/dia</b> · ${daysLeft} ${daysLeft === 1 ? 'dia útil' : 'dias úteis'}`
        : `Meta diária: <b>faltam ${money.format(remaining)}</b>`
    const signature = `${currentValue}|${targetValue}|${daysLeft}|${reached}`

    if (!dailyNode) {
      dailyNode = document.createElement('small')
      dailyNode.className = 'consultant-daily-goal'
      metric.appendChild(dailyNode)
    }

    if (dailyNode.dataset.signature !== signature) {
      dailyNode.dataset.signature = signature
      dailyNode.classList.toggle('is-reached', reached)
      dailyNode.classList.toggle('is-missing', !reached && daysLeft === 0)
      dailyNode.innerHTML = label
      dailyNode.title = reached
        ? 'A meta deste indicador já foi alcançada.'
        : daysLeft > 0
          ? `Faltam ${money.format(remaining)}. Valor dividido por ${daysLeft} ${daysLeft === 1 ? 'dia útil restante' : 'dias úteis restantes'} no mês.`
          : `O mês não tem mais dias úteis. Ainda faltam ${money.format(remaining)} para a meta.`
    }
  }

  const updateExplanation = (daysLeft) => {
    const heading = document.querySelector('.ranking-heading > div')
    if (!heading) return
    let note = heading.querySelector('.consultant-daily-goal-note')
    if (!note) {
      note = document.createElement('small')
      note.className = 'consultant-daily-goal-note'
      heading.appendChild(note)
    }
    const text = daysLeft > 0
      ? `Meta diária calculada pelo valor que falta ÷ ${daysLeft} ${daysLeft === 1 ? 'dia útil restante' : 'dias úteis restantes'} no mês.`
      : 'Meta diária calculada com base nos dias úteis restantes do mês.'
    if (note.textContent !== text) note.textContent = text
  }

  const sync = () => {
    ensureStyles()
    if (!document.querySelector('.consultants-page')) return
    if (!currentMonthView()) {
      removeDailyGoals()
      return
    }

    const daysLeft = remainingBusinessDays()
    document.querySelectorAll('.consultant-result-card').forEach((card) => {
      const metrics = Array.from(card.querySelectorAll('.consultant-card-toggle > .consultant-metric:not(.consultant-pending-metric)'))
      metrics.slice(0, 3).forEach((metric) => updateMetric(metric, daysLeft))
    })
    updateExplanation(daysLeft)
  }

  let scheduled = false
  const scheduleSync = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      sync()
    })
  }

  const observer = new MutationObserver(scheduleSync)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  document.addEventListener('change', (event) => {
    if (event.target instanceof Element && event.target.closest('.consultants-filters')) scheduleSync()
  })
  window.addEventListener('focus', scheduleSync)
  window.setInterval(scheduleSync, 60_000)
  scheduleSync()
})()
