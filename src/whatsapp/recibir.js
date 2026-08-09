// ============================================================
//  recibir.js — Convierte el cuerpo del webhook de Meta en una
//  lista simple de mensajes. Ignora las notificaciones de estado
//  (enviado / entregado / leido), que no traen "messages".
// ============================================================

/**
 * @param {object} body  Cuerpo JSON del webhook de WhatsApp.
 * @returns {Array<{from:string, id:string, tipo:string, texto:string, nombre:string}>}
 */
export function parsearMensajes(body) {
  const resultado = [];

  if (!body || body.object !== 'whatsapp_business_account') return resultado;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const mensajes = value.messages || [];
      if (mensajes.length === 0) continue; // es un status u otro evento

      // Nombre del contacto (si viene)
      const nombre = value.contacts?.[0]?.profile?.name || '';

      for (const msg of mensajes) {
        resultado.push({
          from: msg.from,          // numero del cliente (wa_id)
          id: msg.id,              // id del mensaje (wamid...)
          tipo: msg.type,          // text, image, audio, etc.
          texto: msg.text?.body || '',
          nombre,
        });
      }
    }
  }

  return resultado;
}
