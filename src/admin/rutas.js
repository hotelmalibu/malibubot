// ============================================================
//  rutas.js — Rutas del panel.
//
//  Publicas (sin sesion), montadas con loginRouter:
//   GET  /admin/login                     -> pagina de ingreso
//   POST /admin/login                     -> valida y abre sesion (cookie)
//   GET  /admin/logout                    -> cierra sesion
//
//  Protegidas (requieren sesion), montadas con adminRouter:
//   GET  /admin/                          -> consola (HTML)
//   GET  /admin/api/conversaciones        -> lista
//   GET  /admin/api/conversaciones/:waId  -> transcript (marca leido)
//   POST /admin/api/conversaciones/:waId/responder  { texto }
//   POST /admin/api/conversaciones/:waId/modo       { modo }
//   GET  /admin/api/estadisticas?desde&hasta        -> dashboard
//   GET  /admin/api/reservas                        -> lista de reservas
//   POST /admin/api/reservas                        -> crea reserva
//   POST /admin/api/reservas/:id/estado             -> cambia estado
//   GET  /admin/api/waba/reparar?waba=ID            -> diagnostico WABA
// ============================================================
import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { store } from '../almacen/conversaciones.js';
import { reservasStore, ESTADOS } from '../almacen/reservas.js';
import { TIPOS_HABITACION } from '../datos/habitaciones.js';
import { ocupacionDelLibro } from '../datos/ocupacion.js';
import { probarAuth as probarAuthRapyd } from '../pagos/rapyd.js';
import { enviarTexto } from '../whatsapp/enviar.js';
import { config } from '../config.js';
import {
  validarCredenciales,
  crearToken,
  ponerCookieSesion,
  borrarCookieSesion,
  haySesion,
} from './sesion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, 'panel.html'), 'utf8');

// Reutiliza el logo (data URI) ya incrustado en panel.html para la pagina de login.
const logoMatch = HTML.match(/src="(data:image\/png;base64,[^"]+)"/);
const LOGO = logoMatch ? logoMatch[1] : '';
const LOGIN_HTML = readFileSync(join(__dirname, 'login.html'), 'utf8').replace(
  '__LOGO_DATA_URI__',
  LOGO
);

// ============================================================
//  Router PUBLICO (login / logout)
// ============================================================
export const loginRouter = Router();

loginRouter.get('/login', (req, res) => {
  if (haySesion(req)) return res.redirect('/admin');
  res.type('html').send(LOGIN_HTML);
});

loginRouter.post('/login', (req, res) => {
  if (!config.admin.password) {
    return res.status(503).json({ ok: false, error: 'Panel deshabilitado (falta ADMIN_PASSWORD).' });
  }
  const usuario = (req.body?.usuario || '').trim();
  const clave = req.body?.clave || '';
  if (!validarCredenciales(usuario, clave)) {
    return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
  }
  ponerCookieSesion(req, res, crearToken(usuario));
  res.json({ ok: true });
});

loginRouter.get('/logout', (_req, res) => {
  borrarCookieSesion(res);
  res.redirect('/admin/login');
});

// ============================================================
//  Router PROTEGIDO (requiere sesion, aplicada en index.js)
// ============================================================
export const adminRouter = Router();

// Consola
adminRouter.get('/', (_req, res) => {
  res.type('html').send(HTML);
});

// -------- Estadisticas del dashboard --------
adminRouter.get('/api/estadisticas', async (req, res) => {
  const desde = (req.query.desde || '').trim() || null;
  const hasta = (req.query.hasta || '').trim() || null;

  const habitaciones = reservasStore.estadisticas(desde, hasta);

  // Si esta conectado el Libro de Reservas (Google Sheet), la ocupacion real de
  // HOY sale de ahi (cuenta los colores); las reservas del bot/manual se suman
  // aparte. Si no, se usa solo lo que hay en memoria.
  // Consulta el libro para el día elegido (desde) o el de hoy.
  const libro = await ocupacionDelLibro(desde || null);
  if (libro) {
    habitaciones.ocupadas = libro.ocupadas;
    habitaciones.disponibles = libro.disponibles;
    habitaciones.reservadasLibro = libro.reservadas;
    habitaciones.mantenimiento = libro.mantenimiento;
    habitaciones.salidas = libro.salidas;
    habitaciones.nochesReservadasMes = libro.nochesReservadasMes;
    habitaciones.diaConsultado = libro.fecha;
    habitaciones.mes = libro.mes;
    habitaciones.fuenteOcupacion = 'libro';
  } else {
    habitaciones.fuenteOcupacion = 'memoria';
  }

  res.json({
    ok: true,
    rango: { desde, hasta },
    conversaciones: store.estadisticas(desde, hasta),
    habitaciones,
    hotel: {
      nombre: config.hotel.nombre,
      habitaciones: config.hotel.habitaciones,
      tipos: TIPOS_HABITACION,
    },
  });
});

// -------- Reservas de habitaciones --------
adminRouter.get('/api/reservas', (_req, res) => {
  res.json({ ok: true, reservas: reservasStore.listar() });
});

