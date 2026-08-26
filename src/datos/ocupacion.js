// ============================================================
//  ocupacion.js — Lee la ocupacion real del "Libro de Reservas" (Google Sheet).
//
//  El libro marca las reservas con COLORES por dia. Un Apps Script publicado
//  dentro de la propia hoja cuenta esos colores y entrega el resultado como
//  JSON en una URL. Aqui solo consultamos esa URL (con cache corto).
//
//  Devuelve, para el dia de hoy:
//    { ok, fecha, totalHabitaciones, reservadas, mantenimiento, salidas,
//      ocupadas, disponibles }
//  o null si no esta configurada la URL o falla la consulta.
// ============================================================
import { config } from '../config.js';

const TTL_MS = 60 * 1000; // cache de 60 s para no golpear el Sheet en cada carga
const cache = new Map(); // clave -> { ts, datos }

/** Consulta cruda al Apps Script para un dia (y opcionalmente un rango). */
async function consultarLibro({ fecha, desde, hasta }) {
  const url = config.google.ocupacionUrl;
  if (!url) return null;

  const clave = `${fecha || 'hoy'}|${desde || ''}|${hasta || ''}`;
  const enCache = cache.get(clave);
  if (enCache && Date.now() - enCache.ts < TTL_MS) return enCache.datos;

  try {
    const sep = url.includes('?') ? '&' : '?';
    let full = url + sep + 'token=' + encodeURIComponent(config.google.ocupacionToken || '');
    if (fecha) full += '&fecha=' + encodeURIComponent(fecha);
    if (desde) full += '&desde=' + encodeURIComponent(desde);
    if (hasta) full += '&hasta=' + encodeURIComponent(hasta);
    const r = await fetch(full, { redirect: 'follow' });
    const d = await r.json().catch(() => null);
    if (d && d.ok) {
      cache.set(clave, { ts: Date.now(), datos: d });
      return d;
    }
    console.warn('[ocupacion] Respuesta no OK del Sheet:', JSON.stringify(d));
    return null;
  } catch (err) {
    console.warn('[ocupacion] No se pudo leer el Sheet:', err.message);
    return null;
  }
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
      // base ya cubre el mes de fechaISO (= mes de desde); suma los demás meses.
      let total = base.nochesReservadasRango || 0;
      for (let i = 1; i < meses.length; i++) {
        const dm = await consultarLibro({ fecha: meses[i], desde: desdeISO, hasta: hastaISO });
        if (dm && typeof dm.nochesReservadasRango === 'number') total += dm.nochesReservadasRango;
      }
      base.nochesReservadasRango = total;
    }
  }
  return base;
}
