// ============================================================
//  reservas.js — Almacen en memoria de reservas de HABITACIONES.
//
//  El estado sigue el flujo de pago (RAPYD confirma la reserva):
//    'pagado'      -> pago confirmado; ocupa habitacion.
//    'en_proceso'  -> pago iniciado, aun sin confirmar.
//    'rechazado'   -> pago rechazado/cancelado; no ocupa.
//
//  Datos de una reserva: tipo de habitacion, nombre del huesped, celular,
//  check-in, check-out y estado. En Fase 3 estas reservas las creara el
//  webhook de RAPYD al confirmar el pago; hoy tambien se pueden registrar a
//  mano desde el panel.
//
//  Capa EN VIVO (en memoria). Si hay base de datos (DATABASE_URL), cada
//  cambio se replica alli en segundo plano y al arrancar la memoria se
//  hidrata desde la base (ver hidratarReservas). Sin base de datos, se
//  comporta como antes: se reinicia al redesplegar.
// ============================================================
import { config } from '../config.js';
import { dbActivo, dbGuardarReserva } from './db.js';

// Estados de una reserva:
//   'pagado'          -> pago en línea confirmado (ocupa habitación).
//   'pendiente_hotel' -> reserva CONFIRMADA, el pago se cobra en el hotel (ocupa).
//   'en_proceso'      -> pago en línea iniciado, aún sin confirmar.
//   'rechazado'       -> pago rechazado/cancelado (no ocupa).
export const ESTADOS = ['pagado', 'pendiente_hotel', 'en_proceso', 'rechazado'];

let secuencia = 1;
/** @type {Array<object>} */
const reservas = [];

/** Replica una reserva en la base de datos, sin bloquear. */
function persistirReserva(r) {
  if (!dbActivo() || !r) return;
  dbGuardarReserva(r).catch((e) => console.error('[db] reserva:', e.message));
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Ocupan habitacion las reservas confirmadas: pagadas o con pago pendiente
 *  en el hotel (check-in <= fecha < check-out). */
function ocupaEn(r, fechaISO) {
  if (r.estado !== 'pagado' && r.estado !== 'pendiente_hotel') return false;
  if (!r.checkIn) return false;
  const fin = r.checkOut || r.checkIn;
  return r.checkIn <= fechaISO && fechaISO < fin;
}

export const reservasStore = {
  /**
   * Crea una reserva.
   * datos: { waId, celular, nombre, habitacion, personas, checkIn, checkOut, estado, fuente, referenciaPago }
   */
  crear(datos = {}) {
    const estado = ESTADOS.includes(datos.estado) ? datos.estado : 'en_proceso';
    const r = {
      id: secuencia++,
      waId: datos.waId || '',
      celular: datos.celular || datos.waId || '',
      nombre: datos.nombre || '',
      email: datos.email || '',
      habitacion: datos.habitacion || '',
      personas: Number(datos.personas) || null,
      checkIn: datos.checkIn || '',
      checkOut: datos.checkOut || '',
      monto: Number(datos.monto) || null,       // valor a cobrar (COP)
      estado,                                   // pagado | en_proceso | rechazado
      fuente: datos.fuente || 'manual',         // manual | bot | rapyd
      referenciaPago: datos.referenciaPago || '',
      checkoutId: datos.checkoutId || '',
      creado: Date.now(),
    };
    reservas.push(r);
    persistirReserva(r);
    return r;
  },

  /** Guarda en la base los cambios hechos directamente sobre una reserva. */
  guardar(reserva) {
    persistirReserva(reserva);
    return reserva;
  },

  listar() {
    return [...reservas].sort((a, b) => b.creado - a.creado);
  },

  obtenerPorId(id) {
    return reservas.find((x) => x.id === Number(id)) || null;
  },

  actualizarEstado(id, estado) {
    if (!ESTADOS.includes(estado)) return null;
    const r = reservas.find((x) => x.id === Number(id));
    if (r) {
      r.estado = estado;
      persistirReserva(r);
    }
    return r || null;
  },

  /**
   * Estadisticas de habitaciones/reservas.
   * @param {string} [desde] YYYY-MM-DD (filtra por fecha de creacion)
   * @param {string} [hasta] YYYY-MM-DD
   */
  estadisticas(desde, hasta) {
    const total = config.hotel.habitaciones;
    const hoy = hoyISO();

    const enRango = reservas.filter((r) => {
      const dia = new Date(r.creado).toISOString().slice(0, 10);
      if (desde && dia < desde) return false;
      if (hasta && dia > hasta) return false;
      return true;
    });

    const ocupadasHoy = reservas.filter((r) => ocupaEn(r, hoy)).length;
    const ocupadas = Math.min(ocupadasHoy, total);
    const disponibles = Math.max(total - ocupadas, 0);

    const pagadas = enRango.filter((r) => r.estado === 'pagado').length;
    const pendienteHotel = enRango.filter((r) => r.estado === 'pendiente_hotel').length;
    const enProceso = enRango.filter((r) => r.estado === 'en_proceso').length;
    const rechazadas = enRango.filter((r) => r.estado === 'rechazado').length;

    return {
      totalHabitaciones: total,
      ocupadas,
      disponibles,
      // "reservas realizadas" = confirmadas + en proceso (excluye rechazadas)
      reservasRealizadas: pagadas + pendienteHotel + enProceso,
      reservasPagadas: pagadas,
      reservasPendienteHotel: pendienteHotel,
      reservasEnProceso: enProceso,
      reservasRechazadas: rechazadas,
    };
  },
};

/**
 * Reconstruye las reservas en memoria desde la base de datos (al arrancar)
 * y restaura el contador de IDs para que no colisionen los nuevos.
 * @param {object[]} reservaRows
 */
export function hidratarReservas(reservaRows = []) {
  let maxId = 0;
  for (const r of reservaRows) {
    reservas.push({
      id: Number(r.id),
      waId: r.wa_id || '',
      celular: r.celular || '',
      nombre: r.nombre || '',
      email: r.email || '',
      habitacion: r.habitacion || '',
      personas: r.personas != null ? Number(r.personas) : null,
      checkIn: r.check_in || '',
      checkOut: r.check_out || '',
      monto: r.monto != null ? Number(r.monto) : null,
      estado: ESTADOS.includes(r.estado) ? r.estado : 'en_proceso',
      fuente: r.fuente || 'manual',
      referenciaPago: r.referencia_pago || '',
      checkoutId: r.checkout_id || '',
      creado: Number(r.creado) || Date.now(),
    });
    if (Number(r.id) > maxId) maxId = Number(r.id);
  }
  secuencia = maxId + 1;
  return reservas.length;
}
