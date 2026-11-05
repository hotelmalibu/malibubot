// probar-fechas-cerradas.js — Fechas cerradas: Valentina no vende esas noches (panel + herramientas). node scripts/probar-fechas-cerradas.js
import http from 'http';
import net from 'net';
import { readFileSync } from 'fs';

const servidor = (manejador) => new Promise((ok) => {
  const s = http.createServer((req, res) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => manejador(req, res, Buffer.concat(partes)));
  });
  s.listen(0, () => ok(s));
});

const graph = { mensajes: [], subidas: 0 };
const correos = [];
const peticionesClaude = [];
const graphSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && /\/123\/media$/.test(req.url)) { graph.subidas++; return res.end(JSON.stringify({ id: `MEDIA-${graph.subidas}` })); }
  if (req.method === 'POST' && /\/123\/messages$/.test(req.url)) { graph.mensajes.push(JSON.parse(cuerpo.toString() || '{}')); return res.end('{"messages":[{"id":"wamid.X"}]}'); }
  res.end('{}');
});
const claudeSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    peticionesClaude.push(JSON.parse(cuerpo.toString() || '{}'));
    return res.end(JSON.stringify({ id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-falso', content: [{ type: 'text', text: 'Con gusto 😊' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }));
  }
  res.statusCode = 404; res.end('{}');
});
const resendSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/emails') { correos.push(JSON.parse(cuerpo.toString() || '{}')); return res.end(JSON.stringify({ id: `em_${correos.length}` })); }
  res.statusCode = 404; res.end('{}');
});
const rapydSrv = await servidor((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ status: { status: 'SUCCESS' }, data: { id: 'checkout_1', redirect_url: 'https://checkout.rapyd.test/abc123' } }));
});

const puerto = await new Promise((ok) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
Object.assign(process.env, {
  PORT: String(puerto), ADMIN_PASSWORD: 'clave-de-prueba', WHATSAPP_TOKEN: 'token-de-prueba', WHATSAPP_PHONE_NUMBER_ID: '123',
  GRAPH_API_BASE: `http://127.0.0.1:${graphSrv.address().port}`,
  RAPYD_ACCESS_KEY: 'ak_prueba', RAPYD_SECRET_KEY: 'sk_prueba', RAPYD_BASE_URL: `http://127.0.0.1:${rapydSrv.address().port}`,
  RESEND_API_KEY: 're_prueba', RESEND_API_BASE: `http://127.0.0.1:${resendSrv.address().port}`, CORREO_RECEPCION: 'reservas@hotelmalibu.co', PUBLIC_URL: 'https://bot.ejemplo.test',
  ANTHROPIC_API_KEY: 'sk-falsa-de-prueba', ANTHROPIC_BASE_URL: `http://127.0.0.1:${claudeSrv.address().port}`, IA_REINTENTOS: '0',
});
for (const k of ['DATABASE_URL', 'WHATSAPP_APP_SECRET', 'META_APP_SECRET', 'META_IG_APP_SECRET', 'CORREO_COPIA', 'CORREO_ALERTAS', 'IA_ALERTAS', 'TRANSFERENCIA_ACTIVA', 'TRANSFERENCIA_DATOS', 'ADMIN_TOTP_SECRET', 'ADMIN_USUARIO', 'VIK_SYNC_URL', 'ANTHROPIC_MODELO']) delete process.env[k];

await import('../src/index.js'); // arranca el servidor real en `puerto`
const A = await import('../src/ia/agente.js');
const { store } = await import('../src/almacen/conversaciones.js');
const { reservasStore, hidratarReservas } = await import('../src/almacen/reservas.js');
const { documentosStore } = await import('../src/datos/documentos.js');
const { confirmarPago } = await import('../src/pagos/confirmar.js');
const { enviarComprobanteTransferencia } = await import('../src/correo/enviar.js');
const { COMENTARIO_NUEVA_TORRE, admiteNuevaTorre, pidioNuevaTorre, lineaNuevaTorre, limpiarComentarios } = await import('../src/datos/torre.js');
const { TIPOS_HABITACION } = await import('../src/datos/habitaciones.js');

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperar(cond, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await espera(30); } return cond(); }
const silencio = async (fn) => { const e = console.error; const w = console.warn; const l = console.log; console.error = () => {}; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };
const enHoy = (dias) => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);
const IN = enHoy(20), OUT = enHoy(22);

