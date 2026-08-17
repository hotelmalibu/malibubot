// ============================================================
//  conversaciones.js — Almacen en memoria de las conversaciones.
//
//  Guarda cada chat por numero (wa_id), su historial y si esta en
//  "modo bot" (responde MALIBUBOT) o "modo humano" (lo atiende una
//  persona desde el panel).
//
//  Es la capa EN VIVO (rapida, en memoria). Si hay base de datos
//  (DATABASE_URL), cada cambio se replica alli en segundo plano y al
//  arrancar la memoria se hidrata desde la base (ver hidratarConversaciones).
//  Sin base de datos, se comporta como antes: se borra al reiniciar.
// ============================================================
import { dbActivo, dbGuardarConversacion, dbGuardarMensaje } from './db.js';

const MAX_MENSAJES = 300; // tope por conversacion para acotar memoria

/** Replica un cambio en la base de datos, sin bloquear (fire-and-forget). */
function persistir(conv, mensaje) {
  if (!dbActivo()) return;
  dbGuardarConversacion(conv).catch((e) => console.error('[db] conv:', e.message));
  if (mensaje) dbGuardarMensaje(conv.waId, mensaje).catch((e) => console.error('[db] msg:', e.message));
}

/** @type {Map<string, object>} */
const conversaciones = new Map();

function ahora() {
  return Date.now();
}

function crearConversacion(waId, nombre) {
  const conv = {
    waId,
    nombre: nombre || '',
    modo: 'bot',          // 'bot' | 'humano'
    escalado: false,      // true si el bot pidio ayuda humana
    noLeidos: 0,          // mensajes del cliente sin leer en el panel
    creado: ahora(),
    ultimaActividad: ahora(),
    mensajes: [],         // { direccion, autor, tipo, texto, ts }
  };
  conversaciones.set(waId, conv);
  return conv;
}

function obtenerOCrear(waId, nombre) {
  const conv = conversaciones.get(waId);
  if (conv) {
    if (nombre && !conv.nombre) conv.nombre = nombre;
    return conv;
  }
  return crearConversacion(waId, nombre);
}

function agregarMensaje(conv, mensaje) {
  conv.mensajes.push(mensaje);
  if (conv.mensajes.length > MAX_MENSAJES) {
    conv.mensajes.splice(0, conv.mensajes.length - MAX_MENSAJES);
  }
  conv.ultimaActividad = mensaje.ts;
}

// ---------- API publica ----------

