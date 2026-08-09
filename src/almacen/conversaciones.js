// ============================================================
//  conversaciones.js — Almacen en memoria de las conversaciones.
//
//  Guarda cada chat por numero (wa_id), su historial y si esta en
//  "modo bot" (responde MALIBUBOT) o "modo humano" (lo atiende una
//  persona desde el panel).
//
//  NOTA: es en memoria. Se reinicia si el servicio se reinicia o
//  se redespliega. El historial DURADERO se guardara en el Google
//  Sheet en la Fase 2; aqui vive el estado en vivo del panel.
// ============================================================

const MAX_MENSAJES = 300; // tope por conversacion para acotar memoria

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
    agregarMensaje(conv, {
      direccion: 'entrada',
      autor: 'cliente',
      tipo: tipo || 'text',
      texto: texto || '',
      ts: ahora(),
    });
    conv.noLeidos += 1;
    return conv;
  },

  /** Registra un mensaje saliente (autor: 'bot' o 'humano'). */
  registrarSaliente({ waId, autor, texto }) {
    const conv = obtenerOCrear(waId);
    agregarMensaje(conv, {
      direccion: 'salida',
      autor: autor || 'bot',
      tipo: 'text',
      texto: texto || '',
      ts: ahora(),
    });
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
    return conv;
  },

  /** Lo usara la herramienta escalar_a_humano (Fase 2+). */
  marcarEscalado(waId, valor = true) {
    const conv = obtenerOCrear(waId);
    conv.escalado = !!valor;
    if (valor) conv.modo = 'humano';
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
};
