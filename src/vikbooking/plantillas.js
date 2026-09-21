// ============================================================
//  plantillas.js — Texto del aviso "Reserva confirmada" (Vik Booking).
//
//  Es una PLANTILLA de Meta (categoria UTILITY): el aviso sale solo, casi
//  siempre fuera de la ventana de 24 h, y WhatsApp solo lo permite con
//  plantillas aprobadas. Este archivo lo usan confirmada.js (enviar y guardar
//  el texto en el historial) y scripts/crear-plantillas-vik.js (pedirle a Meta
//  que la apruebe).
//
//  Si cambias el texto, hay que crear la plantilla de nuevo en Meta (con otro
//  nombre) y poner ese nombre en VIK_PLANTILLA de Render.
// ============================================================

export const PLANTILLA_CONFIRMADA = {
  nombre: 'malibu_reserva_confirmada',
  cuerpo:
    'Hola {{1}}, tu reserva N.° {{2}} en el Hotel Malibú quedó confirmada y tu pago fue recibido. ' +
    'Ingreso: {{3}}. Salida: {{4}}. Puedes ver los detalles aquí: {{5}} ' +
    'Te esperamos en la Calle 32A No. 32-04, Sincelejo.',
  ejemplos: ['Carlos', '1234', 'viernes 2 de octubre', 'sábado 3 de octubre', 'https://www.hotelmalibu.co/reserva/1234'],
};

/** Rellena {{1}}, {{2}}... con los parametros (para el historial del chat). */
export function renderizar(parametros = []) {
  return PLANTILLA_CONFIRMADA.cuerpo.replace(/\{\{(\d+)\}\}/g, (_m, n) => String(parametros[Number(n) - 1] ?? ''));
}
