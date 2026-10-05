// ============================================================
//  sincronizar.js — Lee las reservas directamente de Vik Booking.
//
//  La pasarela malibubot.php solo avisa cuando Vik la llama, y Vik no siempre
//  lo hace con las reservas de Booking.com / Expedia. Aqui MALIBUBOT consulta
//  cada pocos minutos el archivo malibubot-sync.php (instalado en la web del
//  hotel, ver vikbooking/malibubot-sync.php) y deja en el panel TODA reserva
//  que Vik tenga, incluidas las canceladas.
//
//  - Es idempotente: cada reserva se identifica por "vik:<id>".
//  - Conserva la fecha en que se hizo la reserva en Vik.
//  - No manda WhatsApp. Solo avisa por correo a recepcion de las NUEVAS de las
//    ultimas 36 h (lo anterior es historia, no se inunda la bandeja).
// ============================================================
import { config } from '../config.js';
import { registrarDesdeSync } from './confirmada.js';

const ultimo = {
  activo: false,
  corriendo: false,
  ts: 0,
  duracionMs: 0,
  leidas: 0,
  omitidas: 0,
  nuevas: 0,
  actualizadas: 0,
  canceladas: 0,
  invalidas: 0,
  error: '',
  porCanal: {},
};

export function estadoSync() {
  return { ...ultimo, activo: !!config.vik.syncUrl, urlConfigurada: !!config.vik.syncUrl, claveConfigurada: !!config.vik.syncKey };
}

async function pedirPagina(desdeId) {
  const url = new URL(config.vik.syncUrl);
  url.searchParams.set('desde_id', String(desdeId));
  url.searchParams.set('limite', '200');
  const resp = await fetch(url, {
    headers: { 'X-Malibubot-Key': config.vik.syncKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const texto = await resp.text();
  let d;
  try { d = JSON.parse(texto); } catch { d = null; }
  if (!resp.ok || !d || !d.ok) {
    const motivo = d?.error || `respuesta ${resp.status}${d ? '' : ' (no es JSON: ¿el archivo está en la ruta correcta?)'}`;
    throw new Error(motivo);
  }
  return d;
}

/**
 * Trae las reservas de Vik Booking y las registra en el panel.
 * @returns {Promise<typeof ultimo>}
 */
export async function sincronizarConVik() {
  if (!config.vik.syncUrl) throw new Error('Falta VIK_SYNC_URL (la dirección de malibubot-sync.php).');
  if (!config.vik.syncKey) throw new Error('Falta VIK_SYNC_KEY (la clave de la sincronización).');
  if (ultimo.corriendo) throw new Error('Ya hay una sincronización en curso.');

  ultimo.corriendo = true;
  const inicio = Date.now();
  const cuenta = { leidas: 0, omitidas: 0, nuevas: 0, actualizadas: 0, canceladas: 0, invalidas: 0, porCanal: {} };
  try {
    let desdeId = 0;
    for (let pagina = 0; pagina < 60; pagina++) { // tope de seguridad: 12.000 reservas
      const d = await pedirPagina(desdeId);
      for (const o of d.ordenes || []) {
        cuenta.leidas++;
        if (String(o.checkin || '') && String(o.checkin) < config.vik.syncDesde) { cuenta.omitidas = (cuenta.omitidas || 0) + 1; continue; }
        const r = registrarDesdeSync(o);
        if (!r.ok) { cuenta.invalidas++; continue; }
        if (r.nuevo) cuenta.nuevas++;
        else if (r.estadoPrevio !== r.estado) cuenta.actualizadas++;
        if (r.estado === 'cancelado' && (r.nuevo || r.estadoPrevio !== 'cancelado')) cuenta.canceladas++;
        const canal = String(o.channel || '').trim() || 'web';
        cuenta.porCanal[canal] = (cuenta.porCanal[canal] || 0) + 1;
      }
      if (!d.ordenes || d.ordenes.length < 200 || d.siguiente <= desdeId) break;
      desdeId = d.siguiente;
    }
    Object.assign(ultimo, cuenta, { error: '' });
    if (cuenta.nuevas || cuenta.actualizadas) {
      console.log(`[vik-sync] ${cuenta.leidas} leídas · ${cuenta.nuevas} nuevas · ${cuenta.actualizadas} con cambio de estado`);
    }
  } catch (err) {
    ultimo.error = err.message;
    console.warn('[vik-sync] No se pudo sincronizar:', err.message);
    throw err;
  } finally {
    ultimo.corriendo = false;
    ultimo.ts = Date.now();
    ultimo.duracionMs = ultimo.ts - inicio;
  }
  return estadoSync();
}

/** Programa la sincronizacion automatica (si hay VIK_SYNC_URL). */
export function programarSync() {
  if (!config.vik.syncUrl) return false;
  const correr = () => sincronizarConVik().catch(() => {});
  setTimeout(correr, 60 * 1000);
  setInterval(correr, config.vik.syncMinutos * 60 * 1000);
  console.log(`[vik-sync] Activa: cada ${config.vik.syncMinutos} min desde ${new URL(config.vik.syncUrl).host}`);
  return true;
}
