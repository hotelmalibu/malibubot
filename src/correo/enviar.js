// ============================================================
//  enviar.js — Envio de correos con Resend.
//  Se usa para confirmar la reserva al cliente y a recepcion cuando
//  RAPYD confirma el pago, y para avisar cancelaciones.
//
//  - Cada intento queda en una bitacora en memoria Y en PostgreSQL (tabla
//    correos), asi sobrevive a los redespliegues y se puede revisar en el
//    panel (/admin/correo).
//  - Si Resend falla (red, 5xx, 429) se reintenta hasta 3 veces.
//  - Con el id que devuelve Resend se puede consultar el estado REAL de
//    entrega (delivered / bounced / complained...) en estadoEnResend().
// ============================================================
import { config } from '../config.js';
import { precioCOP } from '../datos/habitaciones.js';
import { dbActivo, dbGuardarCorreo } from '../almacen/db.js';

function activo() {
  return !!config.correo.resendApiKey;
}

// Bitácora de los últimos intentos de correo (memoria + base de datos).
const ultimos = [];
function registrar(entrada) {
  const e = { ts: Date.now(), cuando: new Date().toISOString(), ...entrada };
  ultimos.unshift(e);
  if (ultimos.length > 60) ultimos.length = 60;
  if (dbActivo()) dbGuardarCorreo(e).catch((err) => console.error('[correo] db:', err.message));
}
export function hidratarCorreos(filas = []) {
  for (const f of filas) {
    ultimos.push({
      ts: Number(f.ts) || 0, cuando: new Date(Number(f.ts) || 0).toISOString(), to: f.destinatario, subject: f.asunto,
      ok: !!f.ok, status: f.status ?? undefined, error: f.error || undefined, id: f.resend_id || null, reservaId: f.reserva_id ?? undefined,
    });
  }
  ultimos.sort((a, b) => b.ts - a.ts);
  if (ultimos.length > 60) ultimos.length = 60;
  return filas.length;
}
export function ultimosEnviosCorreo() {
  return { hayApiKey: activo(), remitente: config.correo.remitente, recepcion: config.correo.recepcion, copia: config.correo.copia, ultimos };
}

