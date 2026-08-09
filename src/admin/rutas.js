// ============================================================
//  rutas.js — Rutas del panel (montadas en /admin, tras auth).
//   GET  /admin/                          -> consola (HTML)
//   GET  /admin/api/conversaciones        -> lista
//   GET  /admin/api/conversaciones/:waId  -> transcript (marca leido)
//   POST /admin/api/conversaciones/:waId/responder  { texto }
//   POST /admin/api/conversaciones/:waId/modo       { modo: 'bot'|'humano' }
// ============================================================
import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { store } from '../almacen/conversaciones.js';
import { enviarTexto } from '../whatsapp/enviar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, 'panel.html'), 'utf8');

export const adminRouter = Router();

// Consola
adminRouter.get('/', (_req, res) => {
  res.type('html').send(HTML);
});

// Lista de conversaciones
adminRouter.get('/api/conversaciones', (_req, res) => {
  res.json({ conversaciones: store.listar() });
});

// Transcript de una conversacion (al abrirla, se marca como leida)
adminRouter.get('/api/conversaciones/:waId', (req, res) => {
  const conv = store.obtener(req.params.waId);
  if (!conv) return res.status(404).json({ error: 'No existe esa conversacion.' });
  store.marcarConversacionLeida(conv.waId);
  res.json({ conversacion: conv });
});

// Responder como humano
adminRouter.post('/api/conversaciones/:waId/responder', async (req, res) => {
  const waId = req.params.waId;
  const texto = (req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ ok: false, error: 'Escribe un mensaje.' });

  try {
    await enviarTexto(waId, texto);
    store.registrarSaliente({ waId, autor: 'humano', texto });
    res.json({ ok: true });
  } catch (err) {
    // Causa tipica: la ventana de 24 h esta cerrada (el cliente no
    // escribe hace mas de un dia). WhatsApp no permite texto libre ahi.
    console.error('[admin] Error enviando respuesta humana:', err.message);
    res.status(502).json({
      ok: false,
      error:
        'No se pudo enviar. Puede que la ventana de 24 h este cerrada ' +
        '(el cliente no escribe hace mas de un dia).',
    });
  }
});

// Cambiar de modo (tomar control / devolver al bot)
adminRouter.post('/api/conversaciones/:waId/modo', (req, res) => {
  const modo = req.body?.modo;
  if (modo !== 'bot' && modo !== 'humano') {
    return res.status(400).json({ ok: false, error: 'Modo invalido.' });
  }
  const conv = store.establecerModo(req.params.waId, modo);
  res.json({ ok: true, modo: conv.modo });
});
