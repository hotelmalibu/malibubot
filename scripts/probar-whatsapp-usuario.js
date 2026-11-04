// ============================================================
//  probar-whatsapp-usuario.js — Prueba OFFLINE de los clientes de WhatsApp con «nombre de usuario» (BSUID).
//
//  Desde 2026, si un cliente de WhatsApp activa su nombre de usuario, Meta OMITE su numero (`from`) en el aviso del mensaje
//  y solo manda su identificador interno (`from_user_id`). Antes el bot guardaba ese mensaje con el id vacio (un «chat
//  fantasma» sin dueño) y nunca le contestaba. Ahora:
//    · el chat del cliente es «bs:<BSUID>» y se le contesta con `recipient` en vez de `to`;
//    · si ya habia hablado con su numero, es el mismo chat;
//    · su celular se le pide (como en Instagram / Messenger) para reservar;
//    · si el mensaje no trae NI numero NI identificador, no se mete en ningun chat y recepcion recibe un correo.
//    node scripts/probar-whatsapp-usuario.js
//  Usa un WhatsApp, un Claude y un Resend FALSOS en local. No toca nada real.
// ============================================================
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

const graph = { mensajes: [], subidas: 0, rechazarBsuid: false };      // lo que el bot le manda a los clientes por WhatsApp
const correos = [];
const peticionesClaude = [];
const guion = [];
const graphSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && /\/123\/media$/.test(req.url)) { graph.subidas++; return res.end(JSON.stringify({ id: `MEDIA-${graph.subidas}` })); }
  if (req.method === 'POST' && /\/123\/messages$/.test(req.url)) {
    const m = JSON.parse(cuerpo.toString() || '{}');
    // Simula que WhatsApp RECHAZA los envios a un BSUID (p. ej. por la version de la API): solo los que traen `recipient`.
    if (graph.rechazarBsuid && m.recipient) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: '(#131009) Parameter value is not valid', code: 131009 } })); }
    graph.mensajes.push(m);
    return res.end('{"messages":[{"id":"wamid.X"}]}');
  }
  res.end('{}');
});
const claudeSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    peticionesClaude.push(JSON.parse(cuerpo.toString() || '{}'));
    const salida = guion.shift() || [{ type: 'text', text: 'Hola 😊 ¿Para qué fechas?' }];
    const usa = salida.some((b) => b.type === 'tool_use');
    return res.end(JSON.stringify({ id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-falso', content: salida, stop_reason: usa ? 'tool_use' : 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }));
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
const { parsearMensajes, parsearLlamadas } = await import('../src/whatsapp/recibir.js');
const { esBsuid, bsuidDe, idDeBsuid, bsuidValido, destinatario, sinCelularConocido } = await import('../src/whatsapp/bsuid.js');
const { enviarTexto, enviarPlantilla, enviarDocumento } = await import('../src/whatsapp/enviar.js');
const { sinDestinoRecientes, _reiniciarSinDestino } = await import('../src/whatsapp/sindestino.js');
const { atenderLlamada } = await import('../src/whatsapp/llamadas.js');
const { store, hidratarConversaciones, mensajesSinDuenio } = await import('../src/almacen/conversaciones.js');
const { reservasStore } = await import('../src/almacen/reservas.js');
const { documentosStore } = await import('../src/datos/documentos.js');
const { ejecutarHerramienta, simularIA, contextoCliente, sistema } = await import('../src/ia/agente.js');
const { destinoDe } = await import('../src/ia/recordatorio.js');

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperar(cond, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await espera(30); } return cond(); }
const silencio = async (fn) => { const e = console.error; const w = console.warn; const l = console.log; console.error = () => {}; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };
const enHoy = (dias) => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);
const IN = enHoy(20), OUT = enHoy(22);
const pdf = (marca) => Buffer.from(`%PDF-1.4\n% ${marca}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`);
const BASE = `http://127.0.0.1:${puerto}`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* aun arrancando */ } await espera(100); }