/** Destinatarios de recepción: el buzón principal + las copias configuradas. */
function destinosRecepcion() {
  const set = new Set([config.correo.recepcion, ...config.correo.copia].filter(Boolean));
  return [...set];
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function enviarCorreo({ to, subject, html, reservaId, attachments }) {
  if (!activo()) {
    console.warn('[correo] Sin RESEND_API_KEY; no se envia:', subject, '->', to);
    registrar({ to, subject, ok: false, error: 'Falta RESEND_API_KEY', reservaId });
    return false;
  }
  const destinos = Array.isArray(to) ? to : [to];
  let ultimoError = '', ultimoStatus = null;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const resp = await fetch(`${config.correo.resendBase}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.correo.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: config.correo.remitente,
          to: destinos,
          subject,
          html,
          ...(config.correo.responder ? { reply_to: config.correo.responder } : {}),
          // Adjuntos: [{ filename, content (base64) }] (p. ej. el comprobante de una transferencia).
          ...(attachments?.length ? { attachments } : {}),
        }),
      });
      if (resp.ok) {
        const info = await resp.json().catch(() => ({}));
        console.log('[correo] Enviado OK ->', destinos.join(', '), '| id:', info.id || '?', '| asunto:', subject);
        registrar({ to: destinos.join(', '), subject, ok: true, status: resp.status, id: info.id || null, reservaId, intentos: intento });
        return true;
      }
      const d = await resp.text().catch(() => '');
      ultimoError = d.slice(0, 300); ultimoStatus = resp.status;
      console.error('[correo] Error Resend:', resp.status, d.slice(0, 200), '| para:', destinos.join(', '), '| asunto:', subject, `| intento ${intento}`);
      // 4xx (llave invalida, dominio no verificado, datos malos) no mejora reintentando; 429/5xx si.
      if (resp.status < 500 && resp.status !== 429) break;
    } catch (err) {
      ultimoError = err.message; ultimoStatus = null;
      console.error('[correo] Error enviando:', err.message, `| intento ${intento}`);
    }
    if (intento < 3) await espera(1500 * intento);
  }
  registrar({ to: destinos.join(', '), subject, ok: false, status: ultimoStatus, error: ultimoError, reservaId });
  return false;
}

/**
 * Consulta en Resend el estado real de entrega de un correo enviado.
 * @returns {Promise<{estado:string, detalle?:string}|null>}
 */
export async function estadoEnResend(id) {
  if (!activo() || !id) return null;
  try {
    const resp = await fetch(`${config.correo.resendBase}/emails/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${config.correo.resendApiKey}` },
      signal: AbortSignal.timeout(6000),
    });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok) return { estado: 'desconocido', detalle: d.message || `HTTP ${resp.status}` };
    return { estado: d.last_event || 'sent', detalle: d.created_at || '' };
  } catch (err) {
    return { estado: 'desconocido', detalle: err.message };
  }
}

/** Nombre legible del canal de una reserva, para el correo a recepción. */
function nombreCanal(fuente, waId) {
  if (fuente === 'bot' && /^fb:/.test(waId || '')) return 'Messenger (bot)';
  if (fuente === 'bot' && /^ig:/.test(waId || '')) return 'Instagram (bot)';
  const m = {
    'vikbooking': 'Página web',
    'vikbooking-booking': 'Booking.com',
    'vikbooking-expedia': 'Expedia',
    'vikbooking-ota': 'OTA (canal externo)',
    'bot': 'WhatsApp (bot)',
    'humano': 'WhatsApp (recepción)',
    'manual': 'Manual',
  };
  return m[fuente] || '';
}

function plantilla(reserva, paraRecepcion) {
  const total = reserva.monto ? precioCOP(reserva.monto) : '';
  const pendiente = reserva.estado === 'pendiente_hotel';
  // Abono por transferencia ya verificado: el saldo (no el total) se paga en el hotel.
  const abono = pendiente && /abono verificado/i.test(reserva.referenciaPago || '');
  const canal = paraRecepcion ? nombreCanal(reserva.fuente, reserva.waId) : '';

  const titulo = paraRecepcion
    ? (abono ? 'Nueva reserva — ABONO RECIBIDO (saldo en el hotel)' : pendiente ? 'Nueva reserva — PAGO PENDIENTE (cobro en el hotel)' : 'Nueva reserva PAGADA')
    : '¡Reserva confirmada!';
  const intro = paraRecepcion
    ? (abono
        ? 'Se verificó el ABONO por transferencia de una reserva de MALIBUBOT. El saldo se cobra al huésped en el hotel:'
        : pendiente
        ? 'Se confirmó una nueva reserva desde MALIBUBOT con PAGO PENDIENTE. El valor se cobra al huésped en el hotel:'
        : 'Se confirmó el pago de una nueva reserva desde MALIBUBOT:')
    : (abono
        ? `Hola ${reserva.nombre || ''}, recibimos tu abono y tu reserva en el Hotel Malibú quedó confirmada. El saldo se paga directamente en el hotel al llegar. ¡Te esperamos!`
        : pendiente
        ? `Hola ${reserva.nombre || ''}, tu reserva en el Hotel Malibú quedó confirmada. El pago está PENDIENTE y se realiza directamente en el hotel al llegar. ¡Te esperamos!`
        : `Hola ${reserva.nombre || ''}, tu reserva en el Hotel Malibú quedó confirmada. ¡Te esperamos!`);

  const etiquetaTotal = abono ? 'Valor total de la reserva' : pendiente ? 'Total a pagar en el hotel' : 'Total pagado';
  // Aviso destacado del estado del pago.
  const avisoPago = pendiente
    ? `<div style="margin:14px 0;padding:10px 14px;background:#e9f0f8;border:1px solid #cddcee;border-radius:10px;color:#2f5b8a;font-size:14px;font-weight:700">${abono ? 'ABONO RECIBIDO — el saldo se paga en el hotel al llegar' : 'PAGO PENDIENTE — se cobra en el hotel al llegar'}</div>`
    : `<div style="margin:14px 0;padding:10px 14px;background:#e4f2ea;border:1px solid #cbe6d6;border-radius:10px;color:#2f8f5b;font-size:14px;font-weight:700">PAGO CONFIRMADO ✓</div>`;

  const fila = (k, v) =>
    v ? `<tr><td style="padding:6px 10px;color:#6b6f77">${k}</td><td style="padding:6px 10px;font-weight:600;color:#2c2f34">${v}</td></tr>` : '';
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2c2f34">
    <div style="border-bottom:2px solid #b8873a;padding-bottom:10px;margin-bottom:14px">
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#9c6f2b;font-weight:700">Hotel y Centro de Eventos Malibú</div>
      <h2 style="margin:6px 0 0">${titulo}</h2>
    </div>
    <p style="font-size:15px;line-height:1.5">${intro}</p>
    ${avisoPago}
    <table style="border-collapse:collapse;background:#faf7f0;border:1px solid #ece6d8;border-radius:10px;width:100%">
      ${fila('Reserva N°', reserva.id)}
      ${fila('Canal', canal)}
      ${fila('Huésped', reserva.nombre)}
      ${fila('Celular', reserva.celular)}
      ${fila('Correo', reserva.email)}
      ${fila('Habitación', reserva.habitacion)}
      ${fila('Cantidad de habitaciones', reserva.cantidad || 1)}
      ${fila('Personas', reserva.personas)}
      ${fila('Check-in', reserva.checkIn ? `${reserva.checkIn} · desde las ${config.hotel.horaCheckIn}` : '')}
      ${fila('Check-out', reserva.checkOut ? `${reserva.checkOut} · hasta la ${config.hotel.horaCheckOut}` : '')}
      ${fila(etiquetaTotal, total)}
      ${fila('Referencia de pago', reserva.referenciaPago)}
    </table>
    <p style="font-size:12px;color:#9aa0a8;margin-top:16px">Hotel y Centro de Eventos Malibú · Sincelejo, Sucre, Colombia</p>
  </div>`;
}

const escaparHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pesoLegible(bytes) {
  const n = Number(bytes) || 0;
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

const ESTADO_EN_PANEL = {
  en_proceso: 'En proceso (esperando verificar el pago)',
  pendiente_hotel: 'Confirmada · saldo pendiente en el hotel',
  pagado: 'Pagada',
};

/** Correo a recepcion con el COMPROBANTE de una transferencia (adjunto). Todo texto del cliente va escapado. */
function plantillaComprobante(reserva, archivo, { numero = 1, mensajeCliente = '', recientes = [] } = {}) {
  const total = reserva.monto ? precioCOP(reserva.monto) : '';
  const fila = (k, v) =>
    v || v === 0 ? `<tr><td style="padding:6px 10px;color:#6b6f77">${k}</td><td style="padding:6px 10px;font-weight:600;color:#2c2f34">${escaparHtml(v)}</td></tr>` : '';
  // En orden de lectura: primero sus mensajes recientes y al final lo que escribio junto al comprobante.
  const citas = [...recientes, mensajeCliente].map((t) => String(t || '').trim()).filter(Boolean);
  const bloqueMensajes = citas.length
    ? `<div style="margin:14px 0;padding:10px 14px;background:#faf7f0;border:1px solid #ece6d8;border-radius:10px;font-size:14px;color:#2c2f34">
         <div style="font-size:12px;color:#6b6f77;font-weight:700;margin-bottom:4px">LO QUE ESCRIBIÓ EL CLIENTE</div>
         ${citas.slice(-4).map((t) => `<div style="margin:2px 0">“${escaparHtml(t.slice(0, 300))}”</div>`).join('')}
       </div>`
    : '';
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2c2f34">
    <div style="border-bottom:2px solid #b8873a;padding-bottom:10px;margin-bottom:14px">
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#9c6f2b;font-weight:700">Hotel y Centro de Eventos Malibú</div>
      <h2 style="margin:6px 0 0">Soporte de pago por transferencia</h2>
    </div>
    <p style="font-size:15px;line-height:1.5">El cliente envió por WhatsApp (MALIBUBOT) el comprobante de su transferencia: pago <b>parcial o completo</b> de las habitaciones. Va adjunto en este correo.</p>
    <div style="margin:14px 0;padding:10px 14px;background:#e9f0f8;border:1px solid #cddcee;border-radius:10px;color:#2f5b8a;font-size:14px;font-weight:700">COMPROBANTE RECIBIDO — POR VERIFICAR EN EL BANCO (Davivienda o Bancolombia)</div>
    <table style="border-collapse:collapse;background:#faf7f0;border:1px solid #ece6d8;border-radius:10px;width:100%">
      ${fila('Reserva N°', reserva.id)}
      ${fila('Canal', nombreCanal(reserva.fuente, reserva.waId))}
      ${fila('Huésped', reserva.nombre)}
      ${fila('Celular', reserva.celular)}
      ${fila('Correo', reserva.email)}
      ${fila('Habitación', reserva.habitacion)}
      ${fila('Cantidad de habitaciones', reserva.cantidad || 1)}
      ${fila('Personas', reserva.personas)}
      ${fila('Check-in', reserva.checkIn)}
      ${fila('Check-out', reserva.checkOut)}
      ${fila('Valor total de la reserva', total)}
      ${fila('Estado en el panel', ESTADO_EN_PANEL[reserva.estado] || reserva.estado)}
      ${fila('Comprobante n.º', numero)}
      ${fila('Archivo adjunto', `${archivo.nombre} · ${pesoLegible(archivo.bytes)}`)}
    </table>
    ${bloqueMensajes}
    <div style="margin:16px 0 4px;font-size:14px;line-height:1.55">
      <b>Qué hacer</b>
      <ol style="margin:6px 0 0 18px;padding:0">
        <li>Abre el adjunto y confirma en el banco que la transferencia llegó.</li>
        <li>Si pagó el <b>total</b>: en el panel (Reservas) pulsa <b>«Pago total verificado»</b>; el cliente recibe su confirmación por WhatsApp.</li>
        <li>Si fue un <b>abono</b>: pulsa <b>«Abono verificado»</b>; la reserva queda confirmada con el saldo pendiente para el hotel.</li>
        <li>Si algo no cuadra, escríbele desde la pestaña Conversaciones del panel.</li>
      </ol>
      <div style="margin-top:8px"><a href="${escaparHtml(config.publicUrl)}/admin" style="color:#9c6f2b;font-weight:700">Abrir el panel</a></div>
    </div>
    <p style="font-size:12px;color:#9aa0a8;margin-top:16px">Hotel y Centro de Eventos Malibú · Sincelejo, Sucre, Colombia</p>
  </div>`;
}

/**
 * Reenvia a recepcion (reservas@hotelmalibu.co) el comprobante de pago de una transferencia, adjunto,
 * junto con los datos de la reserva.
 * @param {object} reserva
 * @param {{nombre:string, datos:Buffer, bytes:number}} archivo  el comprobante tal como lo mando el cliente
 * @param {{numero?:number, mensajeCliente?:string, recientes?:string[]}} [extra]
 * @returns {Promise<boolean>} true si Resend lo acepto
 */
export async function enviarComprobanteTransferencia(reserva, archivo, extra = {}) {
  const destinos = destinosRecepcion();
  if (!destinos.length) return false;
  const canalTag = nombreCanal(reserva.fuente, reserva.waId);
  return enviarCorreo({
    to: destinos,
    subject: `Soporte de pago por transferencia — ${reserva.nombre || reserva.celular || ''} · ${reserva.checkIn || ''}${canalTag ? ` [${canalTag}]` : ''}`,
    html: plantillaComprobante(reserva, archivo, extra),
    reservaId: reserva.id,
    attachments: [{ filename: archivo.nombre, content: archivo.datos.toString('base64') }],
  });
}

/** Diagnostico: envia un correo de prueba y devuelve la respuesta de Resend. */
export async function probarCorreo(to) {
  if (!config.correo.resendApiKey) {
    return { ok: false, error: 'Falta RESEND_API_KEY en el entorno.' };
  }
  const destino = to || config.correo.recepcion;
  try {
    const resp = await fetch(`${config.correo.resendBase}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.correo.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.correo.remitente,
        to: destino,
        subject: 'Prueba MALIBUBOT ✅',
        html: '<p>Correo de prueba de MALIBUBOT. Si lo ves, el envío funciona. 🌴</p>',
        ...(config.correo.responder ? { reply_to: config.correo.responder } : {}),
      }),
    });
    const texto = await resp.text();
    let respuesta;
    try { respuesta = JSON.parse(texto); } catch { respuesta = texto; }
    registrar({ to: destino, subject: 'Prueba MALIBUBOT ✅', ok: resp.ok, status: resp.status, id: respuesta?.id || null, error: resp.ok ? '' : texto.slice(0, 300) });
    return {
      ok: resp.ok,
      status: resp.status,
      remitente: config.correo.remitente,
      destino,
      recepcionConfig: config.correo.recepcion,
      respuesta,
    };
  } catch (err) {
    registrar({ to: destino, subject: 'Prueba MALIBUBOT ✅', ok: false, error: err.message });
    return { ok: false, error: err.message };
  }
}

