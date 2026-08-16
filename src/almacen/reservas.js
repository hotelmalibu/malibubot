// ============================================================
//  reservas.js — Almacen en memoria de reservas de HABITACIONES.
//
//  Alimenta las estadisticas del panel (reservas realizadas, habitaciones
//  ocupadas y disponibles). Por ahora se puede registrar a mano desde el
//  panel; en la Fase 2 el bot creara reservas automaticamente.
//
//  NOTA: en memoria. Se reinicia al redesplegar. La persistencia duradera
//  (Google Sheet / base de datos) llega en una fase posterior.
// ============================================================
import { config } from '../config.js';

let secuencia = 1;
/** @type {Array<object>} */
const reservas = [];

function hoyISO() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** ¿La reserva ocupa una habitacion en la fecha dada? (check-in <= fecha < check-out) */
function ocupaEn(r, fechaISO) {
  if (r.estado === 'cancelada') return false;
  if (!r.checkIn) return false;
  const fin = r.checkOut || r.checkIn;
  return r.checkIn <= fechaISO && fechaISO < fin;
}

export const reservasStore = {
  /** Crea una reserva. datos: { waId, nombre, habitacion, personas, checkIn, checkOut, estado, fuente } */
  crear(datos = {}) {
    const r = {
      id: secuencia++,
      waId: datos.waId || '',
      nombre: datos.nombre || '',
      habitacion: datos.habitacion || '',
      personas: Number(datos.personas) || null,
      checkIn: datos.checkIn || '',
      checkOut: datos.checkOut || '',
      estado: datos.estado || 'confirmada', // confirmada | pendiente | cancelada
      fuente: datos.fuente || 'manual',     // manual | bot
      creado: Date.now(),
    };
    reservas.push(r);
    return r;
  },

  listar() {
    return [...reservas].sort((a, b) => b.creado - a.creado);
  },

  actualizarEstado(id, estado) {
    const r = reservas.find((x) => x.id === Number(id));
    if (r) r.estado = estado;
    return r || null;
  },

  /**
   * Estadisticas de habitaciones/reservas.
   * @param {string} [desde] YYYY-MM-DD (filtra reservas creadas desde)
   * @param {string} [hasta] YYYY-MM-DD (filtra reservas creadas hasta, inclusive)
   */
  estadisticas(desde, hasta) {
    const total = config.hotel.habitaciones;
    const hoy = hoyISO();

    // Reservas realizadas dentro del rango (por fecha de creacion).
    const enRango = reservas.filter((r) => {
      if (r.estado === 'cancelada') return false;
      const dia = new Date(r.creado).toISOString().slice(0, 10);
      if (desde && dia < desde) return false;
      if (hasta && dia > hasta) return false;
      return true;
    });

    // Ocupacion de HOY (independiente del filtro de fechas).
    const ocupadasHoy = reservas.filter((r) => ocupaEn(r, hoy)).length;
    const ocupadas = Math.min(ocupadasHoy, total);
    const disponibles = Math.max(total - ocupadas, 0);

    return {
      totalHabitaciones: total,
      ocupadas,
      disponibles,
      reservasRealizadas: enRango.length,
      reservasConfirmadas: enRango.filter((r) => r.estado === 'confirmada').length,
      reservasPendientes: enRango.filter((r) => r.estado === 'pendiente').length,
    };
  },
};