// ---- Avisos de Meta, como los manda Meta ----
const aviso = (contactos, mensajes) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: contactos, messages: mensajes } }] }] });
const contacto = (nombre, { username, wa_id, user_id } = {}) => ({ profile: { name: nombre, ...(username ? { username } : {}) }, ...(wa_id ? { wa_id } : {}), ...(user_id ? { user_id } : {}) });
let n = 0;
const msg = (cuerpo, extra = {}) => ({ id: `wamid.t${++n}`, type: 'text', text: { body: cuerpo }, ...extra });
const mandar = (cuerpo) => fetch(`${BASE}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
const BS_PEDRO = 'US.13491208655302741918'; // el ejemplo de la documentacion de Meta
const ID_PEDRO = `bs:${BS_PEDRO}`;

console.log('— Cómo se lee el aviso de Meta —');
let r = parsearMensajes(aviso([contacto('Ana Gómez', { wa_id: '573001110001' })], [msg('Hola', { from: '573001110001' })]));
ok('con número: todo como siempre (from = número, sin BSUID, sin campos extra)', r.length === 1 && r[0].from === '573001110001' && r[0].bsuid === '' && r[0].nombre === 'Ana Gómez' && r[0].tipo === 'text' && r[0].texto === 'Hola' && r[0].campos === undefined, JSON.stringify(r));
r = parsearMensajes(aviso([contacto('Ana Gómez', { wa_id: '573001110001', user_id: 'CO.111222333' })], [msg('Hola', { from: '573001110001', from_user_id: 'CO.111222333' })]));
ok('con número Y BSUID: el chat sigue siendo el del número y se anota su BSUID', r[0].from === '573001110001' && r[0].bsuid === 'CO.111222333', JSON.stringify(r));
r = parsearMensajes(aviso([contacto('Pedro Lara', { username: 'pedrolara', user_id: BS_PEDRO })], [msg('Hola me regalas porfa el menú de la parrillada', { from_user_id: BS_PEDRO })]));
ok('con nombre de usuario (sin `from`): el chat es «bs:<BSUID>», con su nombre de perfil y su usuario', r[0].from === ID_PEDRO && r[0].bsuid === BS_PEDRO && r[0].nombre === 'Pedro Lara' && r[0].usuario === 'pedrolara' && r[0].campos === undefined, JSON.stringify(r));
r = parsearMensajes(aviso([contacto('Pedro Lara', { user_id: 'CO.5' })], [msg('Hola', { from: null, from_user_id: 'CO.5' })]));
ok('`from: null` cuenta como «sin número»', r[0].from === 'bs:CO.5', JSON.stringify(r));
r = parsearMensajes(aviso([contacto('Misterio')], [msg('Hola?', {})]));
ok('sin número NI BSUID: `from` vacío y se dejan los NOMBRES de los campos que mandó Meta (sin valores)', r[0].from === '' && r[0].campos.includes('id') && r[0].campos.includes('text') && r[0].camposContacto.includes('profile') && !JSON.stringify(r[0].campos).includes('Hola?'), JSON.stringify(r));
r = parsearMensajes(aviso([contacto('Luisa', { user_id: 'CO.2' }), contacto('Pedro', { user_id: 'CO.1' })], [msg('uno', { from_user_id: 'CO.1' }), msg('dos', { from_user_id: 'CO.2' })]));
ok('dos clientes en el mismo aviso: a cada mensaje le toca SU contacto (se empareja por BSUID), aunque vengan en otro orden', r[0].nombre === 'Pedro' && r[0].from === 'bs:CO.1' && r[1].nombre === 'Luisa' && r[1].from === 'bs:CO.2', JSON.stringify(r.map((x) => [x.from, x.nombre])));
r = parsearMensajes(aviso([contacto('Segundo', { wa_id: '573002' }), contacto('Primero', { wa_id: '573001' })], [msg('a', { from: '573001' }), msg('b', { from: '573002' })]));
ok('...y con números también se empareja por número', r[0].nombre === 'Primero' && r[1].nombre === 'Segundo', JSON.stringify(r.map((x) => [x.from, x.nombre])));
r = parsearMensajes(aviso([contacto('Con Número', { user_id: 'CO.9', wa_id: '573009' })], [msg('hola', { from_user_id: 'CO.9' })]));
ok('sin `from` pero con SU contacto trayendo el número: se usa ese número', r[0].from === '573009' && r[0].bsuid === 'CO.9', JSON.stringify(r));
r = parsearMensajes(aviso([contacto('X', { user_id: 'CO.1<script>' })], [msg('hola', { from_user_id: 'CO.1<script>' }), msg('hola', { from_user_id: '   ' })]));
ok('un identificador con caracteres raros o vacío se ignora (queda «sin destino»)', r[0].from === '' && r[1].from === '', JSON.stringify(r));
r = parsearMensajes({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [msg('hola', { from: '573001110009' })] } }] }] });
ok('un aviso sin la lista de contactos no rompe nada', r.length === 1 && r[0].from === '573001110009' && r[0].nombre === '');
const llamadas = parsearLlamadas({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [contacto('Pedro', { user_id: BS_PEDRO })], calls: [{ id: 'wacid.1', event: 'connect', from_user_id: BS_PEDRO }, { id: 'wacid.2', event: 'connect', from: '573001110001' }] } }] }] });
ok('una llamada de alguien con nombre de usuario también se atiende por su BSUID', llamadas[0].from === ID_PEDRO && llamadas[1].from === '573001110001', JSON.stringify(llamadas));

console.log('\n— Ayudas del identificador —');
ok('«bs:...» es un chat sin número; los demás no', esBsuid(ID_PEDRO) && !esBsuid('573001110001') && !esBsuid('ig:123') && !esBsuid('fb:123') && !esBsuid('bs:') && !esBsuid('bs:<b>') && !esBsuid(undefined) && !esBsuid(null) && !esBsuid(5));
ok('bsuidDe / idDeBsuid / bsuidValido', bsuidDe(ID_PEDRO) === BS_PEDRO && bsuidDe('573001110001') === '' && idDeBsuid(BS_PEDRO) === ID_PEDRO && idDeBsuid('') === '' && idDeBsuid('a b') === '' && bsuidValido(BS_PEDRO) === BS_PEDRO && bsuidValido('x') === '' && bsuidValido(123) === '');
ok('sin celular conocido: Instagram, Messenger y WhatsApp con usuario; no un WhatsApp con número', sinCelularConocido('ig:1') && sinCelularConocido('fb:1') && sinCelularConocido(ID_PEDRO) && !sinCelularConocido('573001110001'));
ok('destinatario: `to` con el número o `recipient` con el BSUID (nunca los dos)', JSON.stringify(destinatario('573001110001')) === '{"to":"573001110001"}' && JSON.stringify(destinatario(ID_PEDRO)) === JSON.stringify({ recipient: BS_PEDRO }));

console.log('\n— Cómo se le escribe a cada uno (WhatsApp falso) —');
graph.mensajes.length = 0;
await enviarTexto('573001110001', 'Hola con número');
await enviarTexto(ID_PEDRO, 'Hola con usuario');
await enviarPlantilla(ID_PEDRO, 'recordatorio_llegada', 'es', ['Pedro']);
await enviarDocumento(ID_PEDRO, { datos: pdf('x'), nombre: 'cert.pdf', leyenda: 'Certificado' });
const [mNum, mUsr, mPla, mDoc] = graph.mensajes;
ok('con número: `to` y nada de `recipient`', mNum.to === '573001110001' && mNum.recipient === undefined && mNum.text.body === 'Hola con número');
ok('con usuario: `recipient` con el BSUID y nada de `to`', mUsr.recipient === BS_PEDRO && mUsr.to === undefined && mUsr.type === 'text' && mUsr.text.body === 'Hola con usuario', JSON.stringify(mUsr));
ok('las plantillas y los documentos también van a su BSUID', mPla.recipient === BS_PEDRO && mPla.to === undefined && mPla.type === 'template' && mDoc.recipient === BS_PEDRO && mDoc.to === undefined && mDoc.type === 'document', JSON.stringify([mPla, mDoc]));

console.log('\n— Un cliente con nombre de usuario escribe al webhook —');
const login = await fetch(`${BASE}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'recepcion', clave: 'clave-de-prueba' }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const get = (ruta) => fetch(`${BASE}${ruta}`, { headers: { Cookie: cookie } }).then((x) => x.json());
ok('el panel abre con la clave de prueba', login.status === 200 && cookie.startsWith('malibu_ses='));
graph.mensajes.length = 0; peticionesClaude.length = 0;
guion.push([{ type: 'text', text: '¡Buenas noches, Pedro! 😊 Bienvenido al Hotel Malibú. ¿Para qué fechas te gustaría la habitación?' }]);
ok('el webhook responde 200 de inmediato', (await mandar(aviso([contacto('Pedro Lara', { username: 'pedrolara', user_id: BS_PEDRO })], [msg('Hola me regalas porfa el menú de la parrillada', { from_user_id: BS_PEDRO })]))).status === 200);
await esperar(() => graph.mensajes.some((m) => m.type === 'text' && m.recipient === BS_PEDRO));
const resp = graph.mensajes.find((m) => m.type === 'text' && m.recipient === BS_PEDRO);
ok('Valentina le CONTESTA, al BSUID (`recipient`), sin `to`', !!resp && resp.to === undefined && /Buenas noches, Pedro/.test(resp.text.body), JSON.stringify(graph.mensajes));
const chat = store.obtener(ID_PEDRO);
ok('queda UN chat «bs:...» con su nombre, su BSUID, lo que escribió y lo que se le contestó', chat?.nombre === 'Pedro Lara' && chat.bsuid === BS_PEDRO && chat.mensajes.length === 2 && chat.mensajes[0].autor === 'cliente' && chat.mensajes[1].autor === 'bot', JSON.stringify(chat));
ok('y ya no hay ningún chat sin id', store.obtener(null) === null && store.obtener(undefined) === null && store.listar().every((c) => typeof c.waId === 'string' && c.waId));
const sis = peticionesClaude.at(-1)?.system || [];
ok('a Claude le llegan las instrucciones de «WhatsApp con usuario» (hay que pedir el celular) y su nombre de perfil', /tiene activado un USUARIO de WhatsApp/.test(sis[0]?.text || '') && /pídelo junto con la forma de pago/.test(sis[0]?.text || '') && !/CONFÍRMALO/.test(sis[0]?.text || '') && /Pedro Lara/.test(sis[1]?.text || '') && /Celular: NO lo tienes/.test(sis[1]?.text || '') && !/mismo WhatsApp/.test(sis[1]?.text || ''), JSON.stringify(sis).slice(0, 400));
const lista = (await get('/admin/api/conversaciones')).conversaciones;
const filaPedro = lista.find((c) => c.waId === ID_PEDRO);
ok('en el panel aparece con su id «bs:...» y lo último es la respuesta del bot (no «sin respuesta»)', filaPedro?.ultimoAutor === 'bot' && filaPedro.sinRespuestaIA === false, JSON.stringify(filaPedro));

