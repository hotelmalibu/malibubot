// ============================================================
//  confirmar.js — Al confirmarse un pago: marca la reserva como pagada,
//  envia los correos (cliente + recepcion) y avisa al cliente por WhatsApp.
//  Es idempotente: si la reserva ya estaba pagada, no repite nada.
// ============================================================
import { reservasStore } from '../almacen/reservas.js';
import { enviarTexto } from '../whatsapp/enviar.js';
import { confirmarReservaPorCorreo } from '../correo/enviar.js';

export async function confirmarPago(reserva) {
  if (!reserva || reserva.estado === 'pagado') return false;
  reservasStore.actualizarEstado(reserva.id, 'pagado');
  console.log(`[pago] Reserva ${reserva.id} confirmada como PAGADA.`);

  confirmarReservaPorCorreo(reserva).catch(() => {});
  if (reserva.waId) {
    enviarTexto(
      reserva.waId,
      `¡Tu pago fue confirmado! ✅ Tu reserva en el Hotel Malibú (${reserva.habitacion}) quedó lista. ` +
        `Te enviamos la confirmación${reserva.email ? ' a ' + reserva.email : ''}. ¡Te esperamos! 🌴`
    ).catch(() => {});
  }
  return true;
}
