// ============================================================
//  cierres.js — FECHAS CERRADAS: noches en las que el hotel NO vende habitaciones por MALIBUBOT.
//  Las administra recepción desde el panel (pestaña «Fechas cerradas»). Valentina dice que en este momento no hay
//  habitaciones disponibles y no reserva esas noches. Booking, Expedia y la web directa se cierran en Vik Booking
//  (el bot no tiene conexión para cerrarlas allá): el panel lo recuerda.
//  Se guardan en `ajustes` (PostgreSQL), así sobreviven a los reinicios.
// ============================================================
import { ajustesStore } from '../almacen/ajustes.js';

const CLAVE = 'fechas_cerradas';
const MAX = 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const esFecha = (s) => ISO.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;

export function listarCierres() {
  try {
    const v = JSON.parse(ajustesStore.obtener(CLAVE, '[]'));
    return Array.isArray(v) ? v.filter((c) => esFecha(c.desde) && esFecha(c.hasta)).sort((a, b) => a.desde.localeCompare(b.desde)) : [];
  } catch { return []; }
}

/** Cierra las noches desde `desde` hasta `hasta` (ambas incluidas). */
export function agregarCierre({ desde, hasta, motivo = '' }) {
  if (!esFecha(desde) || !esFecha(hasta)) return { ok: false, error: 'Indica las fechas (desde y hasta).' };
  if (hasta < desde) return { ok: false, error: 'La fecha «hasta» no puede ser anterior a «desde».' };
  const lista = listarCierres();
  if (lista.length >= MAX) return { ok: false, error: `Máximo ${MAX} cierres: quita los que ya pasaron.` };
  const cierre = { vik: 'pendiente', id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), desde, hasta, motivo: String(motivo || '').replace(/\s+/g, ' ').trim().slice(0, 120), creado: Date.now() };
  ajustesStore.poner(CLAVE, JSON.stringify([...lista, cierre]));
  return { ok: true, cierre };
}

export function quitarCierre(id) {
  const lista = listarCierres();
  const quitado = lista.find((c) => c.id === id);
  if (!quitado) return false;
  ajustesStore.poner(CLAVE, JSON.stringify(lista.filter((c) => c.id !== id)));
  // Si ya estaba cerrada en Vik Booking, hay que REABRIRLA allá: queda en cola hasta que Vik lo confirme.
  if (quitado.vik === 'cerrada') ajustesStore.poner(CLAVE_ABRIR, JSON.stringify([...pendientesAbrir(), { id: quitado.id, desde: quitado.desde, hasta: quitado.hasta }]));
  return true;
}

const CLAVE_ABRIR = 'fechas_abrir_en_vik';
export function pendientesAbrir() {
  try { const v = JSON.parse(ajustesStore.obtener(CLAVE_ABRIR, '[]')); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function resolverApertura(id) {
  ajustesStore.poner(CLAVE_ABRIR, JSON.stringify(pendientesAbrir().filter((c) => c.id !== id)));
}
/** Anota como quedo el cierre en Vik Booking: 'pendiente' | 'cerrada' | 'error'. */
export function marcarVik(id, estado, error = '') {
  const lista = listarCierres();
  const c = lista.find((x) => x.id === id);
  if (!c) return;
  c.vik = estado; c.vikError = String(error || '').slice(0, 200); c.vikIntento = Date.now();
  ajustesStore.poner(CLAVE, JSON.stringify(lista));
}

/** ¿Está cerrada la noche `fecha` (AAAA-MM-DD)? */
export function nocheCerrada(fecha) {
  return listarCierres().some((c) => fecha >= c.desde && fecha <= c.hasta);
}

/** Primera noche cerrada de una estadía (check-in incluido, check-out no), o null. Sin check-out = 1 noche. */
export function primeraNocheCerrada(checkIn, checkOut) {
  if (!esFecha(checkIn)) return null;
  const fin = esFecha(checkOut) && checkOut > checkIn ? checkOut : new Date(Date.parse(checkIn + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  for (let d = checkIn, n = 0; d < fin && n < 400; n++) {
    if (nocheCerrada(d)) return d;
    d = new Date(Date.parse(d + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  }
  return null;
}