console.log('\n— Un WhatsApp normal sigue igual —');
graph.mensajes.length = 0; peticionesClaude.length = 0;
guion.push([{ type: 'text', text: '¡Buenas noches, Ana! 😊' }]);
await mandar(aviso([contacto('Ana Gómez', { wa_id: '573001110001' })], [msg('Hola', { from: '573001110001' })]));
await esperar(() => graph.mensajes.some((m) => m.to === '573001110001'));
const respAna = graph.mensajes.find((m) => m.to === '573001110001');
ok('se le contesta con `to` (su número), como siempre', !!respAna && respAna.recipient === undefined && /Buenas noches, Ana/.test(respAna.text.body), JSON.stringify(graph.mensajes));
const sisAna = peticionesClaude.at(-1)?.system || [];
ok('...y su prompt NO trae el aviso del usuario de WhatsApp: confirma su mismo número', !/USUARIO de WhatsApp/.test(sisAna[0]?.text || '') && /CONFÍRMALO/.test(sisAna[0]?.text || '') && /es el número de este mismo WhatsApp/.test(sisAna[1]?.text || ''));

console.log('\n— Sin número NI identificador: no hay a quién contestar —');
_reiniciarSinDestino();
const chatsAntes = store.listar().length, mensajesAntes = graph.mensajes.length, correosAntes = correos.length;
peticionesClaude.length = 0;
ok('el webhook responde 200', (await mandar(aviso([contacto('Misterioso')], [msg('¿Cuánto cuesta una habitación?', {})]))).status === 200);
await esperar(() => correos.length > correosAntes);
ok('no se crea ningún chat, no se llama a Claude y no se escribe a nadie', store.listar().length === chatsAntes && peticionesClaude.length === 0 && graph.mensajes.length === mensajesAntes);
ok('queda anotado, con los nombres de los campos (no el contenido)', sinDestinoRecientes().length === 1 && sinDestinoRecientes()[0].campos.includes('text') && sinDestinoRecientes()[0].nombre === 'Misterioso', JSON.stringify(sinDestinoRecientes()));
const alerta = correos.at(-1);
ok('recepción recibe UN correo explicándolo, con lo que escribió', correos.length === correosAntes + 1 && alerta.to.includes('reservas@hotelmalibu.co') && /no se le pudo contestar/.test(alerta.subject) && /¿Cuánto cuesta una habitación\?/.test(alerta.html) && /Misterioso/.test(alerta.html), JSON.stringify(alerta).slice(0, 300));
await mandar(aviso([contacto('Otro')], [msg('Hola?', {})]));
await esperar(() => sinDestinoRecientes().length === 2);
await espera(200);
ok('un segundo mensaje igual se anota pero NO manda otro correo en 15 minutos', sinDestinoRecientes().length === 2 && correos.length === correosAntes + 1);
// Dos mensajes en el mismo aviso: el primero sin destino no frena al segundo.
graph.mensajes.length = 0; guion.push([{ type: 'text', text: 'Con gusto 😊' }]);
await mandar(aviso([contacto('Misterioso'), contacto('Carlos Ruiz', { wa_id: '573001110005' })], [msg('hola?', {}), msg('Buenas', { from: '573001110005' })]));
await esperar(() => graph.mensajes.some((m) => m.to === '573001110005'));
ok('...y si en el mismo aviso viene otro cliente normal, a ese sí se le contesta', graph.mensajes.some((m) => m.to === '573001110005' && /Con gusto/.test(m.text.body)), JSON.stringify(graph.mensajes));
const sn = await get('/admin/api/whatsapp/sin-numero');
ok('el panel lo muestra: chats sin número, mensajes viejos sin dueño y los que llegaron sin destino', sn.ok === true && sn.chatsSinNumero === 1 && sn.recientes.length === 3 && sn.antiguos.total === 0, JSON.stringify(sn).slice(0, 300));
ok('...y exige la sesión del panel', (await fetch(`${BASE}/admin/api/whatsapp/sin-numero`, { redirect: 'manual' })).status !== 200);

