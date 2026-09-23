// ============================================================
//  confirmada.js — Aviso "Reserva confirmada" por WhatsApp para las reservas
//  hechas en la PAGINA WEB (Vik Booking).
//
//  Vik Booking llama a POST /api/vik/confirmada en el instante en que una
//  reserva pasa a CONFIRMADA (es decir, cuando el pago se recibio), usando su
//  pasarela de SMS "malibubot" (ver vikbooking/malibubot.php). MALIBUBOT le
//  escribe al huesped con una plantilla aprobada por Meta, con su ingreso y
//  salida.
//
//  Reglas de seguridad:
//   - Apagado por defecto (VIK_ACTIVO) y en MODO PRUEBA (VIK_MODO_PRUEBA):
//     en prueba solo anota lo que enviaria.
//   - Exige la cabecera X-Malibubot-Key (VIK_WEBHOOK_KEY).
//   - UN solo aviso por reserva (marca en memoria + PostgreSQL); si Vik llama
//     dos veces, la segunda no envia nada.
//   - Si WhatsApp rechaza el envio, NO se marca: se puede reenviar desde Vik.
// ============================================================
import { timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { enviarPlantilla } from '../whatsapp/enviar.js';
import { store } from '../almacen/conversaciones.js';
import { dbActivo, dbGuardarVikAviso } from '../almacen/db.js';
import { diaColombia, fechaBonita } from '../util/fechas.js';
import { reservasStore } from '../almacen/reservas.js';
import { renderizar } from './plantillas.js';

/** order_id -> { id, confirmada: 0 pendiente | 1 omitido | timestamp de envio } */
const estados = new Map();
const enCurso = new Set();
const simulados = new Set();
const eventos = [];
const estadosWA = []; // ultimos estados de entrega de WhatsApp (fallos y plantillas)

function anotar(e) {
  eventos.unshift({ ts: Date.now(), ...e });
  if (eventos.length > 60) eventos.length = 60;
}

export function hidratarVikAvisos(filas = []) {
  for (const f of filas) estados.set(Number(f.order_id), { id: Number(f.order_id), confirmada: Number(f.confirmada) || 0 });
  return filas.length;
}

function persistir(est) {
  if (dbActivo()) dbGuardarVikAviso({ id: est.id, confirmada: est.confirmada }).catch((e) => console.error('[vik] db:', e.message));
}

/** ¿La cabecera X-Malibubot-Key coincide con VIK_WEBHOOK_KEY? (comparacion segura) */
export function claveValida(req) {
  const esperada = Buffer.from(config.vik.key || '');
  const recibida = Buffer.from(String(req.get('x-malibubot-key') || ''));
  return esperada.length > 0 && esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

function primerNombre(nombre) {
  const n = String(nombre || '').trim().split(/\s+/)[0];
  if (!n || n.length > 20) return 'huésped';
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

/** Celular de WhatsApp en digitos con indicativo, o '' si no sirve. */
export function destinoDe(telefono) {
  let d = String(telefono || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('3')) return '57' + d; // celular colombiano sin indicativo
  if (d.length === 12 && d.startsWith('57')) return d;
  return d.length >= 11 && d.length <= 15 ? d : '';
}

function isoDe(texto, ts) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(texto || ''))) return texto;
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? diaColombia(n * 1000) : '';
}

