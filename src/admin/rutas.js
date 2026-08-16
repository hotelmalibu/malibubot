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
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, 'panel.html'), 'utf8');

export const adminRouter = Router();

// ============================================================
//  Diagnostico y reparacion de la suscripcion de la WABA.
//  Es el paso que hace que Meta ENTREGUE los mensajes entrantes al webhook:
//  la app debe estar suscrita a la cuenta de WhatsApp Business (WABA).
//  Abrir en el navegador (pide la clave del panel):
//    /admin/api/waba/reparar?waba=EL_ID_DE_TU_WABA
//  Muestra el token? No. Solo devuelve el estado de la suscripcion.
// ============================================================
adminRouter.get('/api/waba/reparar', async (req, res) => {
  const { token, graphBase, graphVersion } = config.whatsapp;
  const wabaId = (req.query.waba || config.whatsapp.wabaId || '').trim();

  if (!token) {
    return res.status(400).json({
      ok: false,
      error: 'Falta WHATSAPP_TOKEN en el entorno (Render).',
    });
  }
  if (!wabaId) {
    return res.status(400).json({
      ok: false,
      error:
        'Falta el ID de la WABA. Abre esta ruta con ?waba=TU_ID ' +
        '(el "Identificador de la cuenta de WhatsApp Business" que viste en API Setup).',
    });
  }

  const url = `${graphBase}/${graphVersion}/${wabaId}/subscribed_apps`;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    // 1) Estado actual
    const antesResp = await fetch(url, { headers });
    const antes = await antesResp.json();

    // Si el token esta vencido/invalido, Graph responde con error de OAuth.
    if (!antesResp.ok) {
      return res.status(502).json({
        ok: false,
        pista:
          'Graph API rechazo la consulta. Causa tipica: el token esta VENCIDO ' +
          '(el temporal dura ~24 h) o el ID de WABA no es correcto.',
        respuesta: antes,
      });
    }

    // 2) SIEMPRE suscribe la app dueña del token (MALIBUBOT). Es idempotente:
    //    si ya estaba, no pasa nada; si estaba otra app (p. ej. la de prueba de
    //    Meta), esto agrega la nuestra para que los webhooks lleguen a Render.
    //    Con ?limpiar=1 primero quita la suscripcion de la app del token y la
    //    vuelve a crear (util para forzar un reenganche limpio).
    let limpiar = null;
    if (req.query.limpiar === '1') {
      const delResp = await fetch(url, { method: 'DELETE', headers });
      limpiar = await delResp.json();
    }

    const subResp = await fetch(url, { method: 'POST', headers });
    const suscripcion = await subResp.json();
    const accion = subResp.ok ? 'SUSCRIPCION-FORZADA-OK' : 'error-al-suscribir';

    // 3) Estado final
    const despuesResp = await fetch(url, { headers });
    const despues = await despuesResp.json();

    res.json({
      ok: subResp.ok,
      accion,
      mensaje:
        accion === 'SUSCRIPCION-FORZADA-OK'
          ? 'Listo. Se forzo la suscripcion de tu app (MALIBUBOT) a la WABA. Manda un "Hola": ahora deberia llegar al servidor.'
          : 'No se pudo suscribir; revisa la respuesta de abajo.',
      wabaId,
      antes,
      limpiar,
      suscripcion,
      appsSuscritas: despues,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

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