console.log('\n— Si WhatsApp rechaza el envío a un nombre de usuario, no es en silencio —');
const { enviosFallidosRecientes } = await import('../src/whatsapp/sindestino.js');
graph.rechazarBsuid = true; graph.mensajes.length = 0;
const correosAntes3 = correos.length, BS_RECHAZO = 'CO.4440001';
guion.push([{ type: 'text', text: '¡Hola, Marta! 😊' }]);
await silencio(async () => { await mandar(aviso([contacto('Marta Ríos', { user_id: BS_RECHAZO })], [msg('Buenas, ¿tienen habitación para este sábado?', { from_user_id: BS_RECHAZO })])); await esperar(() => enviosFallidosRecientes().length >= 1 && correos.length > correosAntes3); });
const fallo1 = enviosFallidosRecientes()[0], correoFallo = correos.at(-1);
ok('se anota el envío fallido (con el motivo de WhatsApp y el chat tapado, sin el identificador completo)', enviosFallidosRecientes().length === 1 && /131009/.test(fallo1.error) && fallo1.chat.startsWith('bs:') && !fallo1.chat.includes(BS_RECHAZO), JSON.stringify(fallo1));
ok('recepción recibe el correo con lo que escribió el cliente y el motivo', correos.length === correosAntes3 + 1 && /No se pudo contestar a un cliente de WhatsApp con nombre de usuario/.test(correoFallo.subject) && /131009/.test(correoFallo.html) && /para este sábado/.test(correoFallo.html) && /Marta Ríos/.test(correoFallo.html), JSON.stringify(correoFallo).slice(0, 300));
ok('lo que escribió queda en el chat y NO se anota una respuesta que no salió (sigue «sin contestar»)', store.obtener(`bs:${BS_RECHAZO}`)?.mensajes.length === 1 && store.obtener(`bs:${BS_RECHAZO}`).mensajes[0].autor === 'cliente');
guion.push([{ type: 'text', text: 'Seguimos 😊' }]);
await silencio(async () => { await mandar(aviso([contacto('Marta Ríos', { user_id: BS_RECHAZO })], [msg('¿Hola?', { from_user_id: BS_RECHAZO })])); await esperar(() => enviosFallidosRecientes().length >= 2); await espera(200); });
ok('un segundo fallo se anota pero no manda otro correo en 15 minutos', enviosFallidosRecientes().length === 2 && correos.length === correosAntes3 + 1);
graph.mensajes.length = 0; guion.push([{ type: 'text', text: 'Hola Ana 👋' }]);
await silencio(async () => { await mandar(aviso([contacto('Ana Gómez', { wa_id: '573001110001' })], [msg('Hola otra vez', { from: '573001110001' })])); await esperar(() => graph.mensajes.some((m) => m.to === '573001110001')); });
ok('los clientes con número no se ven afectados (se les sigue contestando)', graph.mensajes.some((m) => m.to === '573001110001' && /Hola Ana/.test(m.text.body)) && enviosFallidosRecientes().length === 2);
ok('el panel muestra los envíos fallidos', (await get('/admin/api/whatsapp/sin-numero')).envioFallido.length === 2);
graph.rechazarBsuid = false;