const viernes = (() => { for (let d = 21; d < 35; d++) { if (new Date(enHoy(d) + 'T12:00:00').getDay() === 5) return d; } return 21; })();
const VIE_IN = enHoy(viernes), VIE_OUT = enHoy(viernes + 1);
const pdf = (marca) => Buffer.from(`%PDF-1.4\n% ${marca}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`);
const BASE = `http://127.0.0.1:${puerto}`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* arrancando */ } await espera(100); }
const { listarCierres, primeraNocheCerrada } = await import('../src/datos/cierres.js');
const login = await fetch(`${BASE}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'recepcion', clave: 'clave-de-prueba' }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const api = (ruta, cuerpo) => fetch(`${BASE}/admin/api${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then(async (x) => ({ status: x.status, ...(await x.json()) }));
const d = (n) => enHoy(n);
store.registrarEntrante({ waId: '573001110031', nombre: 'Rosa Pérez', tipo: 'text', texto: 'Hola' });
const W = '573001110031';
ok('sin cierres Valentina vende', listarCierres().length === 0 && primeraNocheCerrada(d(30), d(32)) === null);
let r = await api('/cierres', { desde: d(31), hasta: d(33), motivo: 'Evento' });
ok('recepción cierra un rango (ambas noches incluidas)', r.ok && r.cierres.length === 1 && r.cierres[0].motivo === 'Evento');
ok('fechas mal puestas se rechazan', (await api('/cierres', { desde: d(40), hasta: d(39) })).status === 400 && (await api('/cierres', { desde: 'x', hasta: 'y' })).status === 400);
ok('cuenta como cerrada una estadía que toca una noche cerrada, pero no si sale justo antes', primeraNocheCerrada(d(30), d(32)) === d(31) && primeraNocheCerrada(d(33), d(35)) === d(33) && primeraNocheCerrada(d(30), d(31)) === null && primeraNocheCerrada(d(34), d(36)) === null);
let c = await A.ejecutarHerramienta(W, 'consultar_disponibilidad', { fecha: d(32) });
ok('consultar una fecha cerrada: 0 disponibles y se le dice que no hay habitaciones', c.cerrado === true && c.disponibles === 0 && /NO tenemos habitaciones disponibles/.test(c.instruccion));
c = await A.ejecutarHerramienta(W, 'consultar_disponibilidad', { fecha: d(34) });
ok('una fecha abierta responde normal', !c.cerrado);
await documentosStore.guardar('cert-davivienda', { nombre: 'Cert.pdf', datos: pdf('d') });
const base = { tipoHabitacion: 'Habitación Estándar', personas: 2, email: 'r@ejemplo.test' };
for (const h of ['reservar_pago_en_hotel', 'generar_link_pago', 'reservar_pago_transferencia']) {
  c = await silencio(() => A.ejecutarHerramienta(W, h, { ...base, checkIn: d(32), checkOut: d(34) }));
  ok(`${h}: no reserva una estadía con noche cerrada`, c.ok === false && /fecha cerrada/.test(c.error) && reservasStore.vigentesDe(W).length === 0, JSON.stringify(c));
}
c = await silencio(() => A.ejecutarHerramienta(W, 'reservar_pago_en_hotel', { ...base, checkIn: d(34), checkOut: d(36) }));
ok('fuera del cierre sí reserva', c.ok === true);
ok('el prompt le dice cómo responder', /FECHAS CERRADAS/.test(A.sistema('')) && /sin explicar el motivo/.test(A.sistema('')));
const id = r.cierres[0].id;
r = await api(`/cierres/${id}/quitar`, {});
ok('al volver a abrir, se vende otra vez', r.ok && r.cierres.length === 0 && primeraNocheCerrada(d(32), d(34)) === null);
ok('exige sesión', (await fetch(`${BASE}/admin/api/cierres`, { redirect: 'manual' })).status !== 200);
console.log(fallos ? `\n❌ ${fallos} fallaron.` : '\n✅ Todo bien: las fechas cerradas funcionan.');
process.exit(fallos ? 1 : 0);
