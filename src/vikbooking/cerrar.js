// ============================================================
//  cerrar.js — Cierra/abre en VIK BOOKING (y por su Channel Manager, en Booking y Expedia) las mismas fechas que recepción
//  cierra en el panel de MALIBUBOT («Fechas cerradas»). Llama al archivo malibubot-cierre.php instalado en la web, con la
//  clave compartida (X-Malibubot-Key). Si falla, queda pendiente y se reintenta cada 5 min: nada se pierde ni se repite.
//  Apagado si no hay VIK_CIERRE_URL: entonces el panel solo cierra para Valentina.
// ============================================================
import { config } from '../config.js';
import { listarCierres, pendientesAbrir, resolverApertura, marcarVik } from '../datos/cierres.js';

export const cierreVikActivo = () => !!(config.vik.cierreUrl && config.vik.cierreKey);

async function llamar(accion, c) {
  const resp = await fetch(config.vik.cierreUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Malibubot-Key': config.vik.cierreKey },
    body: JSON.stringify({ accion, id: c.id, desde: c.desde, hasta: c.hasta }),
    signal: AbortSignal.timeout(30000),
  });
  const d = await resp.json().catch(() => ({}));
  if (!resp.ok || d.ok !== true) throw new Error(d.error || `La web respondió ${resp.status}`);
  return d;
}

let corriendo = false;
/** Manda a Vik lo pendiente: cierres nuevos y reaperturas. Devuelve cuántos procesó. */
export async function sincronizarCierresVik() {
  if (!cierreVikActivo() || corriendo) return { procesados: 0 };
  corriendo = true;
  let n = 0;
  try {
    for (const c of pendientesAbrir()) {
      try { await llamar('abrir', c); resolverApertura(c.id); n++; } catch (e) { console.warn('[cierre-vik] No se pudo reabrir', c.desde, e.message); }
    }
    for (const c of listarCierres().filter((x) => x.vik !== 'cerrada')) {
      try { await llamar('cerrar', c); marcarVik(c.id, 'cerrada'); n++; } catch (e) { marcarVik(c.id, 'error', e.message); console.warn('[cierre-vik] No se pudo cerrar', c.desde, e.message); }
    }
  } finally { corriendo = false; }
  return { procesados: n };
}

export function programarCierresVik() {
  if (!cierreVikActivo()) return;
  setInterval(() => sincronizarCierresVik().catch(() => {}), 5 * 60 * 1000).unref();
  sincronizarCierresVik().catch(() => {});
}