console.log('\n— Si luego escribe con su número, o al revés —');
graph.mensajes.length = 0; guion.push([{ type: 'text', text: 'Hola Luisa' }], [{ type: 'text', text: 'Seguimos, Luisa' }]);
await mandar(aviso([contacto('Luisa Mejía', { wa_id: '573001110002', user_id: 'CO.5550001' })], [msg('Hola', { from: '573001110002', from_user_id: 'CO.5550001' })]));
await esperar(() => graph.mensajes.some((m) => m.to === '573001110002'));
ok('con número y BSUID: el chat es el del número y guarda su BSUID', store.obtener('573001110002')?.bsuid === 'CO.5550001' && store.waIdDeBsuid('CO.5550001') === '573001110002');
const chatsAntes2 = store.listar().length;
graph.mensajes.length = 0;
await mandar(aviso([contacto('Luisa Mejía', { user_id: 'CO.5550001' })], [msg('¿Sigue disponible?', { from_user_id: 'CO.5550001' })]));
await esperar(() => graph.mensajes.some((m) => m.type === 'text'));
const respLuisa = graph.mensajes.find((m) => m.type === 'text');
ok('si después escribe SOLO con su BSUID, es el mismo chat y se le contesta a su número', respLuisa?.to === '573001110002' && respLuisa.recipient === undefined && store.obtener('bs:CO.5550001') === null && store.listar().length === chatsAntes2 && store.obtener('573001110002').mensajes.some((m) => m.texto === '¿Sigue disponible?'), JSON.stringify(graph.mensajes));
ok('un BSUID que no conocemos no se confunde con ese chat', store.waIdDeBsuid('CO.0000') === null && store.waIdDeBsuid('') === null && store.waIdDeBsuid(ID_PEDRO.slice(3)) === null);

