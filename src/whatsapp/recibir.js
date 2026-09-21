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
        resultado.push({ from: c.from || '', callId: c.id || '', event: c.event, nombre });
      }
    }
  }
  return resultado;
}
