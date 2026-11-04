// ============================================================
//  recibir.js — Convierte el cuerpo del webhook de Meta en una
//  lista simple de mensajes. Ignora las notificaciones de estado
//  (enviado / entregado / leido), que no traen "messages".
// ============================================================
import { bsuidValido, idDeBsuid } from './bsuid.js';

/**
 * @param {object} body  Cuerpo JSON del webhook de WhatsApp.
 * @returns {Array<{from:string, bsuid:string, usuario:string, id:string, tipo:string, texto:string, nombre:string,
 *   media:null|{id:string, mime:string, nombre:string, caption:string}}>}
 *   `from` es el numero del cliente (wa_id). Si el cliente activo un NOMBRE DE USUARIO de WhatsApp, Meta omite su numero y
 *   solo manda su BSUID: entonces `from` es «bs:<BSUID>» (ver bsuid.js). Si no viene ni lo uno ni lo otro, `from` es ''.
 *   `bsuid` es su identificador interno (si vino) y `usuario` su nombre de usuario (si lo tiene).
 *   `media` viene en fotos (image) y documentos (document): id para descargarlo, tipo, nombre del archivo y el
 *   texto que el cliente escribio junto al archivo.
 */
export function parsearMensajes(body) {
  const resultado = [];

  if (!body || body.object !== 'whatsapp_business_account') return resultado;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const mensajes = value.messages || [];
      if (mensajes.length === 0) continue; // es un status u otro evento
      const contactos = Array.isArray(value.contacts) ? value.contacts.filter(Boolean) : [];

      for (const msg of mensajes) {
        const telefonoMsg = typeof msg.from === 'string' ? msg.from.trim() : typeof msg.from === 'number' ? String(msg.from) : '';
        const bsuidMsg = bsuidValido(msg.from_user_id);
        // El contacto de ESTE mensaje (por BSUID o por numero); si no se puede saber, el primero, como siempre.
        const emparejado = contactos.find((c) => (bsuidMsg && bsuidValido(c.user_id) === bsuidMsg) || (telefonoMsg && c.wa_id === telefonoMsg));
        const contacto = emparejado || contactos[0] || {};
        const bsuid = bsuidMsg || bsuidValido(contacto.user_id);
        // Sin `from` pero con SU contacto (emparejado por BSUID) trayendo el numero: se usa ese numero.
        const telefono = telefonoMsg || (emparejado && typeof emparejado.wa_id === 'string' ? emparejado.wa_id.trim() : '');
        const archivo = msg.type === 'image' ? msg.image : msg.type === 'document' ? msg.document : null;
        const from = telefono || idDeBsuid(bsuid); // numero del cliente (wa_id) o, sin numero, «bs:<BSUID>»
        resultado.push({
          from,
          bsuid,
          usuario: String(contacto.profile?.username || '').trim().slice(0, 60),
          id: msg.id,              // id del mensaje (wamid...)
          tipo: msg.type,          // text, image, audio, etc.
          texto: msg.text?.body || '',
          nombre: contacto.profile?.name || '', // nombre del perfil (si viene)
          media: archivo?.id
            ? { id: archivo.id, mime: String(archivo.mime_type || '').toLowerCase(), nombre: archivo.filename || '', caption: archivo.caption || '' }
            : null,
          // Sin numero ni BSUID no hay a quien contestar: se dejan los NOMBRES de los campos que mando Meta (sin valores) para entender por que.
          ...(from ? {} : { campos: Object.keys(msg), camposContacto: Object.keys(contacto) }),
        });
      }
    }
  }

  return resultado;
}

/**
 * Extrae los ESTADOS de entrega de los mensajes enviados (sent / delivered / read /
 * failed). Si Meta no puede entregar un mensaje (p. ej. sin metodo de pago en la
 * cuenta de WhatsApp Business), lo avisa aqui con el motivo.
 * @returns {Array<{id:string, estado:string, destino:string, categoria:string, errores:Array<{codigo:number, titulo:string, detalle:string}>}>}
 */
export function parsearEstados(body) {
  const resultado = [];
  if (!body || body.object !== 'whatsapp_business_account') return resultado;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const s of change.value?.statuses || []) {
        resultado.push({
          id: s.id || '',
          estado: s.status || '',
          destino: s.recipient_id || '',
          categoria: s.pricing?.category || s.conversation?.origin?.type || '',
          errores: (s.errors || []).map((e) => ({
            codigo: e.code,
            titulo: e.title || e.message || '',
            detalle: e.error_data?.details || '',
          })),
        });
      }
    }
  }
  return resultado;
}

/**
 * Extrae los intentos de LLAMADA (campo "calls" del webhook, si Meta tiene
 * activadas las llamadas para el numero). Solo interesa event=connect
 * (alguien esta llamando); terminate y demas se ignoran.
 * @returns {Array<{from:string, callId:string, event:string, nombre:string}>}
 */
export function parsearLlamadas(body) {
  const resultado = [];
  if (!body || body.object !== 'whatsapp_business_account') return resultado;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const llamadas = value.calls || [];
      if (!llamadas.length) continue;
      const nombre = value.contacts?.[0]?.profile?.name || '';
      for (const c of llamadas) {
        if (c.event !== 'connect') continue;
        // Con nombre de usuario de WhatsApp no viene el numero: se le escribe a su BSUID (ver bsuid.js).
        const telefono = typeof c.from === 'string' ? c.from.trim() : '';
        resultado.push({ from: telefono || idDeBsuid(c.from_user_id || value.contacts?.[0]?.user_id), callId: c.id || '', event: c.event, nombre });
      }
    }
  }
  return resultado;
}
