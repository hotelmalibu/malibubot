// ============================================================
//  bsuid.js — Clientes de WhatsApp con «nombre de usuario» (BSUID).
//
//  Desde 2026 un cliente de WhatsApp puede activar un nombre de usuario y ocultar su numero: en el aviso del mensaje
//  Meta OMITE `from` (y `contacts[].wa_id`) y manda solo su identificador interno, el BSUID (`from_user_id`, p. ej.
//  «US.13491208655302741918»). Para contestarle se escribe a ese BSUID con el campo `recipient` en lugar de `to`.
//  Su chat se identifica como «bs:<BSUID>» (como «fb:» e «ig:»), pero SIGUE SIENDO WhatsApp: se le contesta por el
//  mismo numero del hotel. Lo unico distinto: su celular no se conoce y hay que pedirselo para reservar.
// ============================================================
import { esSocial } from './social.js';

const PREFIJO = 'bs:';

/** BSUID con pinta valida (letras, numeros, punto, guion), o ''. Es un dato que llega de fuera: lo raro se ignora. */
export function bsuidValido(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9._-]{3,160}$/.test(s) ? s : '';
}

/** Id de chat para un BSUID («bs:US.1349...»), o '' si no es valido. */
export function idDeBsuid(bsuid) {
  const b = bsuidValido(bsuid);
  return b ? PREFIJO + b : '';
}

/** ¿Es el chat de un cliente de WhatsApp sin numero conocido (id «bs:<BSUID>»)? */
export function esBsuid(id) {
  return typeof id === 'string' && id.startsWith(PREFIJO) && !!bsuidValido(id.slice(PREFIJO.length));
}

/** El BSUID de un id «bs:...» ('' si no lo es). */
export function bsuidDe(id) {
  return esBsuid(id) ? id.slice(PREFIJO.length) : '';
}

/** ¿A este chat le falta el celular? (Messenger, Instagram y WhatsApp con nombre de usuario). */
export function sinCelularConocido(id) {
  return esSocial(id) || esBsuid(id);
}

/** Destinatario para la Graph API de WhatsApp: `recipient` con el BSUID, o `to` con el numero. */
export function destinatario(id) {
  return esBsuid(id) ? { recipient: bsuidDe(id) } : { to: id };
}
