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
    canal: '',            // de que "puerta" llego (Maps, Instagram, QR...)
    noLeidos: 0,          // mensajes del cliente sin leer en el panel
    creado: ahora(),
    ultimaActividad: ahora(),
    mensajes: [],         // { direccion, autor, tipo, texto, ts }
  };
  conversaciones.set(waId, conv);
  return conv;
}

// Detecta de que canal viene el cliente por el texto del PRIMER mensaje
// (los enlaces medibles wa.me traen una frase distinta por canal).
function detectarCanal(texto) {
  const t = (texto || '').toLowerCase();
  if (t.includes('google maps') || /\bmaps\b/.test(t)) return 'Google Maps';
  if (t.includes('instagram')) return 'Instagram';
  if (t.includes('tiktok')) return 'TikTok';
  if (t.includes('facebook')) return 'Facebook';
  if (t.includes('qr') || t.includes('código qr') || t.includes('codigo qr') || t.includes('escane')) return 'QR físico';
  if (t.includes('página web') || t.includes('pagina web') || t.includes('sitio web')) return 'Sitio web';
  return '';
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
    // La primera vez que detectamos un canal en el texto, lo fijamos.
    if (!conv.canal) {
      const c = detectarCanal(texto);
      if (c) conv.canal = c;
    }
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

  /**
   * Resumen de conversaciones para la lista del panel.
   * Con desde/hasta (YYYY-MM-DD) muestra solo las que tuvieron algun mensaje
   * en ese rango de dias, y el "ultimo" mostrado es el ultimo dentro del rango.
   */
  listar(desde, hasta) {
    const ini = desde ? new Date(desde + 'T00:00:00').getTime() : null;
    const fin = hasta ? new Date(hasta + 'T23:59:59.999').getTime() : null;
    const filtrando = ini != null || fin != null;
    const salida = [];

    for (const c of conversaciones.values()) {
      let ultimo;
      if (filtrando) {
        const enRango = c.mensajes.filter(
          (m) => (ini == null || m.ts >= ini) && (fin == null || m.ts <= fin)
        );
        if (!enRango.length) continue; // sin actividad en el rango: se omite
        ultimo = enRango[enRango.length - 1];
      } else {
        ultimo = c.mensajes[c.mensajes.length - 1];
      }
      salida.push({
        waId: c.waId,
        nombre: c.nombre,
        modo: c.modo,
        escalado: c.escalado,
        noLeidos: c.noLeidos,
        necesitaAtencion: c.escalado || c.modo === 'humano',
        ultimaActividad: ultimo ? ultimo.ts : c.ultimaActividad,
        ultimoTexto: ultimo?.texto || '',
        ultimoAutor: ultimo?.autor || '',
      });
    }
    return salida.sort((a, b) => b.ultimaActividad - a.ultimaActividad);
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

  /**
   * Cuenta las conversaciones por canal de origen (Maps, Instagram, QR...).
   * Filtro opcional por fechas (según última actividad). Devuelve una lista
   * ordenada de mayor a menor.
   */
  canalesResumen(desde, hasta) {
    const conteo = new Map();
    for (const c of conversaciones.values()) {
      const dia = new Date(c.ultimaActividad).toISOString().slice(0, 10);
      if (desde && dia < desde) continue;
      if (hasta && dia > hasta) continue;
      const canal = c.canal || 'Directo / Anuncio';
      conteo.set(canal, (conteo.get(canal) || 0) + 1);
    }
    return [...conteo.entries()]
      .map(([canal, total]) => ({ canal, total }))
      .sort((a, b) => b.total - a.total);
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
      canal: c.canal || '',
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
