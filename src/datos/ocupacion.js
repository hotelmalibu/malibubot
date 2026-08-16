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
let cache = { ts: 0, datos: null };

export async function ocupacionDelLibro() {
  const url = config.google.ocupacionUrl;
  if (!url) return null;

  if (cache.datos && Date.now() - cache.ts < TTL_MS) return cache.datos;

  try {
    const sep = url.includes('?') ? '&' : '?';
    const full = url + sep + 'token=' + encodeURIComponent(config.google.ocupacionToken || '');
    const r = await fetch(full, { redirect: 'follow' });
    const d = await r.json().catch(() => null);
    if (d && d.ok) {
      cache = { ts: Date.now(), datos: d };
      return d;
    }
    console.warn('[ocupacion] Respuesta no OK del Sheet:', JSON.stringify(d));
    return null;
  } catch (err) {
    console.warn('[ocupacion] No se pudo leer el Sheet:', err.message);
    return null;
  }
}
