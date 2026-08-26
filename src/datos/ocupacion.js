// ============================================================
//  ocupacion.js — Lee la ocupacion real del "Libro de Reservas" (Google Sheet).
//
//  El Apps Script que cuenta los colores es LENTO. Estrategia:
//   - CACHE en memoria + PostgreSQL (sobrevive reinicios).
//   - "stale-while-revalidate": si hay dato (fresco o viejo) se devuelve al
//     instante y, si esta viejo, se refresca en segundo plano.
//   - VISTAS FIJAS (hoy, cada mes, ultimos 7, ultimos 30, todo el periodo) se
//     precalculan solas cada rato -> el dashboard las lee instantaneas.
//   - Un rango libre que no sea una vista fija se calcula al momento (SWR).
// ============================================================
import { config } from '../config.js';
import { dbActivo, dbGuardarOcupacion, dbCargarOcupacion } from '../almacen/db.js';

const TTL_MS = 5 * 60 * 1000;   // 5 min: el libro cambia lento
const TIMEOUT_MS = 10 * 1000;   // corta la consulta a la hoja si se cuelga
const cache = new Map();         // clave -> { ts, datos }
const refrescando = new Set();   // claves con refresco en curso (evita duplicados)

function claveDe(fecha, desde, hasta) {
  return `${fecha || 'hoy'}|${desde || ''}|${hasta || ''}`;
}

/** Guarda en memoria y (si hay) en la base, para que sobreviva reinicios. */
function guardarEnCache(clave, datos) {
  const ts = Date.now();
  cache.set(clave, { ts, datos });
  if (dbActivo()) dbGuardarOcupacion(clave, datos, ts).catch((e) => console.error('[ocupacion] db:', e.message));
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
    .then((d) => { if (d) guardarEnCache(clave, d); })
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
    if (Date.now() - enCache.ts >= TTL_MS) refrescarEnSegundoPlano(clave, params);
    return enCache.datos; // instantaneo
  }

  const d = await fetchLibro(params);
  if (d) guardarEnCache(clave, d);
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
      const extras = await Promise.all(
        meses.slice(1).map((m) => consultarLibro({ fecha: m, desde: desdeISO, hasta: hastaISO }))
      );
      let total = base.nochesReservadasRango || 0;
      for (const dm of extras) {
        if (dm && typeof dm.nochesReservadasRango === 'number') total += dm.nochesReservadasRango;
      }
      // Copia (NO mutar el objeto cacheado, que es del primer mes crudo).
      return { ...base, nochesReservadasRango: total };
    }
  }
  return base;
}

// ---------- Persistencia y vistas fijas ----------

/** Carga en memoria las vistas de ocupación guardadas en la base (al arrancar). */
export async function hidratarOcupacion() {
  if (!dbActivo()) return 0;
  try {
    const filas = await dbCargarOcupacion();
    for (const f of filas) {
      let datos;
      try { datos = JSON.parse(f.datos); } catch { continue; }
      cache.set(f.clave, { ts: Number(f.actualizado) || 0, datos });
    }
    return filas.length;
  } catch (err) {
    console.error('[ocupacion] Error hidratando cache:', err.message);
    return 0;
  }
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Lista de vistas fijas a precalcular (relativas a HOY, en UTC igual que el
 * dashboard). Cada una tiene los mismos parámetros que envía el panel.
 */
function vistasFijas() {
  const hoy = new Date();
  const hoyISO = iso(hoy);
  const menos = (n) => { const d = new Date(hoy); d.setUTCDate(d.getUTCDate() - n); return iso(d); };

  const vistas = [
    { fecha: null, desde: null, hasta: null },                 // Todo (mes actual)
    { fecha: hoyISO, desde: hoyISO, hasta: hoyISO },            // Hoy
    { fecha: menos(6), desde: menos(6), hasta: hoyISO },        // Últimos 7 días
    { fecha: menos(29), desde: menos(29), hasta: hoyISO },      // Últimos 30 días
  ];

  // Cada mes del año en curso hasta el mes actual (para filtros por mes).
  const anio = hoy.getUTCFullYear();
  for (let m = 0; m <= hoy.getUTCMonth(); m++) {
    const mm = String(m + 1).padStart(2, '0');
    const ult = new Date(Date.UTC(anio, m + 1, 0)).getUTCDate(); // último día del mes
    const desde = `${anio}-${mm}-01`;
    const hasta = `${anio}-${mm}-${String(ult).padStart(2, '0')}`;
    vistas.push({ fecha: desde, desde, hasta });
  }
  return vistas;
}

let refrescandoVistas = false;

/** Precalcula (en segundo plano, secuencial) todas las vistas fijas. */
export async function refrescarVistas() {
  if (!config.google.ocupacionUrl || refrescandoVistas) return;
  refrescandoVistas = true;
  try {
    // ocupacionDelLibro internamente consulta y cachea cada mes crudo, así que
    // basta con recorrer las vistas para dejar la cache lista.
    for (const v of vistasFijas()) {
      await ocupacionDelLibro(v.fecha, v.desde, v.hasta);
    }
  } catch (err) {
    console.error('[ocupacion] Error refrescando vistas:', err.message);
  } finally {
    refrescandoVistas = false;
  }
}
