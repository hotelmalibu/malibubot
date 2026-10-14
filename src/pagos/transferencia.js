// ============================================================
//  transferencia.js — Pago por TRANSFERENCIA bancaria.
//
//  1) El cliente elige transferir -> Valentina (herramienta
//     reservar_pago_transferencia) deja la reserva "en proceso" y le envia por
//     WhatsApp los certificados de las cuentas del hotel (Davivienda y
//     Bancolombia; PDF guardados en la base de datos, ver datos/documentos.js).
//  2) El cliente manda el comprobante (foto o PDF) -> procesarComprobante() lo
//     descarga de WhatsApp y lo reenvia por correo a recepcion
//     (reservas@hotelmalibu.co), ADJUNTO, con los datos de la reserva: es el
//     soporte del pago parcial o completo, por verificar en el banco.
//  3) Recepcion lo verifica y, desde el panel, pulsa "Pago total verificado" o
//     "Abono verificado" (confirmarTransferencia): el cliente recibe su
//     confirmacion por WhatsApp.
//
//  Las reservas por transferencia se reconocen por su referencia de pago
//  ("Transferencia bancaria · ..."): asi no hace falta tocar la base de datos.
// ============================================================
import { config } from '../config.js';
import { reservasStore, textoHabitaciones } from '../almacen/reservas.js';
import { store } from '../almacen/conversaciones.js';
import { enviarTexto, enviarDocumento, descargarMedia } from '../whatsapp/enviar.js';
import { esSocial } from '../whatsapp/social.js';
import { enviarComprobanteTransferencia } from '../correo/enviar.js';
import { documentosStore } from '../datos/documentos.js';
import { confirmarPago, confirmarAbonoTransferencia } from './confirmar.js';

/** Referencia de pago mientras se espera el comprobante / despues de recibirlo (el panel la muestra). */
export const REF_ESPERA = 'Transferencia bancaria · esperando comprobante';
const refRecibido = (n) => `Transferencia bancaria · comprobante recibido${n > 1 ? ` (${n})` : ''}`;

/** ¿Es una reserva que se paga por transferencia? */
export const esTransferencia = (r) => /^transferencia/i.test(String(r?.referenciaPago || ''));

/** Cuantos comprobantes se llevan reenviados de una reserva (sale de la referencia: "(2)"). */
function comprobantesDe(r) {
  if (!esTransferencia(r) || !/comprobante recibido/i.test(r.referenciaPago)) return 0;
  const m = String(r.referenciaPago).match(/\((\d+)\)/);
  return m ? parseInt(m[1], 10) : 1;
}

const primerNombre = (n) => {
  const p = String(n || '').trim().split(/\s+/)[0];
  return p && p.length <= 20 ? p : '';
};

/**
 * Reserva por transferencia de este cliente que aun espera verificacion (la mas reciente):
 * vigente (no anulada, salida no pasada) y en proceso o confirmada con saldo pendiente.
 */
export function transferenciaPendienteDe(waId) {
  if (!waId) return null;
  const lista = reservasStore
    .vigentesDe(waId)
    .filter((r) => esTransferencia(r) && (r.estado === 'en_proceso' || r.estado === 'pendiente_hotel'))
    .sort((a, b) => b.creado - a.creado);
  return lista[0] || null;
}

// ---------- 1) Certificados de las cuentas ----------

/**
 * Envia por WhatsApp los certificados bancarios cargados (uno por mensaje) y, si el hotel
 * configuro TRANSFERENCIA_DATOS, ese texto despues.
 * @returns {Promise<{ok:boolean, enviados:string[], fallaron:string[], error?:string, detalle?:string}>}
 *   `detalle` = el motivo que dio WhatsApp cuando fallo un envio (para mostrarlo en el panel).
 */
export async function enviarCertificados(waId) {
  if (esSocial(waId)) return { ok: false, enviados: [], fallaron: [], error: 'canal_social' };
  const docs = documentosStore.cargados();
  if (!docs.length) return { ok: false, enviados: [], fallaron: [], error: 'sin_certificados' };

  const enviados = [];
  const fallaron = [];
  let detalle = '';
  for (const d of docs) {
    try {
      await enviarDocumento(waId, { datos: d.datos, mime: d.mime, nombre: d.nombreEnvio, leyenda: d.leyenda });
      store.registrarSaliente({ waId, autor: 'bot', texto: `📎 ${d.leyenda} (PDF)` });
      enviados.push(d.etiqueta);
    } catch (err) {
      console.error(`[transferencia] No se pudo enviar el certificado ${d.etiqueta} a ${waId}:`, err.message);
      fallaron.push(d.etiqueta);
      detalle = detalle || err.message;
    }
  }
  if (!enviados.length) return { ok: false, enviados, fallaron, error: 'fallo_envio', detalle };

  if (config.transferencia.datosExtra) {
    try {
      await enviarTexto(waId, config.transferencia.datosExtra);
      store.registrarSaliente({ waId, autor: 'bot', texto: config.transferencia.datosExtra });
    } catch (err) {
      console.error('[transferencia] No se pudo enviar el texto de los datos de la cuenta:', err.message);
    }
  }
  return { ok: true, enviados, fallaron, ...(detalle ? { detalle } : {}) };
}

