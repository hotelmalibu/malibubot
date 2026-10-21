// ============================================================
//  respaldo.js — Cuando la IA no puede contestar (sin saldo, clave mala, Claude caido...) el cliente recibe
//  un mensaje de espera. Aqui vive ese texto y las reglas para que:
//    - lleve el nombre del cliente (el que aparece en su red social) y NO se repita una y otra vez;
//    - el chat quede marcado «sin respuesta» en el panel hasta que conteste la IA o una persona;
//    - la IA no copie ese mensaje cuando vuelve (se quita del historial que lee Claude).
//  Lo usan index.js (webhook), el almacen de conversaciones y el agente.
// ============================================================
import { primerNombre } from './perfil.js';

const MARCA_RESPALDO = 'en un momento te atendemos'; // frase fija del mensaje de espera (minusculas, sin tildes)
// Avisos automaticos que NO cuentan como respuesta al cliente: el de llamadas y el de seguimiento.
const MARCAS_AUTOMATICAS = ['para llamadas por whatsapp', 'quede pendiente de tu reserva'];

/** No se repite el mensaje de espera a un mismo chat antes de este tiempo. */
export const REPETIR_RESPALDO_MS = 30 * 60 * 1000;
/** Un chat cuyo ultimo mensaje de la casa fue el de espera se marca «sin respuesta» durante este tiempo. */
export const VIGENCIA_SIN_RESPUESTA_MS = 72 * 60 * 60 * 1000;

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** ¿Este texto es el mensaje de espera que manda el bot cuando la IA falla? */
export function esRespaldo(texto) {
  return norm(texto).includes(MARCA_RESPALDO);
}

function esAutomatico(texto) {
  const t = norm(texto);
  return MARCAS_AUTOMATICAS.some((a) => t.includes(a));
}

/** El mensaje de espera, con el primer nombre del cliente si se conoce. Conserva la frase fija (ver MARCA_RESPALDO). */
export function textoRespaldo(nombre) {
  const nom = primerNombre(nombre);
  return (
    `${nom ? `Hola ${nom} 👋 ` : ''}Gracias por escribir al Hotel Malibú. En un momento te atendemos. ` +
    'Para reservas de habitaciones cuéntame tus fechas y número de personas.'
  );
}

/** Ultimo mensaje de la casa (bot o recepcion) que cuenta como respuesta: se saltan los del cliente y los avisos automaticos. */
function ultimaRespuestaDeLaCasa(conv) {
  const lista = conv?.mensajes || [];
  for (let i = lista.length - 1; i >= 0; i--) {
    const m = lista[i];
    if (m.autor === 'cliente' || esAutomatico(m.texto)) continue;
    return m;
  }
  return null;
}

/** ¿A este chat ya se le mando el mensaje de espera hace poco? Entonces no se repite (lo mismo otra vez no sirve de nada). */
export function respaldoReciente(conv, ahora = Date.now()) {
  const m = ultimaRespuestaDeLaCasa(conv);
  return !!m && esRespaldo(m.texto) && ahora - m.ts < REPETIR_RESPALDO_MS;
}

/** ¿El cliente se quedo sin respuesta real? (lo ultimo que recibio de la casa fue el mensaje de espera y es reciente) */
export function sinRespuestaIA(conv, ahora = Date.now()) {
  const m = ultimaRespuestaDeLaCasa(conv);
  return !!m && esRespaldo(m.texto) && ahora - m.ts < VIGENCIA_SIN_RESPUESTA_MS;
}

/**
 * Que hacer cuando la IA no pudo contestar a este chat: el mensaje de espera, o nada si ya se mando hace poco.
 * @returns {{texto:string}|{omitir:true}}
 */
export function decidirRespaldo(conv, nombre, ahora = Date.now()) {
  if (conv && respaldoReciente(conv, ahora)) return { omitir: true };
  return { texto: textoRespaldo(nombre || conv?.nombre) };
}