console.log('\n— Reservar sin conocer su celular —');
graph.mensajes.length = 0; correos.length = 0;
const reserva = { tipoHabitacion: 'Habitación Estándar', checkIn: IN, checkOut: OUT, personas: 2 };
let rr = await silencio(() => ejecutarHerramienta(ID_PEDRO, 'reservar_pago_en_hotel', reserva));
ok('sin celular: no reserva y se lo pide (y no pide el nombre, que ya tiene)', rr.ok === false && /celular/i.test(rr.error) && !/nombre/i.test(rr.error) && reservasStore.vigentesDe(ID_PEDRO).length === 0, JSON.stringify(rr));
rr = await silencio(() => ejecutarHerramienta(ID_PEDRO, 'generar_link_pago', reserva));
ok('lo mismo para el pago en línea', rr.ok === false && /celular/i.test(rr.error));
rr = await silencio(() => ejecutarHerramienta(ID_PEDRO, 'reservar_pago_en_hotel', { ...reserva, celular: '12345' }));
ok('un celular inválido tampoco sirve', rr.ok === false && /celular/i.test(rr.error));
rr = await silencio(() => ejecutarHerramienta(ID_PEDRO, 'reservar_pago_en_hotel', { ...reserva, celular: '300 123 4567' }));
const res = reservasStore.vigentesDe(ID_PEDRO)[0];
ok('con el celular que da en el chat: reserva con su nombre de perfil y el celular con indicativo', rr.ok === true && res?.celular === '573001234567' && res?.nombre === 'Pedro Lara' && res?.waId === ID_PEDRO && res?.estado === 'pendiente_hotel', JSON.stringify(res));
await esperar(() => graph.mensajes.some((m) => m.recipient === BS_PEDRO) && correos.length >= 1);
ok('la confirmación le llega a su WhatsApp (a su BSUID) y recepción recibe el correo, marcado como WhatsApp con usuario', graph.mensajes.some((m) => m.recipient === BS_PEDRO && m.to === undefined && m.type === 'text') && correos.some((c) => /WhatsApp con nombre de usuario \(bot\)/.test(c.html) && /573001234567/.test(c.html)), JSON.stringify(graph.mensajes).slice(0, 300));
ok('el recordatorio de llegada se le escribe por ese mismo chat (o a su celular fuera de las 24 h)', destinoDe(res) === ID_PEDRO && destinoDe({ waId: '573001110001', celular: '573001110001' }) === '573001110001');

