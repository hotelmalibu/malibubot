// ============================================================
//  index.js — Servidor de MALIBUBOT.
//  Fase 1 (eco de WhatsApp) + Consola de monitoreo y handoff humano.
//
//  Endpoints:
//   GET  /                     -> ping
//   GET  /health               -> health check (Render)
//   GET  /webhook/whatsapp      -> verificacion del webhook (Meta)
//   POST /webhook/whatsapp      -> recibe mensajes; responde (eco) o cede al humano
//   GET  /admin                 -> consola web (protegida con ADMIN_PASSWORD)
// ============================================================
import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config, revisarConfig } from './config.js';
import { verificarFirma } from './whatsapp/firma.js';
import { parsearMensajes } from './whatsapp/recibir.js';
import { enviarTexto, marcarLeido } from './whatsapp/enviar.js';
import { store } from './almacen/conversaciones.js';
import { reservasStore } from './almacen/reservas.js';
import { responderIA } from './ia/agente.js';
import { verificarWebhook as verificarWebhookRapyd, consultarCheckout, rapydActivo } from './pagos/rapyd.js';
import { confirmarPago } from './pagos/confirmar.js';
import { requiereSesion } from './admin/sesion.js';
import { loginRouter, adminRouter } from './admin/rutas.js';

const app = express();

// Cuerpo crudo (rawBody) para verificar la firma de Meta.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ---------- Salud / ping ----------
app.get('/', (_req, res) => {
  res.status(200).send('MALIBUBOT en linea. Panel en /admin');
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, servicio: 'malibubot', fase: 1 });
});

// ---------- Politica de privacidad (requerida por Meta para publicar la app) ----------
const __dirname = dirname(fileURLToPath(import.meta.url));
const PRIVACIDAD_HTML = readFileSync(join(__dirname, 'legal', 'privacidad.html'), 'utf8');
app.get(['/privacidad', '/politica-de-privacidad', '/privacy'], (_req, res) => {
  res.type('html').send(PRIVACIDAD_HTML);
});

// ---------- Consola de monitoreo ----------
// Login/logout son publicos; el resto de /admin exige sesion.
app.use('/admin', loginRouter);
app.use('/admin', requiereSesion, adminRouter);

// ---------- Verificacion del webhook (Meta hace un GET) ----------
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('[webhook] Verificacion correcta.');
    return res.status(200).send(challenge);
  }
  console.warn('[webhook] Verificacion fallida (token no coincide).');
  return res.sendStatus(403);
});

// ---------- Recepcion de mensajes (Meta hace un POST) ----------
app.post('/webhook/whatsapp', async (req, res) => {
  // 1) Validar que venga de Meta.
  if (config.whatsapp.appSecret && !verificarFirma(req)) {
    console.warn('[webhook] Firma invalida. Peticion rechazada.');
    return res.sendStatus(403);
  }

  // 2) Responder 200 de inmediato.
  res.sendStatus(200);

  // 3) Procesar.
  try {
    const mensajes = parsearMensajes(req.body);
    for (const m of mensajes) {
      console.log(`[msg] de ${m.nombre || m.from} (${m.tipo}): ${m.texto}`);

      // Registrar en el panel.
      store.registrarEntrante({
        waId: m.from,
        nombre: m.nombre,
        tipo: m.tipo,
        texto: m.texto,
      });

      // Acuse de lectura en WhatsApp (no bloquea si falla).
      marcarLeido(m.id).catch(() => {});

      // Si un humano tomo el control, el bot NO responde.
      if (store.obtenerModo(m.from) === 'humano') {
        console.log(`[handoff] ${m.from} en modo humano; el bot no responde.`);
        continue;
      }

      // Modo bot -> responde la IA (Claude). Respaldo si no hay IA disponible.
      let respuesta = null;
      if (m.tipo === 'text') {
        respuesta = await responderIA(m.from);
      }
      if (!respuesta) {
        respuesta =
          m.tipo === 'text'
            ? 'Gracias por escribir al Hotel Malibú. En un momento te atendemos. ' +
              'Para reservas de habitaciones cuéntame tus fechas y número de personas.'
            : 'Por ahora solo puedo atender mensajes de texto. Escríbeme tu consulta y con gusto te ayudo.';
      }

      await enviarTexto(m.from, respuesta);
      store.registrarSaliente({ waId: m.from, autor: 'bot', texto: respuesta });
    }
  } catch (err) {
    console.error('[webhook] Error procesando el mensaje:', err);
  }
});

