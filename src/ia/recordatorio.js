// ============================================================
//  recordatorio.js — Recordatorio pre-llegada (anti no-show).
//
//  El día ANTES del check-in, Valentina le escribe al huésped con reserva
//  confirmada (pagada o con pago en el hotel) para confirmar su llegada.
//  UN solo mensaje por reserva, siempre (bandera recordatorioEnviado).
//
//  WhatsApp solo permite texto libre dentro de las 24 h desde el último
//  mensaje del cliente. Como el recordatorio suele salir días después de la
//  reserva, fuera de esa ventana se usa una PLANTILLA aprobada por Meta
//  (RECORDATORIO_PLANTILLA). Sin plantilla, solo se envía si la ventana
//  está abierta.
// ============================================================
import { config } from '../config.js';
import { store } from '../almacen/conversaciones.js';
import { reservasStore } from '../almacen/reservas.js';
import { enviarTexto, enviarPlantilla } from '../whatsapp/enviar.js';
import { diaColombia, horaColombia, sumarDias, fechaBonita } from '../util/fechas.js';

const VENTANA_WA_MS = 24 * 60 * 60 * 1000;
const MIN_DESDE_CREADA_MS = 8 * 60 * 60 * 1000; // no avisar a quien reservó hace un rato (ya recibió la confirmación)

function confirmada(r) {
  return r.estado === 'pagado' || r.estado === 'pendiente_hotel';
}

/** Número de WhatsApp de la reserva (wa_id o el celular en dígitos). */
export function destinoDe(r) {
  const d = (r.waId || '').replace(/\D/g, '') || (r.celular || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 && d.startsWith('3')) return '57' + d; // celular colombiano sin indicativo
  return d.length >= 11 ? d : '';
}

function primerNombre(nombre) {
  const n = (nombre || '').trim().split(/\s+/)[0];
  return n && n.length <= 20 ? n : '';
}

/** Partes variables del mensaje (mismo orden que {{1}}..{{4}} de la plantilla). */
export function parametrosRecordatorio(r) {
  const hoy = diaColombia();
  const cuando = r.checkIn === hoy ? 'hoy' : r.checkIn === sumarDias(hoy, 1) ? 'mañana' : 'el';
  const fecha = `${cuando} ${fechaBonita(r.checkIn)}`;
  const detalle = [r.habitacion ? `habitación ${r.habitacion}` : 'tu habitación', r.personas ? `${r.personas} persona${r.personas === 1 ? '' : 's'}` : '']
    .filter(Boolean).join(' · ');
  const pago = r.estado === 'pendiente_hotel'
    ? 'Recuerda que el pago se realiza al llegar al hotel.'
    : 'Tu pago ya está confirmado.';
  return [primerNombre(r.nombre) || 'huésped', fecha, detalle, pago];
}

/** Texto completo (para la ventana de 24 h y para el historial del chat). */
export function mensajeRecordatorio(r) {
  const [nombre, fecha, detalle, pago] = parametrosRecordatorio(r);
  return (
    `Hola ${nombre} 👋 Soy Valentina, del Hotel Malibú. ` +
    `Te recordamos tu llegada ${fecha}: ${detalle}. ${pago} ` +
    `Si algo cambia en tus planes, respóndeme por aquí y con gusto te ayudo. ¡Te esperamos! 🌴`
  );
}

/** ¿Se le puede enviar el recordatorio (a mano desde el panel)? */
export function puedeRecordar(r) {
  if (!confirmada(r) || r.recordatorioEnviado || !r.checkIn) return false;
  const hoy = diaColombia();
  if (r.checkIn !== hoy && r.checkIn !== sumarDias(hoy, 1)) return false;
  return !!destinoDe(r);
}

/**
 * Envía el recordatorio de una reserva (manual desde el panel o automático).
 * @returns {Promise<{ok:boolean, via?:string, error?:string}>}
 */
export async function enviarRecordatorio(id) {
  const r = reservasStore.obtenerPorId(id);
  if (!r) return { ok: false, error: 'Reserva no encontrada.' };
  if (!confirmada(r)) return { ok: false, error: 'Solo se avisa a reservas confirmadas (pagadas o con pago en el hotel).' };
  if (r.recordatorioEnviado) return { ok: false, error: 'A esta reserva ya se le envió el recordatorio (solo se permite uno).' };
  const destino = destinoDe(r);
  if (!destino) return { ok: false, error: 'La reserva no tiene un celular válido de WhatsApp.' };

  const texto = mensajeRecordatorio(r);
  const ultimo = store.ultimoEntrante(destino);
  const enVentana = !!ultimo && Date.now() - ultimo < VENTANA_WA_MS;
  const { plantilla, idioma } = config.recordatorio;

  let via = '';
  try {
    if (enVentana) {
      await enviarTexto(destino, texto); // gratis dentro de las 24 h
      via = 'texto';
    } else if (plantilla) {
      await enviarPlantilla(destino, plantilla, idioma, parametrosRecordatorio(r));
      via = 'plantilla';
    } else {
      return {
        ok: false,
        error:
          'Pasaron más de 24 h desde su último mensaje y no hay plantilla aprobada configurada ' +
          '(variable RECORDATORIO_PLANTILLA en Render).',
      };
    }
  } catch (err) {
    return { ok: false, error: 'WhatsApp no aceptó el envío: ' + err.message };
  }

  // PRIMERO la bandera (ninguna carrera puede repetir el envío), LUEGO el historial.
  reservasStore.marcarRecordatorio(r.id);
  store.registrarSaliente({ waId: destino, autor: 'bot', texto });
  return { ok: true, via };
}

/** Tarea periódica: recordatorios a las llegadas de mañana (y las de hoy, temprano). */
export async function enviarRecordatorios() {
  if (!config.recordatorio.activo) return;
  const hora = horaColombia();
  if (hora < 9 || hora >= 20) return; // solo en horario razonable
  const hoy = diaColombia();
  const manana = sumarDias(hoy, 1);
  const ahora = Date.now();

  const lista = reservasStore.listar().filter((r) => {
    if (!puedeRecordar(r)) return false;
    if (ahora - r.creado < MIN_DESDE_CREADA_MS) return false;
    return r.checkIn === manana || (r.checkIn === hoy && hora < 13);
  }).slice(0, 30);

  for (const r of lista) {
    const res = await enviarRecordatorio(r.id);
    if (res.ok) console.log(`[recordatorio] Enviado (${res.via}) a reserva ${r.id}`, r.nombre ? `(${r.nombre})` : '');
    else console.warn(`[recordatorio] No enviado a reserva ${r.id}:`, res.error);
  }
}