const limpiar = (t) => String(t ?? '').replace(/[\n\r\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();

/** Fuentes de las reservas que vienen de Vik Booking (pagina web y canales externos). */
const FUENTE_WEB = 'vikbooking';
const FUENTE_OTA = 'vikbooking-ota';

/**
 * Deja la reserva de Vik Booking en el PANEL de MALIBUBOT (idempotente: la
 * referencia "vik:<id>" evita duplicados; si ya existe, la actualiza).
 */
function registrarReservaPanel(d, { id, status, destino, ingreso, salida }) {
  const ref = `vik:${id}`;
  const habitaciones = [...new Set((d.rooms || []).map((r) => limpiar(r.name)).filter(Boolean))];
  const personas = (d.rooms || []).reduce((s, r) => s + (Number(r.adults) || 0) + (Number(r.children) || 0), 0);
  const estado = status === 'cancelled' ? 'cancelado' : status === 'standby' ? 'en_proceso' : 'pagado';
  const campos = {
    waId: destino,
    celular: destino || String(d.phone || '').replace(/\D/g, ''),
    nombre: limpiar(d.name),
    email: limpiar(d.email),
    habitacion: habitaciones.join(' + '),
    personas: personas || null,
    checkIn: ingreso,
    checkOut: salida,
    monto: Number(d.total) > 0 ? Number(d.total) : null,
    estado,
    fuente: d.ota ? FUENTE_OTA : FUENTE_WEB,
    referenciaPago: ref,
  };
  const existente = reservasStore.buscarPorReferencia(ref);
  if (!existente) {
    const r = reservasStore.crear(campos);
    console.log(`[vik] Reserva ${id} registrada en el panel (${estado}).`);
    return r;
  }
  reservasStore.actualizar(existente.id, campos);
  return existente;
}

/**
 * Procesa la llamada de Vik Booking (reserva confirmada, y opcionalmente en
 * espera o cancelada). Siempre deja la reserva en el panel; el WhatsApp de
 * "Reserva confirmada" solo sale cuando esta confirmada.
 * datos: { id, sid, ts, phone, name, email, total, rooms:[{name,adults,children}],
 *          checkin, checkout, checkin_ts, checkout_ts, ota, status }
 * @returns {Promise<{ok:boolean, estado:string, http?:number, error?:string}>}
 */
export async function procesarConfirmacion(datos = {}) {
  const id = parseInt(datos.id, 10);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, estado: 'invalido', http: 400, error: 'Falta el número de reserva.' };

  const ingreso = isoDe(datos.checkin, datos.checkin_ts);
  const salida = isoDe(datos.checkout, datos.checkout_ts);
  if (!ingreso || !salida) return { ok: false, estado: 'invalido', http: 400, error: 'Faltan las fechas de ingreso y salida.' };

  const status = String(datos.status || 'confirmed').toLowerCase();
  const destino = destinoDe(datos.phone);

  // 1) Panel: la reserva queda registrada (aunque el WhatsApp no aplique).
  registrarReservaPanel(datos, { id, status, destino, ingreso, salida });
  if (status === 'cancelled') return { ok: true, estado: 'cancelada' };
  if (status !== 'confirmed') return { ok: true, estado: 'registrada' };

  // 2) WhatsApp "Reserva confirmada".
  if (datos.ota && !config.vik.incluirOTA) {
    anotar({ reserva: id, resultado: 'omitido', detalle: 'reserva de un canal externo (OTA)' });
    return { ok: true, estado: 'omitido' };
  }

  let est = estados.get(id);
  if (!est) {
    est = { id, confirmada: 0 };
    estados.set(id, est);
  }
  if (est.confirmada) return { ok: true, estado: 'duplicado' }; // ya se avisó (o se omitió)

  if (!destino) {
    est.confirmada = 1;
    persistir(est);
    anotar({ reserva: id, resultado: 'omitido', detalle: 'sin celular válido' });
    return { ok: true, estado: 'omitido', error: 'La reserva no tiene un celular válido.' };
  }

  const sid = String(datos.sid || '').trim();
  const link = sid && datos.ts
    ? `https://www.hotelmalibu.co/index.php?option=com_vikbooking&view=booking&sid=${encodeURIComponent(sid)}&ts=${encodeURIComponent(datos.ts)}`
    : 'https://www.hotelmalibu.co';
  const params = [primerNombre(datos.name), id, fechaBonita(ingreso), fechaBonita(salida), link].map(limpiar);

  if (config.vik.prueba) {
    if (!simulados.has(id)) {
      simulados.add(id);
      console.log(`[vik][prueba] Enviaría "${config.vik.plantilla}" a ${destino}:`, JSON.stringify(params));
      anotar({ reserva: id, resultado: 'prueba', detalle: `a ${destino}`, texto: renderizar(params) });
    }
    return { ok: true, estado: 'prueba' };
  }

  if (enCurso.has(id)) return { ok: true, estado: 'en_curso' };
  enCurso.add(id);
  try {
    await enviarPlantilla(destino, config.vik.plantilla, config.vik.idioma, params);
  } catch (err) {
    console.warn(`[vik] WhatsApp no aceptó el aviso de la reserva ${id}:`, err.message);
    anotar({ reserva: id, resultado: 'error', detalle: err.message });
    return { ok: false, estado: 'error', http: 502, error: err.message };
  } finally {
    enCurso.delete(id);
  }

  est.confirmada = Date.now();
  persistir(est);
  const texto = renderizar(params);
  store.registrarSaliente({ waId: destino, autor: 'bot', texto });
  console.log(`[vik] Aviso de reserva confirmada enviado (reserva ${id}) a ${destino}`);
  anotar({ reserva: id, resultado: 'enviado', detalle: `a ${destino}`, texto });
  return { ok: true, estado: 'enviado' };
}

/**
 * Envia la plantilla REAL a un celular con datos de ejemplo, para comprobar que
 * Meta la acepta (nombre, idioma y variables) antes de activar el envio real.
 * Solo la usa el panel (/admin/api/vik/probar?telefono=...), con sesion.
 * @returns {Promise<{ok:boolean, destino?:string, plantilla:string, idioma:string, error?:string}>}
 */
export async function probarPlantilla(telefono) {
  const base = { plantilla: config.vik.plantilla, idioma: config.vik.idioma };
  const destino = destinoDe(telefono);
  if (!destino) return { ok: false, ...base, error: 'Escribe un celular válido, por ejemplo ?telefono=3001234567' };
  const params = ['Prueba', '0000', fechaBonita(diaColombia(Date.now() + 86400000)), fechaBonita(diaColombia(Date.now() + 2 * 86400000)), 'https://www.hotelmalibu.co'];
  try {
    await enviarPlantilla(destino, config.vik.plantilla, config.vik.idioma, params);
  } catch (err) {
    anotar({ reserva: 0, resultado: 'error', detalle: 'prueba de plantilla: ' + err.message });
    return { ok: false, destino, ...base, error: err.message };
  }
  anotar({ reserva: 0, resultado: 'enviado', detalle: `prueba de plantilla a ${destino}`, texto: renderizar(params) });
  return { ok: true, destino, ...base };
}

/**
 * Guarda un estado de entrega de WhatsApp. Se conservan los FALLOS y los de
 * plantillas (categoria utility/marketing/authentication); los chats normales
 * (categoria service) no interesan aqui.
 */
export function registrarEstadoWhatsApp(s) {
  const importante = s.estado === 'failed' || (s.categoria && s.categoria !== 'service');
  if (!importante) return;
  if (s.estado === 'failed') console.warn(`[whatsapp] Entrega FALLIDA a ${s.destino}:`, JSON.stringify(s.errores));
  estadosWA.unshift({ ts: Date.now(), ...s });
  if (estadosWA.length > 40) estadosWA.length = 40;
}

/** Estado para el panel (/admin/api/vik/estado). */
export function estadoVik() {
  return {
    activo: config.vik.activo,
    prueba: config.vik.prueba,
    idioma: config.vik.idioma,
    claveConfigurada: !!config.vik.key,
    plantilla: config.vik.plantilla,
    enviados: [...estados.values()].filter((e) => e.confirmada > 1).length,
    eventos,
    estadosWhatsApp: estadosWA,
  };
}
