// ============================================================
//  sindestino.js — Mensajes de WhatsApp que llegan SIN forma de contestarlos.
//
//  Normalmente cada mensaje trae el numero del cliente (`from`) o, si el cliente activo un nombre de usuario de
//  WhatsApp, su BSUID (ver bsuid.js). Si no trae ninguno de los dos, no hay a quien escribirle. Antes un mensaje asi
//  se guardaba con el id vacio, Valentina intentaba contestarle al vacio y nadie se enteraba.
//  Ahora no se mete en ningun chat: queda en esta bitacora (con los NOMBRES de los campos que mando Meta, para entender
//  por que) y recepcion recibe un correo (maximo uno cada 15 min, con la cuenta de los que se juntaron).
// ============================================================
import { enviarAlertaInterna } from '../correo/enviar.js';

const MAX = 50;
const AVISO_CADA_MS = 15 * 60 * 1000;
/** @type {Array<{ts:number, tipo:string, nombre:string, texto:string, campos:string[], camposContacto:string[]}>} */
const recientes = [];
let ultimoAviso = 0;
let sinAvisar = 0;

function horaColombia(ts) {
  return new Date(ts).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Anota un mensaje de WhatsApp que no trae ni numero ni BSUID y avisa a recepcion por correo (limitado).
 * Nunca lanza: si el correo falla, solo queda en el log.
 * @param {{tipo?:string, nombre?:string, texto?:string, campos?:string[], camposContacto?:string[]}} m  Mensaje ya parseado (ver parsearMensajes).
 * @returns {Promise<{avisado:boolean}>}
 */
export async function registrarSinDestino(m, ahora = Date.now()) {
  const nota = {
    ts: ahora,
    tipo: String(m.tipo || ''),
    nombre: String(m.nombre || '').slice(0, 60),
    texto: String(m.texto || '').slice(0, 300),
    campos: Array.isArray(m.campos) ? m.campos.slice(0, 40) : [],
    camposContacto: Array.isArray(m.camposContacto) ? m.camposContacto.slice(0, 40) : [],
  };
  recientes.unshift(nota);
  if (recientes.length > MAX) recientes.length = MAX;
  console.warn(`[webhook] Mensaje de WhatsApp SIN número ni identificador de usuario: no se puede contestar. Tipo: ${nota.tipo}. Campos del mensaje: ${nota.campos.join(',') || '-'}. Campos del contacto: ${nota.camposContacto.join(',') || '-'}.`);

  sinAvisar += 1;
  if (ahora - ultimoAviso < AVISO_CADA_MS) return { avisado: false };
  const cuantos = sinAvisar;
  ultimoAviso = ahora;
  sinAvisar = 0;
  try {
    const enviado = await enviarAlertaInterna({
      asunto: 'MALIBUBOT · Un cliente de WhatsApp escribió y no se le pudo contestar',
      titulo: 'Mensaje de WhatsApp sin forma de contestar',
      intro: 'Llegó un mensaje de WhatsApp en el que Meta no mandó ni el número ni el identificador del cliente, así que Valentina no tuvo a quién contestarle.',
      filas: [
        ['Hora', horaColombia(ahora)],
        ['Nombre del perfil', nota.nombre],
        ['Escribió', nota.texto || `(${nota.tipo || 'sin texto'})`],
        ...(cuantos > 1 ? [['Mensajes juntados en este aviso', String(cuantos)]] : []),
      ],
      pasos: [
        'Si el cliente vuelve a escribir, Valentina lo atiende con normalidad.',
        'Avísale a quien administra MALIBUBOT: el sistema guardó qué datos mandó Meta para revisarlo.',
      ],
    });
    return { avisado: !!enviado };
  } catch (err) {
    console.error('[webhook] No se pudo avisar por correo del mensaje sin destino:', err.message);
    return { avisado: false };
  }
}

/** Ultimos mensajes sin destino (el mas nuevo primero). */
export function sinDestinoRecientes() {
  return recientes.map((x) => ({ ...x, campos: [...x.campos], camposContacto: [...x.camposContacto] }));
}

// ---------- Envios a clientes con nombre de usuario que WhatsApp no acepto ----------
// Escribirle a un BSUID (`recipient`) es nuevo y depende de Meta: si algun dia lo rechaza (version de la API, permisos...),
// el cliente se quedaria sin respuesta como antes. Por eso un fallo aqui NUNCA es silencioso: queda anotado y recepcion recibe un correo.
/** @type {Array<{ts:number, chat:string, error:string}>} */
const enviosFallidos = [];
let ultimoAvisoEnvio = 0;
let enviosSinAvisar = 0;

/**
 * Anota que WhatsApp no acepto un mensaje para un cliente con nombre de usuario («bs:...») y avisa a recepcion por correo
 * (maximo uno cada 15 min). Nunca lanza.
 * @param {{from?:string, nombre?:string, texto?:string}} m  El mensaje del cliente que se intentaba contestar.
 * @param {Error} err
 */
export async function registrarFalloEnvioBsuid(m, err, ahora = Date.now()) {
  const id = String(m?.from || '');
  const nota = { ts: ahora, chat: id.replace(/[A-Za-z0-9](?=[A-Za-z0-9]{4})/g, '•'), error: String(err?.message || err || '').slice(0, 300) };
  enviosFallidos.unshift(nota);
  if (enviosFallidos.length > MAX) enviosFallidos.length = MAX;
  console.error(`[webhook] WhatsApp no aceptó la respuesta a un cliente con nombre de usuario (${nota.chat}): ${nota.error}`);

  enviosSinAvisar += 1;
  if (ahora - ultimoAvisoEnvio < AVISO_CADA_MS) return { avisado: false };
  const cuantos = enviosSinAvisar;
  ultimoAvisoEnvio = ahora;
  enviosSinAvisar = 0;
  try {
    const enviado = await enviarAlertaInterna({
      asunto: 'MALIBUBOT · No se pudo contestar a un cliente de WhatsApp con nombre de usuario',
      titulo: 'WhatsApp no aceptó la respuesta',
      intro: 'Un cliente de WhatsApp con nombre de usuario (sin número) escribió y Valentina le contestó, pero WhatsApp no aceptó el envío. El cliente se quedó sin respuesta.',
      filas: [
        ['Hora', horaColombia(ahora)],
        ['Nombre del perfil', String(m?.nombre || '').slice(0, 60)],
        ['Escribió', String(m?.texto || '').slice(0, 300)],
        ['Motivo que dio WhatsApp', nota.error],
        ...(cuantos > 1 ? [['Envíos fallidos juntados en este aviso', String(cuantos)]] : []),
      ],
      pasos: [
        'Avísale a quien administra MALIBUBOT: puede ser la versión de la API de Meta (variable GRAPH_API_VERSION en Render) o un permiso de la app.',
        'Los clientes con número no se ven afectados.',
      ],
    });
    return { avisado: !!enviado };
  } catch (e) {
    console.error('[webhook] No se pudo avisar por correo del envío fallido:', e.message);
    return { avisado: false };
  }
}

/** Ultimos envios fallidos a clientes con nombre de usuario (el mas nuevo primero). */
export function enviosFallidosRecientes() {
  return enviosFallidos.map((x) => ({ ...x }));
}

/** Solo para las pruebas: vacia las bitacoras y los limites de avisos. */
export function _reiniciarSinDestino() {
  recientes.length = 0;
  ultimoAviso = 0;
  sinAvisar = 0;
  enviosFallidos.length = 0;
  ultimoAvisoEnvio = 0;
  enviosSinAvisar = 0;
}
