// ============================================================
//  social.js — Messenger (Facebook) e Instagram Direct.
//
//  Valentina atiende tambien por Messenger e Instagram con el MISMO cerebro.
//  Cada cliente se identifica con un id con prefijo, para que no choque con
//  los numeros de WhatsApp:
//     "fb:<PSID>"   Messenger
//     "ig:<IGSID>"  Instagram Direct
//  Por fuera usan la misma Graph API (POST /me/messages) con el token de la
//  PAGINA de Facebook del hotel (META_PAGE_TOKEN).
// ============================================================
import { config } from '../config.js';

const PREFIJOS = { fb: 'Messenger', ig: 'Instagram' };

/** ¿Este id es de Messenger o Instagram (y no un numero de WhatsApp)? */
export function esSocial(id) {
  return typeof id === 'string' && /^(fb|ig):/.test(id);
}

/** "Messenger" | "Instagram" | "" */
export function canalSocialDe(id) {
  return esSocial(id) ? PREFIJOS[id.slice(0, 2)] : '';
}

export function socialActivo() {
  return !!config.social.pageToken;
}

function base() {
  return `${config.whatsapp.graphBase}/${config.whatsapp.graphVersion}`;
}

/**
 * Convierte el cuerpo del webhook de Messenger (object "page") o Instagram
 * (object "instagram") en mensajes simples. Ignora ecos (lo que envia la propia
 * pagina), entregas, lecturas y reacciones.
 * @returns {Array<{from:string, id:string, tipo:string, texto:string, nombre:string, canal:string}>}
 */
export function parsearSocial(body) {
  const resultado = [];
  if (!body || (body.object !== 'page' && body.object !== 'instagram')) return resultado;
  const prefijo = body.object === 'page' ? 'fb' : 'ig';

  for (const entry of body.entry || []) {
    for (const ev of entry.messaging || []) {
      const emisor = ev.sender?.id;
      if (!emisor) continue;
      // El mensaje lo escribio la propia pagina/cuenta (eco o respuesta humana): no es del cliente.
      if (ev.message?.is_echo) continue;
      if (emisor === entry.id || emisor === config.social.pageId) continue;

      const m = ev.message;
      if (m) {
        const texto = typeof m.text === 'string' ? m.text : '';
        resultado.push({
          from: `${prefijo}:${emisor}`,
          id: m.mid || '',
          // Un adjunto (foto, audio, sticker, "me gusta") llega sin texto.
          tipo: texto ? 'text' : (m.attachments?.[0]?.type || 'unsupported'),
          texto: texto || m.quick_reply?.payload || '',
          nombre: '',
          canal: PREFIJOS[prefijo],
        });
        continue;
      }
      // Boton del menu / "Empezar": se trata como texto.
      const pb = ev.postback;
      if (pb) {
        resultado.push({
          from: `${prefijo}:${emisor}`,
          id: pb.mid || '',
          tipo: 'text',
          texto: pb.title || pb.payload || 'Hola',
          nombre: '',
          canal: PREFIJOS[prefijo],
        });
      }
    }
  }
  return resultado;
}

// ---------- Nombre del cliente (opcional, con cache) ----------
const nombres = new Map();

export async function nombreSocial(id) {
  if (!esSocial(id) || !socialActivo()) return '';
  if (nombres.has(id)) return nombres.get(id);
  const [pref, uid] = [id.slice(0, 2), id.slice(3)];
  let nombre = '';
  try {
    const campos = pref === 'ig' ? 'name,username' : 'name';
    const r = await fetch(`${base()}/${uid}?fields=${campos}&access_token=${encodeURIComponent(config.social.pageToken)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json().catch(() => ({}));
    nombre = (d.name || d.username || '').trim();
  } catch (_) { /* sin nombre: no pasa nada */ }
  if (nombre) nombres.set(id, nombre);
  return nombre;
}

// ---------- Envio ----------
async function llamar(payload) {
  const resp = await fetch(`${base()}/me/messages?access_token=${encodeURIComponent(config.social.pageToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('[social] Error de Graph API:', resp.status, JSON.stringify(datos));
    const motivo = datos?.error?.message ? `: ${datos.error.message}` : '';
    throw new Error(`Graph API respondio ${resp.status}${motivo}`);
  }
  return datos;
}

/** Parte un texto largo en trozos (Instagram acepta ~1000 caracteres por mensaje). */
export function trocear(texto, max = 900) {
  const t = String(texto || '').trim();
  if (t.length <= max) return [t];
  const partes = [];
  let resto = t;
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n', max);
    if (corte < max * 0.5) corte = resto.lastIndexOf(' ', max);
    if (corte < max * 0.5) corte = max;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

/** Envia un texto a un cliente de Messenger o Instagram (id con prefijo fb:/ig:). */
export async function enviarSocial(destino, texto) {
  if (!socialActivo()) throw new Error('Messenger/Instagram no estan configurados (falta META_PAGE_TOKEN).');
  const uid = destino.slice(3);
  let ultimo;
  for (const parte of trocear(texto)) {
    ultimo = await llamar({ recipient: { id: uid }, messaging_type: 'RESPONSE', message: { text: parte } });
  }
  return ultimo;
}

/** "Visto" para el cliente (opcional, no bloquea). */
export async function marcarVistoSocial(destino) {
  if (!socialActivo() || !esSocial(destino)) return;
  await llamar({ recipient: { id: destino.slice(3) }, sender_action: 'mark_seen' });
}
