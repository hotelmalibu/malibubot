// ============================================================
//  enviar.js — Envia mensajes a WhatsApp usando la Graph API.
//  Node 20+ trae fetch global, no hace falta axios.
// ============================================================
import { config } from '../config.js';

function urlMensajes() {
  return `https://graph.facebook.com/${config.whatsapp.graphVersion}/${config.whatsapp.phoneNumberId}/messages`;
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
