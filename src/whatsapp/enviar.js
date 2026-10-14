// ============================================================
//  enviar.js — Envia mensajes a WhatsApp usando la Graph API.
//  Node 20+ trae fetch global, no hace falta axios.
// ============================================================
import { config } from '../config.js';
import { esSocial, enviarSocial } from './social.js';

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
    // El motivo de Meta (p. ej. "plantilla no existe en ese idioma") ayuda a diagnosticar.
    const motivo = datos?.error?.message ? `: ${datos.error.message}` : '';
    throw new Error(`Graph API respondio ${resp.status}${motivo}`);
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
  // Messenger / Instagram (ids fb:... / ig:...): otra ruta de la Graph API.
  if (esSocial(destino)) return enviarSocial(destino, texto);
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
  if (esSocial(destino)) throw new Error('Messenger e Instagram no usan plantillas: solo se puede escribir dentro de las 24 h.');
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

function urlGraph(ruta) {
  return `${config.whatsapp.graphBase}/${config.whatsapp.graphVersion}/${ruta}`;
}

/**
 * Sube un archivo a WhatsApp y devuelve su media id (sirve ~30 dias).
 * @param {{datos:Buffer, mime:string, nombre:string}} archivo
 * @returns {Promise<string>}
 */
export async function subirMedia({ datos, mime, nombre }) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([datos], { type: mime }), nombre);
  const resp = await fetch(urlGraph(`${config.whatsapp.phoneNumberId}/media`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const d = await resp.json().catch(() => ({}));
  if (!resp.ok || !d.id) {
    console.error('[enviar] Error subiendo archivo a WhatsApp:', resp.status, JSON.stringify(d));
    throw new Error(`No se pudo subir el archivo a WhatsApp (${resp.status}${d?.error?.message ? ': ' + d.error.message : ''})`);
  }
  return d.id;
}

/**
 * Envia un DOCUMENTO (p. ej. un PDF) por WhatsApp. Solo funciona dentro de la
 * ventana de 24 h que abre el cliente al escribir.
 * @param {string} destino  Numero del cliente (wa_id).
 * @param {{datos:Buffer, mime?:string, nombre:string, leyenda?:string}} doc
 */
export async function enviarDocumento(destino, { datos, mime = 'application/pdf', nombre, leyenda = '' }) {
  if (esSocial(destino)) throw new Error('Messenger e Instagram no admiten el envío de documentos desde aquí.');
  const id = await subirMedia({ datos, mime, nombre });
  return llamarGraph({
    messaging_product: 'whatsapp',
    to: destino,
    type: 'document',
    document: { id, filename: nombre, ...(leyenda ? { caption: leyenda } : {}) },
  });
}

/**
 * Descarga un archivo que mando el cliente (foto o PDF): primero se consulta el
 * media id para obtener su URL temporal y luego se baja (ambas con el token).
 * @param {string} mediaId
 * @param {{maxBytes?:number}} [opc]
 * @returns {Promise<{datos:Buffer, mime:string, bytes:number}>}
 */
export async function descargarMedia(mediaId, { maxBytes = 10 * 1024 * 1024 } = {}) {
  const auth = { Authorization: `Bearer ${config.whatsapp.token}` };
  const metaResp = await fetch(urlGraph(encodeURIComponent(mediaId)), { headers: auth, signal: AbortSignal.timeout(20000) });
  const meta = await metaResp.json().catch(() => ({}));
  if (!metaResp.ok || !meta.url) {
    throw new Error(`No se pudo consultar el archivo del cliente (${metaResp.status}${meta?.error?.message ? ': ' + meta.error.message : ''})`);
  }
  const grande = () => Object.assign(new Error('El archivo es demasiado grande.'), { codigo: 'grande' });
  if (Number(meta.file_size) > maxBytes) throw grande();
  const resp = await fetch(meta.url, { headers: auth, signal: AbortSignal.timeout(60000) });
  if (!resp.ok) throw new Error(`No se pudo descargar el archivo del cliente (${resp.status})`);
  const datos = Buffer.from(await resp.arrayBuffer());
  if (datos.length > maxBytes) throw grande();
  return { datos, mime: String(meta.mime_type || resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), bytes: datos.length };
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
