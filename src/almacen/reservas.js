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
//  NOTA: en memoria. Se reinicia al redesplegar. La persistencia duradera
//  llega en una fase posterior (base de datos / Google Sheet).
// ============================================================
import { config } from '../config.js';

export const ESTADOS = ['pagado', 'en_proceso', 'rechazado'];

let secuencia = 1;
/** @type {Array<object>} */
const reservas = [];

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Solo las PAGADAS ocupan habitacion (check-in <= fecha < check-out). */
function ocupaEn(r, fechaISO) {
  if (r.estado !== 'pagado') return false;
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
    return r;
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
    if (r) r.estado = estado;
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
    const enProceso = enRango.filter((r) => r.estado === 'en_proceso').length;
    const rechazadas = enRango.filter((r) => r.estado === 'rechazado').length;

    return {
      totalHabitaciones: total,
      ocupadas,
      disponibles,
      // "reservas realizadas" = pagadas + en proceso (excluye rechazadas)
      reservasRealizadas: pagadas + enProceso,
      reservasPagadas: pagadas,
      reservasEnProceso: enProceso,
      reservasRechazadas: rechazadas,
    };
  },
};
