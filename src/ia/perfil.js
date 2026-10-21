// ============================================================
//  perfil.js — El nombre que aparece en el perfil del cliente (WhatsApp, Instagram, Messenger) listo para usar:
//  Valentina lo usa para saludar y como nombre del huesped en la reserva, asi nunca tiene que preguntarlo.
//  Sin dependencias (lo usan el agente, el mensaje de espera y el seguimiento).
// ============================================================

/**
 * Nombre del perfil limpio: solo letras, espacios, apostrofes, guiones y puntos (fuera emojis, numeros, simbolos
 * y saltos de linea), maximo 40 caracteres. Devuelve '' si no queda un nombre legible (p. ej. un perfil que es solo emojis).
 * Es texto que escribe un desconocido y llega al prompt: por eso se limpia tanto.
 */
export function nombrePerfil(nombre) {
  const limpio = String(nombre ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}'’ .-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.'’-]+|[\s.'’-]+$/g, '')
    .slice(0, 40)
    .trim();
  return /\p{L}/u.test(limpio) ? limpio : '';
}

/** Primer nombre para saludar ('' si no hay uno razonable: vacio o de mas de 20 letras). */
export function primerNombre(nombre) {
  const n = nombrePerfil(nombre).split(' ')[0];
  return n && n.length <= 20 ? n : '';
}

/** Numero de WhatsApp legible: «+57 300 1234567» (Colombia) o «+<digitos>». */
export function telefonoLegible(waId) {
  const d = String(waId ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('57')) return `+57 ${d.slice(2, 5)} ${d.slice(5)}`;
  return d ? `+${d}` : '';
}