adminRouter.post('/api/reservas', (req, res) => {
  const b = req.body || {};
  if (!b.nombre && !b.waId) {
    return res.status(400).json({ ok: false, error: 'Indica al menos el nombre del huésped.' });
  }
  const reserva = reservasStore.crear({
    waId: b.waId,
    celular: b.celular,
    nombre: b.nombre,
    habitacion: b.habitacion,
    personas: b.personas,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    estado: b.estado,
    fuente: 'manual',
  });
  res.json({ ok: true, reserva });
});

adminRouter.post('/api/reservas/:id/estado', (req, res) => {
  const estado = req.body?.estado;
  if (!ESTADOS.includes(estado)) {
    return res.status(400).json({ ok: false, error: 'Estado inválido.' });
  }
  const r = reservasStore.actualizarEstado(req.params.id, estado);
  if (!r) return res.status(404).json({ ok: false, error: 'Reserva no encontrada.' });
  res.json({ ok: true, reserva: r });
});

// -------- Conversaciones --------
adminRouter.get('/api/conversaciones', (_req, res) => {
  res.json({ conversaciones: store.listar() });
});

adminRouter.get('/api/conversaciones/:waId', (req, res) => {
  const conv = store.obtener(req.params.waId);
  if (!conv) return res.status(404).json({ error: 'No existe esa conversacion.' });
  store.marcarConversacionLeida(conv.waId);
  res.json({ conversacion: conv });
});

adminRouter.post('/api/conversaciones/:waId/responder', async (req, res) => {
  const waId = req.params.waId;
  const texto = (req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ ok: false, error: 'Escribe un mensaje.' });

  try {
    await enviarTexto(waId, texto);
    store.registrarSaliente({ waId, autor: 'humano', texto });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin] Error enviando respuesta humana:', err.message);
    res.status(502).json({
      ok: false,
      error:
        'No se pudo enviar. Puede que la ventana de 24 h este cerrada ' +
        '(el cliente no escribe hace mas de un dia).',
    });
  }
});

adminRouter.post('/api/conversaciones/:waId/modo', (req, res) => {
  const modo = req.body?.modo;
  if (modo !== 'bot' && modo !== 'humano') {
    return res.status(400).json({ ok: false, error: 'Modo invalido.' });
  }
  const conv = store.establecerModo(req.params.waId, modo);
  res.json({ ok: true, modo: conv.modo });
});

// -------- Diagnostico de autenticacion con RAPYD --------
adminRouter.get('/api/rapyd/diag', async (req, res) => {
  const { accessKey, secretKey, baseUrl } = config.rapyd;
  const pista = (k) => (k ? `${k.slice(0, 4)}...${k.slice(-4)} (largo ${k.length})` : null);
  const resultado = await probarAuthRapyd();
  res.json({
    baseUrl,
    accessKeyPresente: !!accessKey,
    accessKeyPista: pista(accessKey),
    secretKeyPresente: !!secretKey,
    secretKeyPista: pista(secretKey),
    resultado,
  });
});

// -------- Lista los numeros de la WABA con su Phone number ID --------
// Abrir en el navegador (tras login):
//   /admin/api/waba/numeros?waba=EL_ID_DE_TU_WABA
adminRouter.get('/api/waba/numeros', async (req, res) => {
  const { token, graphBase, graphVersion } = config.whatsapp;
  const wabaId = (req.query.waba || config.whatsapp.wabaId || '').trim();
  if (!token) return res.status(400).json({ ok: false, error: 'Falta WHATSAPP_TOKEN.' });
  if (!wabaId) {
    return res.status(400).json({
      ok: false,
      error: 'Falta el ID de la WABA. Abre esta ruta con ?waba=TU_ID.',
    });
  }
  const url =
    `${graphBase}/${graphVersion}/${wabaId}/phone_numbers` +
    `?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (!r.ok) {
      return res.status(502).json({
        ok: false,
        pista: 'Graph API rechazo la consulta (token vencido o WABA incorrecta).',
        respuesta: d,
      });
    }
    res.json({
      ok: true,
      instruccion:
        'Copia el "id" del numero real (+57 300 2299991) y ponlo en Render como WHATSAPP_PHONE_NUMBER_ID.',
      numeros: d.data || [],
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// -------- Diagnostico/reparacion de la suscripcion de la WABA --------
adminRouter.get('/api/waba/reparar', async (req, res) => {
  const { token, graphBase, graphVersion } = config.whatsapp;
  const wabaId = (req.query.waba || config.whatsapp.wabaId || '').trim();

  if (!token) {
    return res.status(400).json({ ok: false, error: 'Falta WHATSAPP_TOKEN en el entorno (Render).' });
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
    const antesResp = await fetch(url, { headers });
    const antes = await antesResp.json();

    if (!antesResp.ok) {
      return res.status(502).json({
        ok: false,
        pista:
          'Graph API rechazo la consulta. Causa tipica: el token esta VENCIDO ' +
          '(el temporal dura ~24 h) o el ID de WABA no es correcto.',
        respuesta: antes,
      });
    }

    let limpiar = null;
    if (req.query.limpiar === '1') {
      const delResp = await fetch(url, { method: 'DELETE', headers });
      limpiar = await delResp.json();
    }

    const subResp = await fetch(url, { method: 'POST', headers });
    const suscripcion = await subResp.json();
    const accion = subResp.ok ? 'SUSCRIPCION-FORZADA-OK' : 'error-al-suscribir';

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
