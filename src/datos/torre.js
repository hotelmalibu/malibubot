// ============================================================
//  torre.js — La NUEVA TORRE del hotel y sus habitaciones Estándar INTELIGENTES.
//
//  Dato del dueño (1-nov-2026): la nueva torre tiene habitaciones Estándar con un sistema inteligente (control
//  automatizado del aire acondicionado y de las luces, y comandos de voz para otros servicios).
//  Valentina le PREGUNTA al cliente si quiere hospedarse ahí; si acepta, la reserva queda con un COMENTARIO que
//  llega en el correo a recepción (recepcion asigna la habitacion: el bot no maneja el inventario por torre).
// ============================================================

/** Comentario que queda en la reserva (y en el correo al hotel) cuando el cliente escoge la nueva torre. */
export const COMENTARIO_NUEVA_TORRE = 'El cliente escogió la NUEVA TORRE con habitación inteligente para hospedarse.';

/** Tipos de habitación a los que se les ofrece la nueva torre (por ahora solo las Estándar). */
export const TIPOS_CON_NUEVA_TORRE = ['estandar', 'estandar_ubique'];

/** ¿Se le ofrece la nueva torre con este tipo de habitación? */
export function admiteNuevaTorre(tipo) {
  return TIPOS_CON_NUEVA_TORRE.includes(tipo?.id);
}

/** ¿Esta reserva pidió la nueva torre? (por su comentario) */
export function pidioNuevaTorre(reserva) {
  return /NUEVA TORRE/.test(String(reserva?.comentarios || ''));
}

/** Frase para el WhatsApp de confirmación al cliente ('' si no pidió la nueva torre). Confirma que quedó anotado; no promete habitación. */
export function lineaNuevaTorre(reserva) {
  return pidioNuevaTorre(reserva)
    ? '\n🏙️ Dejamos anotado en tu reserva que quieres hospedarte en la nueva torre, con habitación inteligente; le llega a recepción.'
    : '';
}

/** Limpia un comentario de reserva: una sola línea de texto, máximo 300 caracteres. */
export function limpiarComentarios(texto) {
  return String(texto ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}