export const store = {
  /** Registra un mensaje entrante del cliente. */
  registrarEntrante({ waId, nombre, tipo, texto }) {
    const conv = obtenerOCrear(waId, nombre);
    const mensaje = {
      direccion: 'entrada',
      autor: 'cliente',
      tipo: tipo || 'text',
      texto: texto || '',
      ts: ahora(),
    };
    agregarMensaje(conv, mensaje);
    conv.noLeidos += 1;
    persistir(conv, mensaje);
    return conv;
  },

  /** Registra un mensaje saliente (autor: 'bot' o 'humano'). */
  registrarSaliente({ waId, autor, texto }) {
    const conv = obtenerOCrear(waId);
    const mensaje = {
      direccion: 'salida',
      autor: autor || 'bot',
      tipo: 'text',
      texto: texto || '',
      ts: ahora(),
    };
    agregarMensaje(conv, mensaje);
    persistir(conv, mensaje);
    return conv;
  },

  obtenerModo(waId) {
    return conversaciones.get(waId)?.modo || 'bot';
  },

  /** Cambia entre 'bot' y 'humano'. Al volver al bot, limpia el escalado. */
  establecerModo(waId, modo) {
    const conv = obtenerOCrear(waId);
    conv.modo = modo === 'humano' ? 'humano' : 'bot';
    if (conv.modo === 'bot') conv.escalado = false;
    persistir(conv);
    return conv;
  },

  /** Lo usara la herramienta escalar_a_humano (Fase 2+). */
  marcarEscalado(waId, valor = true) {
    const conv = obtenerOCrear(waId);
    conv.escalado = !!valor;
    if (valor) conv.modo = 'humano';
    persistir(conv);
    return conv;
  },

  marcarConversacionLeida(waId) {
    const conv = conversaciones.get(waId);
    if (conv) conv.noLeidos = 0;
    return conv;
  },

  /** Resumen de todas las conversaciones para la lista del panel. */
  listar() {
    return [...conversaciones.values()]
      .map((c) => {
        const ultimo = c.mensajes[c.mensajes.length - 1];
        return {
          waId: c.waId,
          nombre: c.nombre,
          modo: c.modo,
          escalado: c.escalado,
          noLeidos: c.noLeidos,
          necesitaAtencion: c.escalado || c.modo === 'humano',
          ultimaActividad: c.ultimaActividad,
          ultimoTexto: ultimo?.texto || '',
          ultimoAutor: ultimo?.autor || '',
        };
      })
      .sort((a, b) => b.ultimaActividad - a.ultimaActividad);
  },

  /** Conversacion completa (para el transcript). */
  obtener(waId) {
    return conversaciones.get(waId) || null;
  },

  /**
   * Estadisticas de conversaciones para el dashboard.
   * "activa" = con actividad en las ultimas 24 h o atendida por un humano.
   * Filtro opcional por fechas (segun ultima actividad).
   * @param {string} [desde] YYYY-MM-DD
   * @param {string} [hasta] YYYY-MM-DD
   */
  estadisticas(desde, hasta) {
    const limiteActiva = ahora() - 24 * 60 * 60 * 1000;
    let total = 0;
    let activas = 0;
    let enHumano = 0;

    for (const c of conversaciones.values()) {
      const dia = new Date(c.ultimaActividad).toISOString().slice(0, 10);
      if (desde && dia < desde) continue;
      if (hasta && dia > hasta) continue;
      total += 1;
      const activa = c.ultimaActividad >= limiteActiva || c.modo === 'humano';
      if (activa) activas += 1;
      if (c.modo === 'humano') enHumano += 1;
    }

    return {
      total,
      activas,
      inactivas: total - activas,
      enHumano,
    };
  },
};

/**
 * Reconstruye la memoria desde las filas de la base de datos (al arrancar).
 * @param {{convRows:object[], msgRows:object[]}} datos
 */
export function hidratarConversaciones({ convRows = [], msgRows = [] } = {}) {
  for (const c of convRows) {
    conversaciones.set(c.wa_id, {
      waId: c.wa_id,
      nombre: c.nombre || '',
      modo: c.modo === 'humano' ? 'humano' : 'bot',
      escalado: !!c.escalado,
      noLeidos: 0,
      creado: Number(c.creado) || ahora(),
      ultimaActividad: Number(c.ultima_actividad) || ahora(),
      mensajes: [],
    });
  }
  for (const m of msgRows) {
    let conv = conversaciones.get(m.wa_id);
    if (!conv) {
      // Mensaje sin metadatos de conversacion (raro): crea una minima.
      conv = crearConversacion(m.wa_id);
    }
    conv.mensajes.push({
      direccion: m.direccion,
      autor: m.autor,
      tipo: m.tipo || 'text',
      texto: m.texto || '',
      ts: Number(m.ts),
    });
  }
  // Acota cada conversacion al tope y ajusta la ultima actividad al ultimo mensaje.
  for (const conv of conversaciones.values()) {
    if (conv.mensajes.length > MAX_MENSAJES) {
      conv.mensajes.splice(0, conv.mensajes.length - MAX_MENSAJES);
    }
    const ultimo = conv.mensajes[conv.mensajes.length - 1];
    if (ultimo && ultimo.ts > conv.ultimaActividad) conv.ultimaActividad = ultimo.ts;
  }
  return conversaciones.size;
}
