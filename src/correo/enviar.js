// ============================================================
//  enviar.js — Envio de correos con Resend.
//  Se usa para confirmar la reserva al cliente y a recepcion cuando
//  RAPYD confirma el pago.
// ============================================================
import { config } from '../config.js';
import { precioCOP } from '../datos/habitaciones.js';

function activo() {
  return !!config.correo.resendApiKey;
}

// Bitácora en memoria de los últimos intentos de correo (para diagnóstico).
const ultimos = [];
function registrar(entrada) {
  ultimos.unshift({ cuando: new Date().toISOString(), ...entrada });
  if (ultimos.length > 25) ultimos.length = 25;
}
export function ultimosEnviosCorreo() {
  return { hayApiKey: activo(), remitente: config.correo.remitente, recepcion: config.correo.recepcion, ultimos };
}

async function enviarCorreo({ to, subject, html }) {
  if (!activo()) {
    console.warn('[correo] Sin RESEND_API_KEY; no se envia:', subject, '->', to);
    registrar({ to, subject, ok: false, error: 'Falta RESEND_API_KEY' });
    return false;
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.correo.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.correo.remitente,
        to,
        subject,
        html,
        ...(config.correo.responder ? { reply_to: config.correo.responder } : {}),
      }),
    });
    if (!resp.ok) {
      const d = await resp.text().catch(() => '');
      console.error('[correo] Error Resend:', resp.status, d.slice(0, 200), '| para:', to, '| asunto:', subject);
      registrar({ to, subject, ok: false, status: resp.status, error: d.slice(0, 300) });
      return false;
    }
    const info = await resp.json().catch(() => ({}));
    console.log('[correo] Enviado OK ->', to, '| id:', info.id || '?', '| asunto:', subject);
    registrar({ to, subject, ok: true, status: resp.status, id: info.id || null });
    return true;
  } catch (err) {
    console.error('[correo] Error enviando:', err.message);
    registrar({ to, subject, ok: false, error: err.message });
    return false;
  }
}

function plantilla(reserva, paraRecepcion) {
  const total = reserva.monto ? precioCOP(reserva.monto) : '';
  const pendiente = reserva.estado === 'pendiente_hotel';

  const titulo = paraRecepcion
    ? (pendiente ? 'Nueva reserva — PAGO PENDIENTE (cobro en el hotel)' : 'Nueva reserva PAGADA')
    : '¡Reserva confirmada!';
  const intro = paraRecepcion
    ? (pendiente
        ? 'Se confirmó una nueva reserva desde MALIBUBOT con PAGO PENDIENTE. El valor se cobra al huésped en el hotel:'
        : 'Se confirmó el pago de una nueva reserva desde MALIBUBOT:')
    : (pendiente
        ? `Hola ${reserva.nombre || ''}, tu reserva en el Hotel Malibú quedó confirmada. El pago está PENDIENTE y se realiza directamente en el hotel al llegar. ¡Te esperamos!`
        : `Hola ${reserva.nombre || ''}, tu reserva en el Hotel Malibú quedó confirmada. ¡Te esperamos!`);

  const etiquetaTotal = pendiente ? 'Total a pagar en el hotel' : 'Total pagado';
  // Aviso destacado del estado del pago.
  const avisoPago = pendiente
    ? `<div style="margin:14px 0;padding:10px 14px;background:#e9f0f8;border:1px solid #cddcee;border-radius:10px;color:#2f5b8a;font-size:14px;font-weight:700">PAGO PENDIENTE — se cobra en el hotel al llegar</div>`
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
      ${fila('Huésped', reserva.nombre)}
      ${fila('Celular', reserva.celular)}
      ${fila('Correo', reserva.email)}
      ${fila('Habitación', reserva.habitacion)}
      ${fila('Personas', reserva.personas)}
      ${fila('Check-in', reserva.checkIn)}
      ${fila('Check-out', reserva.checkOut)}
      ${fila(etiquetaTotal, total)}
      ${fila('Referencia de pago', reserva.referenciaPago)}
    </table>
    <p style="font-size:12px;color:#9aa0a8;margin-top:16px">Hotel y Centro de Eventos Malibú · Sincelejo, Sucre, Colombia</p>
  </div>`;
}

/** Diagnostico: envia un correo de prueba y devuelve la respuesta de Resend. */
export async function probarCorreo(to) {
  if (!config.correo.resendApiKey) {
    return { ok: false, error: 'Falta RESEND_API_KEY en el entorno.' };
  }
  const destino = to || config.correo.recepcion;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
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
    return {
      ok: resp.ok,
      status: resp.status,
      remitente: config.correo.remitente,
      destino,
      recepcionConfig: config.correo.recepcion,
      respuesta,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Envia la confirmacion de reserva al cliente y a recepcion. */
export async function confirmarReservaPorCorreo(reserva) {
  const pendiente = reserva.estado === 'pendiente_hotel';
  const tareas = [];
  if (reserva.email) {
    tareas.push(
      enviarCorreo({
        to: reserva.email,
        subject: pendiente
          ? 'Reserva confirmada (pago pendiente en el hotel) — Hotel Malibú'
          : 'Reserva confirmada — Hotel Malibú',
        html: plantilla(reserva, false),
      })
    );
  } else {
    console.warn('[correo] Reserva', reserva.id, 'SIN correo del cliente; no se envía al cliente.');
    registrar({ to: '(cliente sin correo)', subject: 'reserva ' + (reserva.id || ''), ok: false, error: 'La reserva no capturó el correo del cliente' });
  }
  if (config.correo.recepcion) {
    tareas.push(
      enviarCorreo({
        to: config.correo.recepcion,
        subject: pendiente
          ? `Nueva reserva PAGO PENDIENTE (cobro en hotel) — ${reserva.nombre || reserva.celular || ''}`
          : `Nueva reserva pagada — ${reserva.nombre || reserva.celular || ''}`,
        html: plantilla(reserva, true),
      })
    );
  }
  const res = await Promise.allSettled(tareas);
  return res.some((r) => r.status === 'fulfilled' && r.value);
}
