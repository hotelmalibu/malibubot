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

      // Modo bot -> eco (Fase 1).
      const respuesta =
        m.tipo === 'text'
          ? `MALIBUBOT (prueba Fase 1) recibio tu mensaje: "${m.texto}"`
          : `MALIBUBOT (prueba Fase 1) recibio un mensaje de tipo "${m.tipo}". ` +
            `Por ahora solo respondo texto.`;

      await enviarTexto(m.from, respuesta);
      store.registrarSaliente({ waId: m.from, autor: 'bot', texto: respuesta });
    }
  } catch (err) {
    console.error('[webhook] Error procesando el mensaje:', err);
  }
});

// ---------- Arranque ----------
app.listen(config.puerto, () => {
  revisarConfig();
  console.log(`[servidor] MALIBUBOT escuchando en el puerto ${config.puerto}`);
  console.log(`[servidor] Consola disponible en /admin`);
});