console.log('\n— Transferencia —');
await documentosStore.guardar('cert-davivienda', { nombre: 'Certificado Davivienda 2026.pdf', datos: pdf('davivienda') });
await documentosStore.guardar('cert-bancolombia', { nombre: 'Certificado Bancario Bancolombia.pdf', datos: pdf('bancolombia') });
const BS_LUIS = 'CO.7770002', ID_LUIS = `bs:${BS_LUIS}`;
store.registrarEntrante({ waId: ID_LUIS, nombre: 'Luis Herrera', tipo: 'text', texto: 'quiero transferir', bsuid: BS_LUIS });
graph.mensajes.length = 0;
rr = await silencio(() => ejecutarHerramienta(ID_LUIS, 'reservar_pago_transferencia', reserva));
ok('sin celular: no deja ninguna reserva ni manda los certificados', rr.ok === false && /celular/i.test(rr.error) && reservasStore.vigentesDe(ID_LUIS).length === 0 && graph.mensajes.length === 0, JSON.stringify(rr));
rr = await silencio(() => ejecutarHerramienta(ID_LUIS, 'reservar_pago_transferencia', { ...reserva, celular: '3109876543' }));
const resT = reservasStore.vigentesDe(ID_LUIS)[0];
ok('con celular: queda pendiente con ese celular y los certificados salen a su BSUID', rr.ok === true && resT?.celular === '573109876543' && resT?.waId === ID_LUIS && graph.mensajes.filter((m) => m.type === 'document' && m.recipient === BS_LUIS && m.to === undefined).length === 2, JSON.stringify(graph.mensajes).slice(0, 300));
rr = await silencio(() => ejecutarHerramienta('573001110001', 'reservar_pago_transferencia', reserva));
ok('un WhatsApp normal no cambia: el celular es su propio número, sin pedirlo', rr.ok === true && reservasStore.vigentesDe('573001110001')[0]?.celular === '573001110001', JSON.stringify(rr));

