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

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Día de la semana en español de un YYYY-MM-DD: «lunes». */
export function diaSemana(iso) {
  return DIAS_LARGOS[new Date(iso + 'T12:00:00Z').getUTCDay()];
}

/**
 * «Calendario» para la IA: por cada mes, los días del mes que caen en cada día de la semana, desde `desdeIso` y por `dias` días.
 * Sirve para que Valentina NO calcule de memoria qué día de la semana es una fecha (el 28 de dic. de 2026 dijo «domingo» y es lunes).
 * Ej.: «diciembre 2026: dom 6, 13, 20, 27 · lun 7, 14, 21, 28 · mar 1, 8, 15, 22, 29 · …».
 */
export function calendarioSemanas(desdeIso, dias = 150) {
  const lineas = [];
  let mes = '';
  let porDia = null;
  const cerrar = () => {
    if (porDia) lineas.push(`${mes}: ` + DIAS_CORTOS.map((d, i) => (porDia[i].length ? `${d} ${porDia[i].join(', ')}` : '')).filter(Boolean).join(' · '));
  };
  for (let i = 0; i < dias; i++) {
    const d = new Date(sumarDias(desdeIso, i) + 'T12:00:00Z');
    const clave = `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    if (clave !== mes) { cerrar(); mes = clave; porDia = [[], [], [], [], [], [], []]; }
    porDia[d.getUTCDay()].push(d.getUTCDate());
  }
  cerrar();
  return lineas;
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
