// ============================================================
//  confirmar.js — Al confirmarse un pago: marca la reserva como pagada,
//  envia los correos (cliente + recepcion) y avisa al cliente por WhatsApp.
//  Es idempotente: si la reserva ya estaba pagada, no repite nada.
// ============================================================
import { reservasStore, textoHabitaciones } from '../almacen/reservas.js';
import { store } from '../almacen/conversaciones.js';
import { enviarTexto } from '../whatsapp/enviar.js';
import { confirmarReservaPorCorreo } from '../correo/enviar.js';
import { config } from '../config.js';

const horarios = () => `${config.hotel.horarioTexto} `;

const pesos = (v) => (v ? '$' + Number(v).toLocaleString('es-CO') : '');

export async function confirmarPago(reserva) {
  if (!reserva || reserva.estado === 'pagado') return false;
  reservasStore.actualizarEstado(reserva.id, 'pagado');
  console.log(`[pago] Reserva ${reserva.id} confirmada como PAGADA.`);

  confirmarReservaPorCorreo(reserva).catch(() => {});
  if (reserva.waId) {
    const msg =
      `¡Tu pago fue confirmado! ✅ Tu reserva en el Hotel Malibú (${textoHabitaciones(reserva)}) quedó lista. ` +
      (reserva.email ? `Te enviamos la confirmación a ${reserva.email}. ` : `Este mensaje es tu confirmación; muéstralo al llegar. `) +
      horarios() +
      `¡Te esperamos! 🌴`;
    enviarTexto(reserva.waId, msg).catch(() => {});
    store.registrarSaliente({ waId: reserva.waId, autor: 'bot', texto: msg });
  }
  return true;
}

/**
 * Recepcion verifico un ABONO por transferencia (pago parcial): la reserva queda CONFIRMADA y el
 * saldo se paga en el hotel (estado pendiente_hotel). Avisa al cliente por WhatsApp y manda los
 * correos de confirmacion. Idempotente: si ya estaba verificado el abono (o ya esta pagada), no repite.
 */
export async function confirmarAbonoTransferencia(reserva) {
  if (!reserva || reserva.estado === 'pagado') return false;
  if (/abono verificado/i.test(reserva.referenciaPago || '')) return false;
  reservasStore.actualizarEstado(reserva.id, 'pendiente_hotel');
  reserva.estado = 'pendiente_hotel';
  reserva.referenciaPago = 'Transferencia bancaria · abono verificado';
  reservasStore.guardar(reserva);
  console.log(`[reserva] ${reserva.id} CONFIRMADA con abono por transferencia (el saldo se paga en el hotel).`);

  confirmarReservaPorCorreo(reserva).catch(() => {});
  if (reserva.waId) {
    const fechas = reserva.checkIn ? ` del ${reserva.checkIn} al ${reserva.checkOut}` : '';
    const msg =
      `¡Recibimos tu abono! ✅ Tu reserva en el Hotel Malibú quedó confirmada: ${textoHabitaciones(reserva)}${fechas}.\n` +
      `El saldo se paga directamente en el hotel al llegar. ` +
      (reserva.email ? `Te enviamos la confirmación a ${reserva.email}. ` : `Este mensaje es tu confirmación; muéstralo al llegar. `) +
      horarios() +
      `¡Te esperamos! 🌴`;
    enviarTexto(reserva.waId, msg).catch(() => {});
    store.registrarSaliente({ waId: reserva.waId, autor: 'bot', texto: msg });
  }
  return true;
}

/**
 * Confirma una reserva con PAGO PENDIENTE (se cobra en el hotel). No hay pago en
 * linea: la reserva ya vale y se envian correos (cliente + recepcion) y el aviso
 * por WhatsApp. Es idempotente.
 */
export async function confirmarReservaEnHotel(reserva) {
  if (!reserva) return false;
  if (reserva.estado !== 'pendiente_hotel') {
    reservasStore.actualizarEstado(reserva.id, 'pendiente_hotel');
    reserva.estado = 'pendiente_hotel';
  }
  console.log(`[reserva] ${reserva.id} CONFIRMADA con pago pendiente (cobro en el hotel).`);

  confirmarReservaPorCorreo(reserva).catch(() => {});
  if (reserva.waId) {
    const fechas = reserva.checkIn ? ` del ${reserva.checkIn} al ${reserva.checkOut}` : '';
    const valor = reserva.monto ? ` de ${pesos(reserva.monto)}` : '';
    const msg =
      `¡Tu reserva quedó confirmada! ✅ ${textoHabitaciones(reserva)}${fechas}.\n` +
      `PAGO PENDIENTE: el valor${valor} se paga directamente en el hotel al llegar. ` +
      (reserva.email ? `Te enviamos la confirmación a ${reserva.email}. ` : `Este mensaje es tu confirmación; muéstralo al llegar. `) +
      horarios() +
      `¡Te esperamos! 🌴`;
    enviarTexto(reserva.waId, msg).catch(() => {});
    store.registrarSaliente({ waId: reserva.waId, autor: 'bot', texto: msg });
  }
  return true;
}