console.log('\n— Llamada, simulador y prompt —');
graph.mensajes.length = 0;
const rl = await silencio(() => atenderLlamada({ from: 'bs:CO.8880001', callId: '', nombre: 'Rosa' }));
ok('quien intenta llamar con nombre de usuario recibe el aviso en su BSUID', rl.ok === true && graph.mensajes.some((m) => m.recipient === 'CO.8880001' && /llamadas por WhatsApp/.test(m.text.body)), JSON.stringify([rl, graph.mensajes]));
const rl2 = await silencio(() => atenderLlamada({ from: '', callId: '', nombre: 'Nadie' }));
ok('una llamada sin número ni identificador no crea ningún chat', rl2.ok === false && store.obtener('') === null);
peticionesClaude.length = 0; guion.push([{ type: 'text', text: '¿Me confirmas tu celular?' }]);
const sim = await simularIA({ canal: 'whatsapp_usuario', nombre: 'Fabian', mensajes: [{ de: 'cliente', texto: 'pago al llegar' }] });
ok('el simulador del panel prueba también este caso (canal «whatsapp_usuario»)', sim.ok === true && /tiene activado un USUARIO de WhatsApp/.test(peticionesClaude.at(-1)?.system?.[0]?.text || '') && /Celular: NO lo tienes/.test(peticionesClaude.at(-1)?.system?.[1]?.text || ''), JSON.stringify(sim));
ok('el prompt de Instagram sigue pidiendo el celular y el de WhatsApp normal sigue confirmándolo', /pídelo junto con la forma de pago/.test(sistema('Instagram')) && /CONFÍRMALO/.test(sistema('')) && !/USUARIO de WhatsApp/.test(sistema('Instagram')) && /USUARIO de WhatsApp/.test(sistema('', { sinCelular: true })) && !/CONFÍRMALO/.test(sistema('', { sinCelular: true })));
ok('lo que Valentina sabe del cliente: sin número en WhatsApp con usuario, con número en WhatsApp normal', /NO lo tienes/.test(contextoCliente({ nombre: 'Pedro' }, ID_PEDRO)) && /\+57 300 1110001/.test(contextoCliente({ nombre: 'Ana' }, '573001110001')) && !/\+/.test(contextoCliente({ nombre: 'Pedro' }, ID_PEDRO)));

console.log('\n— Lo que había quedado guardado sin dueño —');
const antes = store.listar().length;
hidratarConversaciones({
  convRows: [{ wa_id: '573009990001', nombre: 'Luisa', bsuid: 'CO.777', modo: 'bot', creado: 1, ultima_actividad: 2 }, { wa_id: null, nombre: '' }],
  msgRows: [
    { wa_id: null, direccion: 'entrada', autor: 'cliente', tipo: 'text', texto: 'Hola quiero reservar ua habitación', ts: 5 },
    { wa_id: null, direccion: 'entrada', autor: 'cliente', tipo: 'text', texto: '¿Cuáles son las tarifas de habitación?', ts: 6 },
    { wa_id: '573009990001', direccion: 'entrada', autor: 'cliente', tipo: 'text', texto: 'hola', ts: 7 },
  ],
});
ok('al arrancar, los mensajes guardados sin id de chat NO forman un «chat fantasma»', store.obtener(null) === null && store.listar().every((c) => typeof c.waId === 'string' && c.waId) && store.listar().length === antes + 1);
ok('...pero no se pierden: quedan aparte para que se vean', mensajesSinDuenio().length === 2 && mensajesSinDuenio()[0].texto === 'Hola quiero reservar ua habitación' && (await get('/admin/api/whatsapp/sin-numero')).antiguos.total === 2);
ok('el BSUID guardado en la base de datos se recupera al arrancar', store.waIdDeBsuid('CO.777') === '573009990001' && store.obtener('573009990001').mensajes.length === 1);
let lanzo = 0;
for (const w of [undefined, null, '', 573001110001]) { try { store.registrarEntrante({ waId: w, nombre: 'x', tipo: 'text', texto: 'x' }); } catch { lanzo++; } }
ok('guardar un mensaje sin id de chat ya no es posible (falla en vez de crear un chat sin dueño)', lanzo === 4 && store.obtener(null) === null);

console.log('\n— Base de datos y panel (revisión del código) —');
const fuente = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const db = fuente('../src/almacen/db.js'), panel = fuente('../src/admin/panel.html');
ok('la base guarda y recupera el BSUID (columna nueva, que nunca se borra)', /ADD COLUMN IF NOT EXISTS bsuid TEXT/.test(db) && /ultima_actividad, bsuid\)/.test(db) && /COALESCE\(NULLIF\(EXCLUDED\.bsuid, ''\), conversaciones\.bsuid\)/.test(db));
ok('el panel muestra «WhatsApp (sin número)» y no un «+bs:...», y no precarga ese "celular" en confirmar reserva', /\/\^\(fb\|ig\|bs\):\//.test(panel) && /WhatsApp \(sin número\)/.test(panel) && /WhatsApp · sin número/.test(panel) && !/'\+' \+ c\.waId : ''/.test(panel));

console.log(fallos ? `\n❌ ${fallos} comprobación(es) fallaron.` : '\n✅ Todo bien: los clientes de WhatsApp con nombre de usuario ya se atienden.');
process.exit(fallos ? 1 : 0);
