// ============================================================
//  enviar.js — Envia mensajes a WhatsApp usando la Graph API.
//  Node 20+ trae fetch global, no hace falta axios.
// ============================================================
import { config } from '../config.js';

function urlMensajes() {
  return `${config.whatsapp.graphBase}/${config.whatsapp.graphVersion}/${config.whatsapp.phoneNumberId}/messages`;
}

async function llamarGraph(payload) {
  const resp = await fetch(urlMensajes(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('[enviar] Error de Graph API:', resp.status, JSON.stringify(datos));
    throw new Error(`Graph API respondio ${resp.status}`);
  }
  return datos;
}

/**
 * Envia un mensaje de texto libre.
 * (Solo funciona dentro de la ventana de 24 h que abre el cliente al escribir.)
 * @param {string} destino  Numero del cliente (wa_id).
 * @param {string} texto
 */
export async function enviarTexto(destino, texto) {
  return llamarGraph({
    messaging_product: 'whatsapp',
    to: destino,
    type: 'text',
    text: { body: texto },
  });
}

/**
 * Envia una PLANTILLA aprobada por Meta (funciona aunque la ventana de 24 h
 * este cerrada). Los parametros llenan {{1}}, {{2}}... del cuerpo, en orden.
 * @param {string} destino   Numero del cliente (wa_id).
 * @param {string} nombre    Nombre exacto de la plantilla en Meta.
 * @param {string} idioma    Codigo de idioma de la plantilla (es, es_CO...).
 * @param {string[]} parametros
 */
export async function enviarPlantilla(destino, nombre, idioma = 'es', parametros = []) {
  const components = parametros.length
    ? [{ type: 'body', parameters: parametros.map((p) => ({ type: 'text', text: String(p) })) }]
    : [];
  return llamarGraph({
    messaging_product: 'whatsapp',
    to: destino,
    type: 'template',
    template: { name: nombre, language: { code: idioma }, components },
  });
}

/**
 * Rechaza una llamada entrante de WhatsApp (evento "calls" con event=connect),
 * para que el cliente no quede timbrando: enseguida se le manda el numero al
 * que si puede llamar.
 * @param {string} callId  id de la llamada (wacid...).
 */
export async function rechazarLlamada(callId) {
  const url = `${config.whatsapp.graphBase}/${config.whatsapp.graphVersion}/${config.whatsapp.phoneNumberId}/calls`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', call_id: callId, action: 'reject' }),
  });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Graph API respondio ${resp.status}: ${JSON.stringify(datos)}`);
  return datos;
}

/**
 * Marca un mensaje como leido (los dos ticks azules). Opcional, mejora la UX.
 * @param {string} messageId  id del mensaje entrante (wamid...).
 */
export async function marcarLeido(messageId) {
  return llamarGraph({
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}
