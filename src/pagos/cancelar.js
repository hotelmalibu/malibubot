// ============================================================
//  cancelar.js — Cancelacion de una reserva (por el cliente via Valentina o
//  por recepcion desde el panel). Marca la reserva como 'cancelado', avisa a
//  recepcion por correo (siempre), al cliente por correo (si lo dio) y por
//  WhatsApp. Es idempotente: una reserva ya cancelada no repite avisos.
// ============================================================
import { reservasStore, ESTADOS_ANULADOS } from '../almacen/reservas.js';
import { store } from '../almacen/conversaciones.js';
import { enviarTexto } from '../whatsapp/enviar.js';
import { cancelarReservaPorCorreo } from '../correo/enviar.js';

/**
 * @param {object} reserva
 * @param {{motivo?:string, por?:'cliente'|'recepcion', avisarCliente?:boolean}} opciones
 */
export async function cancelarReserva(reserva, { motivo = '', por = 'cliente', avisarCliente = true } = {}) {
  if (!reserva) return { ok: false, error: 'Reserva no encontrada.' };
  if (ESTADOS_ANULADOS.includes(reserva.estado)) {
    return { ok: false, error: `La reserva ya estaba ${reserva.estado === 'cancelado' ? 'cancelada' : 'rechazada'}.` };
  }
  const estadoPrevio = reserva.estado;
  const copia = { ...reserva }; // para el correo, con el estado que tenia (pagado / pendiente)
  reservasStore.actualizarEstado(reserva.id, 'cancelado');
  console.log(`[reserva] ${reserva.id} CANCELADA por ${por} (antes: ${estadoPrevio})${motivo ? ' · motivo: ' + motivo : ''}`);

  cancelarReservaPorCorreo(copia, motivo + (por === 'recepcion' ? ' (cancelada desde recepción)' : '')).catch(() => {});

  if (avisarCliente && reserva.waId) {
    const fechas = reserva.checkIn ? ` del ${reserva.checkIn} al ${reserva.checkOut}` : '';
    const msg =
      `Tu reserva ${reserva.habitacion ? '(' + reserva.habitacion + ')' : ''}${fechas} quedó CANCELADA ✅. ` +
      (estadoPrevio === 'pagado' ? 'Recepción revisará lo del pago y te contactará. ' : '') +
      `Si cambias de planes, escríbeme y te la dejo lista de nuevo. 🌴`;
    enviarTexto(reserva.waId, msg).catch(() => {});
    store.registrarSaliente({ waId: reserva.waId, autor: 'bot', texto: msg });
  }
  return { ok: true, estadoPrevio };
}
