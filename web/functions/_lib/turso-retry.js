export const isTursoTransient = error => error?.tursoTransient === true

// Only use for reads or operations known to be safe to repeat.
export async function retryTurso(operation) {
  const delays = [200, 600]
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation() }
    catch (error) {
      if (!isTursoTransient(error) || attempt >= delays.length) throw error
      await new Promise(resolve => setTimeout(resolve, delays[attempt]))
    }
  }
}