// ---------- 2) Comprobante del cliente ----------

const procesados = new Map(); // media id -> ts (Meta puede reenviar el webhook)
const ultimoAcuse = new Map(); // waId -> ts del ultimo mensaje de "recibi tu comprobante"
const ACUSE_MIN_MS = 90 * 1000;

const EXT_POR_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const mimeAceptado = (m) => m === 'application/pdf' || /^image\/(jpeg|png|webp)$/.test(m);

function olvidarViejos() {
  const limite = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, t] of procesados) if (t < limite) procesados.delete(k);
}

function nombreDelComprobante(m, mime, reserva, numero) {
  const original = String(m.media.nombre || '').split(/[\\/]/).pop().replace(/[^\p{L}\p{N} ._()\-]/gu, '').trim();
  if (original) return original.slice(0, 80);
  const hoy = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10); // fecha de Colombia
  return `comprobante-reserva-${reserva.id}-${numero}-${hoy}.${EXT_POR_MIME[mime] || 'bin'}`;
}

/** Ultimos mensajes de texto del cliente (contexto para recepcion, p. ej. "te pago la mitad hoy"). */
function mensajesRecientes(waId) {
  const conv = store.obtener(waId);
  if (!conv) return [];
  const desde = Date.now() - 24 * 60 * 60 * 1000;
  return conv.mensajes
    .filter((x) => x.autor === 'cliente' && (x.tipo || 'text') === 'text' && x.ts >= desde && (x.texto || '').trim())
    .slice(-3)
    .map((x) => x.texto.trim());
}

async function responder(waId, texto, silencioso) {
  if (silencioso) return;
  try {
    await enviarTexto(waId, texto);
    store.registrarSaliente({ waId, autor: 'bot', texto });
  } catch (err) {
    console.error('[transferencia] No se pudo responder al cliente:', err.message);
  }
}

/**
 * Atiende una foto o PDF que llego por WhatsApp. Si el cliente tiene una reserva por
 * transferencia pendiente, es su comprobante: se baja de WhatsApp y se reenvia a recepcion.
 * @param {{from:string, id:string, nombre:string, media:{id:string,mime:string,nombre:string,caption:string}}} m
 * @param {{silencioso?:boolean}} [opc]  true = no le escribe al cliente (p. ej. recepcion tiene el control del chat)
 * @returns {Promise<{manejado:boolean, enviado?:boolean, motivo?:string}>}
 *   manejado=false -> no era un comprobante: el webhook sigue con su flujo normal.
 */
