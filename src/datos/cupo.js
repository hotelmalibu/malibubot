// ============================================================
//  cupo.js — Cupo de la promocion de Navidad (Junior Suite Twins).
//
//  Hay POCAS Twins por noche (CUPO_TWINS, 5 por defecto: las de «Junior Suite Navidad» en Vik Booking) y en la temporada de
//  diciembre Valentina la ofrece a todas las parejas y familias; sin este tope se podria vender de mas. Se cuentan las reservas
//  CONFIRMADAS (pagadas o con pago en el hotel) del bot («Junior Suite Twins») y las que llegan de Vik («... Navidad»).
//  Una reserva cuenta cada noche desde su check-in hasta la vispera de su check-out.
// ============================================================
import { config } from '../config.js';
import { reservasStore } from '../almacen/reservas.js';
import { sumarDias } from '../util/fechas.js';

const ES_TWINS = /^\s*junior suite twins\s*$|navidad/i;
const MAX_NOCHES = 45;

/** Cuantas Twins tienen reservadas (confirmadas) esa noche (YYYY-MM-DD). */
export function twinsOcupadasEn(noche) {
  let n = 0;
  for (const r of reservasStore.listar()) {
    if (r.estado !== 'pagado' && r.estado !== 'pendiente_hotel') continue;
    if (!ES_TWINS.test(r.habitacion || '') || !r.checkIn) continue;
    if (r.checkIn <= noche && noche < (r.checkOut || r.checkIn)) n += Number(r.cantidad) || 1;
  }
  return n;
}

/** Cuantas Twins quedan esa noche. */
export function twinsDisponiblesEn(noche) {
  return Math.max(0, config.hotel.cupoTwins - twinsOcupadasEn(noche));
}

/** Primera noche de la estadia en la que NO cabe(n) `cantidad` Twins mas; null si hay cupo todas las noches. */
export function nocheSinCupoTwins(checkIn, checkOut, cantidad = 1) {
  if (!checkIn) return null;
  const fin = checkOut && checkOut > checkIn ? checkOut : sumarDias(checkIn, 1);
  for (let i = 0, noche = checkIn; noche < fin && i < MAX_NOCHES; i++, noche = sumarDias(checkIn, i)) {
    if (twinsOcupadasEn(noche) + cantidad > config.hotel.cupoTwins) return noche;
  }
  return null;
}
