// ============================================================
//  fechas.js — Fechas en hora de Colombia (UTC-5, sin horario de verano).
//
//  El servidor (Render) corre en UTC; para "hoy", "mañana" y las semanas de
//  la meta se trabaja siempre en hora local del hotel.
// ============================================================
const OFFSET_MS = -5 * 60 * 60 * 1000;

/** Día YYYY-MM-DD en Colombia para un timestamp (por defecto ahora). */
export function diaColombia(ts = Date.now()) {
  return new Date(ts + OFFSET_MS).toISOString().slice(0, 10);
}

/** Hora (0-23) en Colombia. */
export function horaColombia(ts = Date.now()) {
  return new Date(ts + OFFSET_MS).getUTCHours();
}

/** Suma n días a un YYYY-MM-DD. */
export function sumarDias(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana a la que pertenece el día dado (YYYY-MM-DD). */
export function inicioSemana(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const desdeLunes = (d.getUTCDay() + 6) % 7; // lunes = 0 ... domingo = 6
  return sumarDias(iso, -desdeLunes);
}

/** "sábado 7 de septiembre" */
export function fechaBonita(iso) {
  try {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('es-CO', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

/** "7 sep" (para tablas compactas) */
export function fechaCorta(iso) {
  try {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
  } catch {
    return iso;
  }
}
