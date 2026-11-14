// ============================================================
//  cerrar.js — Cierra/abre en VIK BOOKING (y por su Channel Manager, en Booking y Expedia) las mismas fechas que recepción
//  cierra en el panel de MALIBUBOT («Fechas cerradas»). Llama al archivo malibubot-cierre.php instalado en la web, con la
//  clave compartida (X-Malibubot-Key). Si falla, queda pendiente y se reintenta cada 5 min: nada se pierde ni se repite.
//  Apagado si no hay VIK_CIERRE_URL: entonces el panel solo cierra para Valentina.
//  Usa la misma conexión que la lectura de Vik (pedirWeb): si el certificado SSL de la web llega incompleto, el bot lo compensa.
// ============================================================
import { config } from '../config.js';
import { listarCierres, pendientesAbrir, resolverApertura, marcarVik } from '../datos/cierres.js';
import { pedirWeb } from './sincronizar.js';

export const cierreVikActivo = () => !!(config.vik.cierreUrl && config.vik.cierreKey);

const ctxRed = { cadenaPropia: false };

/**
 * Llama al archivo de la web. `datos.accion`: 'cerrar' | 'abrir' | 'inspeccionar' | 'explorar'.
 * Devuelve el JSON de la web; lanza un Error con el motivo si no se pudo (o si la web dijo ok:false).
 */
export async function llamarCierre(datos) {
  if (!cierreVikActivo()) throw new Error('Falta VIK_CIERRE_URL (y su clave) en Render: el cierre en Vik está apagado.');
  const url = new URL(config.vik.cierreUrl);
  const headers = { 'Content-Type': 'application/json', 'X-Malibubot-Key': config.vik.cierreKey, Accept: 'application/json', 'User-Agent': 'MALIBUBOT-cierre/1.0' };
  const resp = await pedirWeb(url, headers, ctxRed, { variable: 'VIK_CIERRE_URL', metodo: 'POST', cuerpo: JSON.stringify(datos), timeoutMs: 30000 });
  let d; try { d = JSON.parse(resp.texto); } catch { d = null; }
  if (!resp.ok || !d || d.ok !== true) {
    throw new Error(d?.error || `La web respondió ${resp.status}${d ? '' : ' (no es JSON: ¿el archivo malibubot-cierre.php está en la raíz de la web?)'}${resp.redirige ? `; redirige a ${resp.redirige}` : ''}`);
  }
  return d;
}

async function llamar(accion, c) {
  return llamarCierre({ accion, id: c.id, desde: c.desde, hasta: c.hasta });
}

let corriendo = false;
/** Manda a Vik lo pendiente: cierres nuevos y reaperturas. Devuelve cuántos procesó. */
export async function sincronizarCierresVik() {
  if (!cierreVikActivo() || corriendo) return { procesados: 0 };
  corriendo = true;
  let n = 0;
  try {
    for (const c of pendientesAbrir()) {
      try {
        const d = await llamar('abrir', c);
        if (d.ensayo) { console.warn('[cierre-vik] El archivo de la web está en ENSAYO: no reabrió nada.'); continue; }
        resolverApertura(c.id); n++;
      } catch (e) { console.warn('[cierre-vik] No se pudo reabrir', c.desde, e.message); }
    }
    for (const c of listarCierres().filter((x) => x.vik !== 'cerrada')) {
      try {
        const d = await llamar('cerrar', c);
        // En ENSAYO la web solo valida: NO se marca como cerrada (seguiría abierta en Booking, Expedia y la web).
        if (d.ensayo) { marcarVik(c.id, 'pendiente', 'El archivo de la web está en modo ensayo: aún no cierra de verdad.'); continue; }
        marcarVik(c.id, 'cerrada'); n++;
      } catch (e) { marcarVik(c.id, 'error', e.message); console.warn('[cierre-vik] No se pudo cerrar', c.desde, e.message); }
    }
  } finally { corriendo = false; }
  return { procesados: n };
}

export function programarCierresVik() {
  if (!cierreVikActivo()) return;
  setInterval(() => sincronizarCierresVik().catch(() => {}), 5 * 60 * 1000).unref();
  sincronizarCierresVik().catch(() => {});
}