export async function procesarComprobante(m, { silencioso = false } = {}) {
  if (!config.transferencia.activa || !m?.media?.id || esSocial(m.from)) return { manejado: false };
  const reserva = transferenciaPendienteDe(m.from);
  if (!reserva) return { manejado: false };

  olvidarViejos();
  if (procesados.has(m.media.id)) return { manejado: true, enviado: false, motivo: 'repetido' };
  procesados.set(m.media.id, Date.now());

  const nombre = primerNombre(reserva.nombre) || primerNombre(m.nombre);
  const saludo = nombre ? `${nombre}, ` : '';
  const yaEnviados = comprobantesDe(reserva);

  // Tope por reserva: evita que alguien llene el buzon de recepcion.
  if (yaEnviados >= config.transferencia.maxPorReserva) {
    console.warn(`[transferencia] Reserva ${reserva.id}: tope de comprobantes (${yaEnviados}) alcanzado; no se reenvia.`);
    await responder(m.from, `${saludo}ya tengo tus comprobantes y recepción los está revisando 🙏 Si necesitas algo más, escríbeme.`, silencioso);
    return { manejado: true, enviado: false, motivo: 'tope' };
  }

  // Solo foto o PDF (un Excel o un video no sirven como comprobante).
  const mimeDeclarado = String(m.media.mime || '').split(';')[0].trim().toLowerCase();
  if (mimeDeclarado && !mimeAceptado(mimeDeclarado)) {
    procesados.delete(m.media.id);
    await responder(m.from, `${saludo}para poder pasárselo a recepción necesito el comprobante como *foto* o *PDF* 🙏 ¿Me lo reenvías así?`, silencioso);
    return { manejado: true, enviado: false, motivo: 'tipo' };
  }

  const maxBytes = Math.round(config.transferencia.maxMb * 1024 * 1024);
  let archivo;
  try {
    const d = await descargarMedia(m.media.id, { maxBytes });
    if (!mimeAceptado(d.mime)) {
      await responder(m.from, `${saludo}para poder pasárselo a recepción necesito el comprobante como *foto* o *PDF* 🙏 ¿Me lo reenvías así?`, silencioso);
      return { manejado: true, enviado: false, motivo: 'tipo' };
    }
    archivo = { nombre: nombreDelComprobante(m, d.mime, reserva, yaEnviados + 1), datos: d.datos, bytes: d.bytes };
  } catch (err) {
    procesados.delete(m.media.id);
    if (err.codigo === 'grande') {
      await responder(m.from, `${saludo}el archivo pesa demasiado para reenviarlo 😅 ¿Me lo mandas como captura de pantalla o en un PDF más liviano?`, silencioso);
      return { manejado: true, enviado: false, motivo: 'grande' };
    }
    console.error(`[transferencia] No se pudo descargar el comprobante de ${m.from}:`, err.message);
    store.marcarEscalado(m.from, true); // que recepcion lo vea en el panel
    await responder(m.from, `${saludo}tuve un inconveniente para abrir tu comprobante 🙏 Ya avisé a recepción. Si quieres, también puedes enviarlo al correo reservas@hotelmalibu.co.`, silencioso);
    return { manejado: true, enviado: false, motivo: 'descarga' };
  }

  const numero = yaEnviados + 1;
  let enviado = false;
  try {
    enviado = await enviarComprobanteTransferencia(reserva, archivo, {
      numero,
      mensajeCliente: m.media.caption,
      recientes: mensajesRecientes(m.from),
    });
  } catch (err) {
    console.error('[transferencia] Error enviando el correo del comprobante:', err.message);
  }

  if (!enviado) {
    procesados.delete(m.media.id); // si el cliente lo reenvia, se vuelve a intentar
    store.marcarEscalado(m.from, true);
    console.error(`[transferencia] El correo del comprobante de la reserva ${reserva.id} NO salió; conversación marcada para atención.`);
    await responder(m.from, `${saludo}recibí tu comprobante, pero tuve un inconveniente al pasárselo a recepción 🙏 Ya les avisé; si prefieres, también puedes enviarlo a reservas@hotelmalibu.co.`, silencioso);
    return { manejado: true, enviado: false, motivo: 'correo' };
  }

  // Quedo reenviado: se marca en la reserva (el panel lo muestra) y se avisa al cliente.
  reserva.referenciaPago = refRecibido(numero);
  reservasStore.guardar(reserva);
  console.log(`[transferencia] Comprobante ${numero} de la reserva ${reserva.id} reenviado a recepción (${archivo.nombre}, ${archivo.bytes} bytes).`);

  const ahora = Date.now();
  if (!silencioso && ahora - (ultimoAcuse.get(m.from) || 0) > ACUSE_MIN_MS) {
    ultimoAcuse.set(m.from, ahora);
    const fechas = reserva.checkIn ? ` del ${reserva.checkIn} al ${reserva.checkOut}` : '';
    await responder(
      m.from,
      `¡Recibí tu comprobante${nombre ? ', ' + nombre : ''}! ✅ Ya se lo pasé a recepción para verificar el pago de tu reserva (${textoHabitaciones(reserva)}${fechas}). Apenas lo verifiquen te confirmo por aquí 🌴`,
      false
    );
  }
  return { manejado: true, enviado: true };
}

// ---------- 3) Verificacion de recepcion ----------

/**
 * Recepcion verifico la transferencia. `total` = pago completo (la reserva queda PAGADA);
 * `abono` = pago parcial (queda confirmada con el saldo pendiente para el hotel).
 * Avisa al cliente por WhatsApp y manda los correos de confirmacion. Idempotente.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function confirmarTransferencia(reserva, tipo) {
  if (!reserva) return { ok: false, error: 'Reserva no encontrada.' };
  if (tipo === 'total') {
    const hecho = await confirmarPago(reserva);
    // La referencia deja de decir "esperando comprobante": el pago completo ya se verifico.
    reserva.referenciaPago = 'Transferencia bancaria · pago total verificado';
    reservasStore.guardar(reserva);
    return { ok: true, nuevo: hecho };
  }
  if (tipo === 'abono') {
    const hecho = await confirmarAbonoTransferencia(reserva);
    return { ok: true, nuevo: hecho };
  }
  return { ok: false, error: 'Tipo de verificación inválido.' };
}

