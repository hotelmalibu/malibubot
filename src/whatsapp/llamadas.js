// ============================================================
//  llamadas.js — Que pasa cuando un cliente intenta LLAMAR al bot.
//
//  El numero del bot es de la API de WhatsApp y no atiende llamadas. Si Meta
//  tiene activadas las llamadas para el numero, cada intento llega al webhook
//  como un evento "calls" (event: connect). Aqui se rechaza la llamada y se le
//  manda al cliente el numero al que si puede llamar, con enlace directo.
//  Un solo aviso por cliente cada 24 h (para no repetir si insiste).
// ============================================================
import { config } from '../config.js';
import { store } from '../almacen/conversaciones.js';
import { enviarTexto, rechazarLlamada } from './enviar.js';

const REPETIR_MS = 24 * 60 * 60 * 1000;
/** @type {Map<string, number>} waId -> ts del ultimo aviso */
const avisados = new Map();

/** "+57 314 593 3714" */
export function telefonoBonito(digitos = config.hotel.telefonoLlamadas) {
  const d = digitos.replace(/\D/g, '');
  if (d.startsWith('57') && d.length === 12) return `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return '+' + d;
}

/** Enlace que abre directo el chat de WhatsApp del numero de llamadas. */
export function enlaceLlamada(digitos = config.hotel.telefonoLlamadas) {
  return `https://wa.me/${digitos.replace(/\D/g, '')}`;
}

/** Mensaje EXACTO (pedido por el hotel) que recibe quien intenta llamar. */
export function mensajeLlamada() {
  return (
    `📞 Para llamadas por WhatsApp comunícate con nosotros al ${telefonoBonito()}. ` +
    `Toca este enlace y te abre el chat de ese número para llamar de una vez:\n` +
    enlaceLlamada()
  );
}

/**
 * Atiende un intento de llamada: rechaza (para que no quede timbrando) y
 * envia el aviso con el numero (una vez por cliente cada 24 h).
 * @param {{from:string, callId:string, nombre?:string}} llamada
 */
export async function atenderLlamada(llamada) {
  const { from, callId, nombre } = llamada;
  if (callId) rechazarLlamada(callId).catch((e) => console.warn('[llamadas] No se pudo rechazar:', e.message));
  if (!from) return { ok: false, error: 'sin numero' };

  // Que quede en el historial del panel.
  store.registrarEntrante({ waId: from, nombre, tipo: 'llamada', texto: '📞 Intentó llamar por WhatsApp' });

  const ultimo = avisados.get(from) || 0;
  if (Date.now() - ultimo < REPETIR_MS) return { ok: true, repetido: true };
  avisados.set(from, Date.now());

  const texto = mensajeLlamada();
  try {
    await enviarTexto(from, texto);
    store.registrarSaliente({ waId: from, autor: 'bot', texto });
    console.log('[llamadas] Aviso de llamada enviado a', from);
    return { ok: true };
  } catch (err) {
    avisados.delete(from); // que lo reintente en la proxima llamada
    console.error('[llamadas] No se pudo enviar el aviso a', from, ':', err.message);
    return { ok: false, error: err.message };
  }
}