function plantillaCancelacion(reserva, motivo, paraRecepcion) {
  const total = reserva.monto ? precioCOP(reserva.monto) : '';
  const fila = (k, v) =>
    v ? `<tr><td style="padding:6px 10px;color:#6b6f77">${k}</td><td style="padding:6px 10px;font-weight:600;color:#2c2f34">${v}</td></tr>` : '';
  const titulo = paraRecepcion ? 'RESERVA CANCELADA' : 'Tu reserva fue cancelada';
  const intro = paraRecepcion
    ? `El huésped canceló su reserva por WhatsApp (MALIBUBOT). Libera la habitación en el Libro de Reservas${reserva.estado === 'pagado' ? ' y revisa si aplica devolución del pago' : ''}:`
    : `Hola ${reserva.nombre || ''}, confirmamos que tu reserva en el Hotel Malibú quedó CANCELADA. Si cambias de planes, escríbenos por WhatsApp y con gusto te ayudamos de nuevo.`;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2c2f34">
    <div style="border-bottom:2px solid #c05a3a;padding-bottom:10px;margin-bottom:14px">
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#9c6f2b;font-weight:700">Hotel y Centro de Eventos Malibú</div>
      <h2 style="margin:6px 0 0;color:#c05a3a">${titulo}</h2>
    </div>
    <p style="font-size:15px;line-height:1.5">${intro}</p>
    <div style="margin:14px 0;padding:10px 14px;background:#f7e6de;border:1px solid #ecc9bb;border-radius:10px;color:#c05a3a;font-size:14px;font-weight:700">CANCELADA${motivo ? ' — motivo: ' + motivo : ''}</div>
    <table style="border-collapse:collapse;background:#faf7f0;border:1px solid #ece6d8;border-radius:10px;width:100%">
      ${fila('Reserva N°', reserva.id)}
      ${fila('Huésped', reserva.nombre)}
      ${fila('Celular', reserva.celular)}
      ${fila('Correo', reserva.email)}
      ${fila('Habitación', reserva.habitacion)}
      ${fila('Cantidad de habitaciones', reserva.cantidad || 1)}
      ${fila('Personas', reserva.personas)}
      ${fila('Check-in', reserva.checkIn)}
      ${fila('Check-out', reserva.checkOut)}
      ${fila(reserva.estado === 'pagado' ? 'Valor pagado' : 'Valor (no cobrado)', total)}
      ${fila('Referencia de pago', reserva.referenciaPago)}
    </table>
    <p style="font-size:12px;color:#9aa0a8;margin-top:16px">Hotel y Centro de Eventos Malibú · Sincelejo, Sucre, Colombia</p>
  </div>`;
}

/** Avisa la CANCELACION a recepcion (siempre) y al cliente (si dio correo). */
export async function cancelarReservaPorCorreo(reserva, motivo = '') {
  const tareas = [];
  const recepcion = destinosRecepcion();
  if (recepcion.length) {
    tareas.push(
      enviarCorreo({
        to: recepcion,
        subject: `CANCELACIÓN de reserva — ${reserva.nombre || reserva.celular || ''} · ${reserva.checkIn || ''}`,
        html: plantillaCancelacion(reserva, motivo, true),
        reservaId: reserva.id,
      })
    );
  }
  if (reserva.email) {
    tareas.push(
      enviarCorreo({
        to: reserva.email,
        subject: 'Reserva cancelada — Hotel Malibú',
        html: plantillaCancelacion(reserva, motivo, false),
        reservaId: reserva.id,
      })
    );
  }
  const res = await Promise.allSettled(tareas);
  return res.some((r) => r.status === 'fulfilled' && r.value);
}

/**
 * Envia la confirmacion de reserva al cliente y a recepcion.
 * Con `soloRecepcion: true` (reservas de OTA) no se le escribe al cliente:
 * su correo es el proxy enmascarado de Booking/Expedia, que ya le avisaron.
 */
export async function confirmarReservaPorCorreo(reserva, { soloRecepcion = false } = {}) {
  const pendiente = reserva.estado === 'pendiente_hotel';
  const abono = pendiente && /abono verificado/i.test(reserva.referenciaPago || '');
  const tareas = [];
  if (reserva.email && !soloRecepcion) {
    tareas.push(
      enviarCorreo({
        to: reserva.email,
        subject: abono
          ? 'Reserva confirmada (abono recibido) — Hotel Malibú'
          : pendiente
          ? 'Reserva confirmada (pago pendiente en el hotel) — Hotel Malibú'
          : 'Reserva confirmada — Hotel Malibú',
        html: plantilla(reserva, false),
        reservaId: reserva.id,
      })
    );
  } else if (soloRecepcion) {
    console.log('[correo] Reserva', reserva.id, 'es de OTA; no se le escribe al cliente (correo proxy).');
  } else {
    console.warn('[correo] Reserva', reserva.id, 'SIN correo del cliente; no se envía al cliente.');
    registrar({ to: '(cliente sin correo)', subject: 'reserva ' + (reserva.id || ''), ok: false, error: 'La reserva no capturó el correo del cliente', reservaId: reserva.id });
  }
  const recepcion = destinosRecepcion();
  if (recepcion.length) {
    const canalTag = nombreCanal(reserva.fuente, reserva.waId);
    const sufijoCanal = canalTag ? ` [${canalTag}]` : '';
    tareas.push(
      enviarCorreo({
        to: recepcion,
        subject: (abono
          ? `Nueva reserva ABONO RECIBIDO (saldo en hotel) — ${reserva.nombre || reserva.celular || ''}`
          : pendiente
          ? `Nueva reserva PAGO PENDIENTE (cobro en hotel) — ${reserva.nombre || reserva.celular || ''}`
          : `Nueva reserva pagada — ${reserva.nombre || reserva.celular || ''}`) + sufijoCanal,
        html: plantilla(reserva, true),
        reservaId: reserva.id,
      })
    );
  }
  const res = await Promise.allSettled(tareas);
  return res.some((r) => r.status === 'fulfilled' && r.value);
}
