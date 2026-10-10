// ============================================================
//  origenes.js — De dónde vienen las reservas (estadística del Dashboard).
//
//  Cinco orígenes, todos leídos de lo que ya llega al panel:
//   - whatsapp : reservas cerradas por MALIBUBOT (bot o recepción desde el chat)
//   - web      : reservas directas en la página del hotel (Vik Booking)
//   - booking  : reservas que entran por Booking.com (vía Vik Channel Manager)
//   - expedia  : reservas que entran por Expedia (vía Vik Channel Manager)
//   - otros    : canal externo sin identificar (Airbnb, etc.) y reservas manuales
// ============================================================
import { reservasStore } from '../almacen/reservas.js';
import { diaColombia } from '../util/fechas.js';

export const ORIGENES = [
  { id: 'whatsapp', nombre: 'MALIBUBOT · WhatsApp', corto: 'WhatsApp' },
  { id: 'web', nombre: 'Web directa · Vik Booking', corto: 'Web directa' },
  { id: 'booking', nombre: 'Booking.com', corto: 'Booking' },
  { id: 'expedia', nombre: 'Expedia', corto: 'Expedia' },
  { id: 'otros', nombre: 'Otros canales y manuales', corto: 'Otros' },
];

/** Origen de una reserva a partir de su fuente. */
export function origenDe(r) {
  switch (r.fuente) {
    case 'vikbooking': return 'web';
    case 'vikbooking-booking': return 'booking';
    case 'vikbooking-expedia': return 'expedia';
    case 'vikbooking-ota':
    case 'manual': return 'otros';
    default: return 'whatsapp'; // bot, humano
  }
}

const confirmada = (r) => r.estado === 'pagado' || r.estado === 'pendiente_hotel';

function noches(r) {
  if (!r.checkIn) return 0;
  const fin = r.checkOut || r.checkIn;
  const n = Math.round((new Date(fin + 'T12:00:00Z') - new Date(r.checkIn + 'T12:00:00Z')) / 864e5);
  return Math.max(1, n) * Math.max(1, parseInt(r.cantidad, 10) || 1); // noches-habitacion
}

const vacio = () => ({ reservas: 0, noches: 0, montoCOP: 0, enProceso: 0, canceladas: 0, ultima: null });

/**
 * Estadística por origen.
 * @param {{desde?:string, hasta?:string, anio?:number}} p  rango por fecha en que se HIZO la reserva (día Colombia)
 */
export function resumenOrigenes({ desde, hasta, anio = new Date().getUTCFullYear() } = {}) {
  const todas = reservasStore.listar();
  const porOrigen = Object.fromEntries(ORIGENES.map((o) => [o.id, vacio()]));
  const meses = Array.from({ length: 12 }, () => Object.fromEntries(ORIGENES.map((o) => [o.id, 0])));
  let sinIdentificar = 0;
  const porAnio = new Map(); // año en que se hizo la reserva -> conteo por origen (todos los tiempos)

  for (const r of todas) {
    const o = origenDe(r);
    const dia = diaColombia(r.creado);
    if (r.fuente === 'vikbooking-ota' && confirmada(r)) sinIdentificar++;

    // Todos los tiempos: reservas confirmadas por año y por origen (no depende del rango).
    if (confirmada(r)) {
      const y = dia.slice(0, 4);
      if (!porAnio.has(y)) porAnio.set(y, Object.fromEntries(ORIGENES.map((x) => [x.id, 0])));
      porAnio.get(y)[o]++;
    }
    // Ultima reserva recibida de ese origen (sea cual sea su estado y el rango): sirve para saber si el canal esta llegando.
    const eu = porOrigen[o];
    if (!eu.ultima || r.creado > eu.ultima) eu.ultima = r.creado;

    // Barras por mes del año elegido (solo confirmadas).
    if (confirmada(r) && dia.startsWith(`${anio}-`)) meses[Number(dia.slice(5, 7)) - 1][o]++;

    // Tarjetas: rango elegido.
    if (desde && dia < desde) continue;
    if (hasta && dia > hasta) continue;
    const e = porOrigen[o];
    if (confirmada(r)) { e.reservas++; e.noches += noches(r); e.montoCOP += Number(r.monto) || 0; }
    else if (r.estado === 'en_proceso') e.enProceso++;
    else if (r.estado === 'cancelado') e.canceladas++;
  }

  const total = Object.values(porOrigen).reduce((s, e) => s + e.reservas, 0);
  const totalMonto = Object.values(porOrigen).reduce((s, e) => s + e.montoCOP, 0);
  const lista = ORIGENES.map((o) => {
    const e = porOrigen[o.id];
    return {
      ...o,
      ...e,
      pctReservas: total ? Math.round((e.reservas / total) * 100) : 0,
      pctIngresos: totalMonto ? Math.round((e.montoCOP / totalMonto) * 100) : 0,
      ticketCOP: e.reservas ? Math.round(e.montoCOP / e.reservas) : null,
    };
  });
  return {
    ok: true,
    rango: { desde: desde || null, hasta: hasta || null },
    anio,
    total,
    totalMonto,
    origenes: lista,
    meses: meses.map((m, i) => ({ mes: i + 1, ...m })),
    anios: [...porAnio.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([anio, c]) => ({ anio: Number(anio), ...c, total: Object.values(c).reduce((s, n) => s + n, 0) })),
    totalHistorico: [...porAnio.values()].reduce((s, c) => s + Object.values(c).reduce((x, n) => x + n, 0), 0),
    sinIdentificar, // reservas de canal externo que Vik no dijo cuál es
  };
}
