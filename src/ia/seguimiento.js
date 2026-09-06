// ============================================================
//  seguimiento.js — Recuperacion de conversaciones "calientes".
//
//  Si alguien pregunto precio/fechas y NO reservo, Valentina le escribe
//  sola tras unas horas de silencio (dentro de la ventana de 24 h de
//  WhatsApp), UNA sola vez por conversacion. Tambien sirve para el
//  "empujon" manual desde el panel.
// ============================================================
import { config } from '../config.js';
import { store } from '../almacen/conversaciones.js';
import { reservasStore } from '../almacen/reservas.js';
import { enviarTexto } from '../whatsapp/enviar.js';

const VENTANA_WA_MS = 24 * 60 * 60 * 1000; // WhatsApp: solo texto libre dentro de 24 h
const MARGEN_MS = 22 * 60 * 60 * 1000;     // el automatico no se envia pasadas 22 h

/** waIds con reserva ya confirmada (pagada o pago en hotel): esos ya cerraron. */
export function waIdsCerrados() {
  const s = new Set();
  for (const r of reservasStore.listar()) {
    if ((r.estado === 'pagado' || r.estado === 'pendiente_hotel') && r.waId) s.add(r.waId);
  }
  return s;
}

function primerNombre(nombre) {
  const n = (nombre || '').trim().split(/\s+/)[0];
  return n && n.length <= 20 ? n : '';
}

/** Mensaje corto y calido, en el tono de Valentina. */
export function mensajeSeguimiento(conv) {
  const nom = primerNombre(conv.nombre);
  return (
    `Hola${nom ? ' ' + nom : ''} 👋 Soy Valentina, del Hotel Malibú. ` +
    `Quedé pendiente de tu reserva 😊 ¿Te ayudo a apartar la habitación? ` +
    `Cuéntame tus fechas y te la dejo lista en un minuto. 🌴`
  );
}

/**
 * Envia el "empujon" a una conversacion (manual desde el panel o automatico).
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function enviarEmpujon(waId) {
  const conv = store.obtener(waId);
  if (!conv) return { ok: false, error: 'No existe esa conversación.' };
  if (waIdsCerrados().has(waId)) return { ok: false, error: 'Este cliente ya tiene una reserva confirmada.' };
  // UN solo seguimiento por conversacion, siempre (bandera o mensaje ya en el historial).
  if (store.yaSeguido(waId)) return { ok: false, error: 'A esta conversación ya se le envió el seguimiento (solo se permite uno).' };

  const ultimo = store.ultimoEntrante(waId);
  if (!ultimo || Date.now() - ultimo > VENTANA_WA_MS) {
    return {
      ok: false,
      error:
        'Pasaron más de 24 h desde su último mensaje: WhatsApp solo permite escribirle con una plantilla aprobada. ' +
        'Espera a que vuelva a escribir.',
    };
  }

  const texto = mensajeSeguimiento(conv);
  try {
    await enviarTexto(waId, texto);
  } catch (err) {
    return { ok: false, error: 'WhatsApp no aceptó el envío: ' + err.message };
  }
  // PRIMERO la bandera (asi todos los guardados que siguen ya llevan el
  // "seguimiento enviado" y ninguna carrera puede borrarla), LUEGO el mensaje.
  store.marcarSeguimiento(waId);
  store.registrarSaliente({ waId, autor: 'bot', texto });
  return { ok: true };
}

/** Tarea periodica: seguimiento automatico a las calientes que ya toca. */
export async function enviarSeguimientos() {
  if (!config.seguimiento.activo) return;
  const minMs = Math.max(0.5, config.seguimiento.horas) * 60 * 60 * 1000;
  const lista = store.paraSeguimiento({ cerrados: waIdsCerrados(), minMs, maxMs: MARGEN_MS, limite: 20 });
  for (const c of lista) {
    const r = await enviarEmpujon(c.waId);
    if (r.ok) console.log('[seguimiento] Enviado a', c.waId, c.nombre ? `(${c.nombre})` : '');
    else console.warn('[seguimiento] No enviado a', c.waId, ':', r.error);
  }
}
