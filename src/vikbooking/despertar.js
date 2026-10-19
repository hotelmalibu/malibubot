// ============================================================
//  despertar.js — «Despierta» a la IA de Vik Booking (contestador de mensajes de Booking).
//
//  El contestador del canal AI de e4jConnect no se activa solo: funciona con las tareas
//  programadas de VikBooking, y en Joomla 3 alguien tiene que llamar cada pocos minutos a
//    index.php?option=com_vikbooking&task=crontab
//  MALIBUBOT ya esta encendido las 24 h, asi que hace esa llamada (GET, responde 200 sin
//  cuerpo). Reusa la conexion de la sincronizacion (User-Agent, plan B del certificado SSL).
//
//  - Se enciende solo si hay VIK_SYNC_URL (o VIK_CRON_URL); VIK_CRON_ACTIVO=false lo apaga.
//  - Nunca se solapan dos llamadas. Solo escribe en el log cuando algo cambia (falla / se recupera).
// ============================================================
import { config } from '../config.js';
import { pedirWeb } from './sincronizar.js';

const estado = {
  ts: 0, // ultima llamada (ms)
  ok: null, // null = aun no se ha llamado
  http: 0,
  ms: 0,
  error: '',
  llamadas: 0,
  fallosSeguidos: 0,
  cadenaPropia: false,
};
let corriendo = false;
const ctx = { cadenaPropia: false };

/** Direccion de la tarea programada de VikBooking ('' = apagado). */
export function urlDespertador() {
  if (!config.vik.cronActivo) return '';
  if (config.vik.cronUrl) return config.vik.cronUrl;
  if (!config.vik.syncUrl) return '';
  try { return `${new URL(config.vik.syncUrl).origin}/index.php?option=com_vikbooking&task=crontab`; } catch { return ''; }
}

export function estadoDespertador() {
  return { ...estado, activo: !!urlDespertador(), cadaMin: config.vik.cronMinutos };
}

/** Una llamada a la tarea programada de VikBooking. Devuelve el estado; no lanza errores. */
export async function despertarVik() {
  const direccion = urlDespertador();
  if (!direccion || corriendo) return estadoDespertador();
  corriendo = true;
  const inicio = Date.now();
  const habiaFallado = estado.ok === false;
  try {
    // El firewall de la web responde 465 «Access Denied» a las peticiones SIN User-Agent.
    const r = await pedirWeb(new URL(direccion), { 'User-Agent': 'MALIBUBOT-cron/1.0', Accept: '*/*' }, ctx, { timeoutMs: config.vik.cronTimeoutMs, variable: 'VIK_CRON_URL' });
    estado.http = r.status;
    if (!r.ok) {
      const bloqueo = r.status === 465 || r.status === 466 ? ' (el firewall de la web bloqueó la llamada)' : '';
      throw new Error(`respuesta ${r.status}${bloqueo}${r.redirige ? `; la web redirige a ${r.redirige}` : ''}`);
    }
    Object.assign(estado, { ok: true, error: '', fallosSeguidos: 0 });
    if (habiaFallado) console.log('[vik-cron] Se recuperó: la tarea programada de Vik responde otra vez.');
  } catch (err) {
    const primera = estado.ok !== false;
    Object.assign(estado, { ok: false, error: err.message, fallosSeguidos: estado.fallosSeguidos + 1 });
    if (primera) console.warn('[vik-cron] No se pudo llamar a la tarea programada de Vik:', err.message);
  } finally {
    corriendo = false;
    estado.ts = Date.now();
    estado.ms = estado.ts - inicio;
    estado.llamadas++;
    estado.cadenaPropia = !!ctx.cadenaPropia;
  }
  return estadoDespertador();
}

/**
 * Programa el despertador (si hay direccion). Devuelve true si quedo programado.
 * @param opciones { primeraVezMs, cadaMs } para las pruebas
 */
export function programarDespertador({ primeraVezMs = 90 * 1000, cadaMs = config.vik.cronMinutos * 60 * 1000 } = {}) {
  const direccion = urlDespertador();
  if (!direccion) return false;
  const llamar = () => { despertarVik(); };
  setTimeout(llamar, primeraVezMs);
  setInterval(llamar, cadaMs);
  console.log(`[vik-cron] Activo: despierta a la IA de Vik cada ${Math.round(cadaMs / 60000)} min en ${new URL(direccion).host}`);
  return true;
}