// ---------- Webhook de RAPYD (confirmacion de pago) ----------
app.post('/webhook/rapyd', async (req, res) => {
  if (!verificarWebhookRapyd(req)) {
    console.warn('[rapyd] Webhook con firma invalida. Rechazado.');
    return res.sendStatus(403);
  }
  res.sendStatus(200); // responder rapido

  try {
    const evento = req.body || {};
    const tipo = String(evento.type || '');
    const data = evento.data || {};
    const refId = data.merchant_reference_id;
    if (!refId) return;

    const reserva = reservasStore.obtenerPorId(refId);
    if (!reserva) {
      console.warn('[rapyd] No encontre la reserva', refId, 'para el evento', tipo);
      return;
    }

    if (tipo.includes('PAYMENT_COMPLETED') || data.paid === true || data.status === 'CLO') {
      await confirmarPago(reserva);
    } else if (tipo.includes('PAYMENT_FAILED') || data.status === 'ERR') {
      reservasStore.actualizarEstado(reserva.id, 'rechazado');
      console.log(`[rapyd] Pago rechazado. Reserva ${reserva.id} -> rechazado.`);
    }
  } catch (err) {
    console.error('[rapyd] Error procesando webhook:', err);
  }
});

// ---------- Paginas de retorno del pago ----------
function paginaPago(titulo, mensaje) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${titulo}</title></head>
    <body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#faf7f0;color:#2c2f34;
      display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
      <div style="max-width:420px;padding:30px">
        <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#9c6f2b;font-weight:700">Hotel Malibú</div>
        <h1 style="margin:10px 0">${titulo}</h1>
        <p style="font-size:16px;line-height:1.5;color:#4a4e55">${mensaje}</p>
      </div></body></html>`;
}
app.get('/pago/gracias', (_req, res) => {
  res.type('html').send(paginaPago('¡Gracias por tu pago!', 'Estamos confirmando tu reserva. Recibirás la confirmación en tu correo y por WhatsApp en unos minutos. Puedes cerrar esta ventana.'));
});
app.get('/pago/cancelado', (_req, res) => {
  res.type('html').send(paginaPago('Pago cancelado', 'No se completó el pago. Si quieres, vuelve al chat de WhatsApp y con gusto te ayudamos a reservar.'));
});

// ---------- Revisor de pagos (sin depender del webhook compartido) ----------
// Cada 90 s le pregunta a RAPYD por los checkouts "en proceso" recientes.
// Asi MALIBUBOT confirma el pago sin tocar el webhook de la pagina web.
const REVISION_MS = 90 * 1000;
const VENTANA_MS = 3 * 60 * 60 * 1000; // deja de revisar tras 3 h
async function revisarPagosPendientes() {
  if (!rapydActivo()) return;
  const ahora = Date.now();
  for (const r of reservasStore.listar()) {
    if (r.estado !== 'en_proceso' || !r.checkoutId) continue;
    if (ahora - r.creado > VENTANA_MS) continue;
    const estado = await consultarCheckout(r.checkoutId);
    if (!estado) continue;
    if (estado.pagado) await confirmarPago(reservasStore.obtenerPorId(r.id));
    else if (estado.rechazado) reservasStore.actualizarEstado(r.id, 'rechazado');
  }
}
setInterval(() => revisarPagosPendientes().catch((e) => console.error('[pago] revisor:', e.message)), REVISION_MS);

// ---------- Arranque ----------
app.listen(config.puerto, () => {
  revisarConfig();
  console.log(`[servidor] MALIBUBOT escuchando en el puerto ${config.puerto}`);
  console.log(`[servidor] Consola disponible en /admin`);
});
