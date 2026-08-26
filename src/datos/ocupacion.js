// ============================================================
//  ocupacion.js — Lee la ocupacion real del "Libro de Reservas" (Google Sheet).
//
//  El Apps Script que cuenta los colores es LENTO (lee toda la hoja). Para que
//  el dashboard nunca se quede esperando, se usa "stale-while-revalidate":
//    - Si hay un valor en cache (fresco o viejo) -> se devuelve AL INSTANTE.
//      Si estaba viejo, se refresca en segundo plano (sin bloquear).
//    - Solo se espera (con timeout) cuando NO hay ningun valor en cache.
//  Ademas un "calentador" precarga la ocupacion de hoy al arrancar y cada rato,
//  para que la vista por defecto siempre este lista.
// ============================================================
import { config } from '../config.js';

const TTL_MS = 5 * 60 * 1000;   // 5 min: el libro cambia lento
const TIMEOUT_MS = 10 * 1000;   // corta la consulta a la hoja si se cuelga
const cache = new Map();         // clave -> { ts, datos }
const refrescando = new Set();   // claves con refresco en curso (evita duplicados)

function claveDe(fecha, desde, hasta) {
  return `${fecha || 'hoy'}|${desde || ''}|${hasta || ''}`;
}

/** Consulta real al Apps Script (con timeout). Devuelve los datos o null. */
async function fetchLibro({ fecha, desde, hasta }) {
  const url = config.google.ocupacionUrl;
  if (!url) return null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const sep = url.includes('?') ? '&' : '?';
    let full = url + sep + 'token=' + encodeURIComponent(config.google.ocupacionToken || '');
    if (fecha) full += '&fecha=' + encodeURIComponent(fecha);
    if (desde) full += '&desde=' + encodeURIComponent(desde);
    if (hasta) full += '&hasta=' + encodeURIComponent(hasta);

    const r = await fetch(full, { redirect: 'follow', signal: ctrl.signal });
    const d = await r.json().catch(() => null);
    if (d && d.ok) return d;
    console.warn('[ocupacion] Respuesta no OK del Sheet:', JSON.stringify(d));
    return null;
  } catch (err) {
    console.warn('[ocupacion] No se pudo leer el Sheet:', err.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Dispara un refresco en segundo plano (una sola vez por clave a la vez). */
function refrescarEnSegundoPlano(clave, params) {
  if (refrescando.has(clave)) return;
  refrescando.add(clave);
  fetchLibro(params)
    .then((d) => { if (d) cache.set(clave, { ts: Date.now(), datos: d }); })
    .finally(() => refrescando.delete(clave));
}

/**
 * Consulta con cache "stale-while-revalidate":
 *  - Con dato en cache -> lo devuelve YA (y refresca por detras si esta viejo).
 *  - Sin dato -> espera la consulta (acotada por timeout).
 */
async function consultarLibro(params) {
  if (!config.google.ocupacionUrl) return null;
  const clave = claveDe(params.fecha, params.desde, params.hasta);
  const enCache = cache.get(clave);

  if (enCache) {
    const viejo = Date.now() - enCache.ts >= TTL_MS;
    if (viejo) refrescarEnSegundoPlano(clave, params);
    return enCache.datos; // instantaneo
  }

  const d = await fetchLibro(params);
  if (d) cache.set(clave, { ts: Date.now(), datos: d });
  return d;
}

/** Un día representativo (YYYY-MM-01) por cada mes entre desde y hasta. */
function mesesEntre(desdeISO, hastaISO) {
  const a = new Date(desdeISO + 'T12:00:00');
  const b = new Date(hastaISO + 'T12:00:00');
  const meses = [];
  let y = a.getFullYear(), m = a.getMonth();
  const finY = b.getFullYear(), finM = b.getMonth();
  while (y < finY || (y === finY && m <= finM)) {
    meses.push(`${y}-${String(m + 1).padStart(2, '0')}-01`);
    if (m === 11) { m = 0; y++; } else m++;
    if (meses.length > 24) break; // tope de seguridad
  }
  return meses;
}

/**
 * Lee la ocupación del Libro. La ocupación del día usa fechaISO (o hoy).
 * Si se pasan desdeISO/hastaISO, calcula además nochesReservadasRango sumando
 * los días de ese rango (incluso si abarca varios meses).
 */
export async function ocupacionDelLibro(fechaISO, desdeISO, hastaISO) {
  const base = await consultarLibro({ fecha: fechaISO, desde: desdeISO, hasta: hastaISO });
  if (!base) return null;

  if (desdeISO && hastaISO) {
    const meses = mesesEntre(desdeISO, hastaISO);
    if (meses.length > 1) {
      // base ya cubre el mes de fechaISO (= mes de desde); suma los demás EN PARALELO.
      const extras = await Promise.all(
        meses.slice(1).map((m) => consultarLibro({ fecha: m, desde: desdeISO, hasta: hastaISO }))
      );
      let total = base.nochesReservadasRango || 0;
      for (const dm of extras) {
        if (dm && typeof dm.nochesReservadasRango === 'number') total += dm.nochesReservadasRango;
      }
      base.nochesReservadasRango = total;
    }
  }
  return base;
}

/** Precarga la ocupación de hoy (para que la vista por defecto arranque rápida). */
export function calentarOcupacion() {
  if (!config.google.ocupacionUrl) return;
  const clave = claveDe(null, null, null);
  refrescarEnSegundoPlano(clave, { fecha: null, desde: null, hasta: null });
}
