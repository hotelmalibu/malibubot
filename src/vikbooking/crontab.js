// ============================================================
//  crontab.js — Hace de «tarea programada» de Vik Booking.
//  Vik necesita que alguien llame cada ~5 min a  /index.php?option=com_vikbooking&task=crontab  para correr sus trabajos de
//  fondo (entre ellos avisar la disponibilidad a Booking/Expedia). El hosting basico del hotel (Network Solutions) NO trae
//  «Cron Jobs» ni Joomla 3.10 trae «Tareas programadas», asi que lo hace el bot. Solo lee esa direccion publica de la web.
//  Se apaga con VIK_CRONTAB_ACTIVO=false; la direccion se cambia con VIK_CRONTAB_URL.
// ============================================================
import { config } from '../config.js';
import { pedirWeb } from './sincronizar.js';

const URL_POR_DEFECTO = 'https://www.hotelmalibu.co/index.php?option=com_vikbooking&task=crontab';
const CADA_MS = 5 * 60 * 1000;

const estado = { activo: false, url: '', ultimo: 0, ok: null, http: null, error: '', llamadas: 0, fallos: 0 };
export const estadoCrontab = () => ({ ...estado });

export async function llamarCrontab() {
  if (!estado.url) return estado;
  estado.ultimo = Date.now();
  estado.llamadas++;
  try {
    const r = await pedirWeb(new URL(estado.url), { 'User-Agent': 'MALIBUBOT-crontab' }, {}, { timeoutMs: 40000, variable: 'VIK_CRONTAB_URL' });
    estado.http = r.status; estado.ok = r.ok; estado.error = r.ok ? '' : `La web respondió ${r.status}`;
  } catch (err) {
    estado.http = null; estado.ok = false; estado.error = String(err.message || err).slice(0, 200);
  }
  if (!estado.ok) { estado.fallos++; console.warn('[vik-cron] No se pudo llamar a la tarea de Vik:', estado.error); }
  return estado;
}

export function programarCrontab() {
  if ((process.env.VIK_CRONTAB_ACTIVO || 'true') === 'false') return;
  estado.activo = true;
  estado.url = (process.env.VIK_CRONTAB_URL || URL_POR_DEFECTO).trim();
  setInterval(() => llamarCrontab().catch(() => {}), CADA_MS).unref();
  setTimeout(() => llamarCrontab().catch(() => {}), 60 * 1000).unref(); // la primera, al minuto de arrancar
  console.log('[vik-cron] Llamando a la tarea de Vik Booking cada 5 min.');
}
