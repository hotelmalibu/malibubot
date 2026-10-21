// ============================================================
//  probar-webhook-respaldo.js — Prueba de PUNTA A PUNTA de lo que vive un cliente cuando Valentina (la IA) no puede:
//  arranca el servidor real con un WhatsApp, un Claude y un Resend FALSOS y manda mensajes al webhook como lo haria Meta.
//    node scripts/probar-webhook-respaldo.js
//  No toca Meta, Anthropic, Resend ni produccion.
// ============================================================
import http from 'http';
import net from 'net';

const servidor = (manejador) => new Promise((ok) => {
  const s = http.createServer((req, res) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => manejador(req, res, Buffer.concat(partes)));
  });
  s.listen(0, () => ok(s));
});

const whatsapp = []; // lo que el bot le manda a los clientes
const graphSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && /\/123\/messages$/.test(req.url)) {
    const m = JSON.parse(cuerpo.toString() || '{}');
    if (m.type === 'text') whatsapp.push({ para: m.to, texto: m.text.body });
    return res.end('{"messages":[{"id":"wamid.X"}]}');
  }
  res.end('{}');
});

let modoClaude = 'credito';
const peticionesClaude = [];
const claudeSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    peticionesClaude.push(JSON.parse(cuerpo.toString() || '{}'));
    if (modoClaude === 'credito') { res.statusCode = 400; return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } })); }
    return res.end(JSON.stringify({ id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-falso', content: [{ type: 'text', text: '¡Hola! 😊 Con gusto te ayudo con tu reserva.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }));
  }
  res.statusCode = 404; res.end('{}');
});

const correos = [];
const resendSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/emails') { correos.push(JSON.parse(cuerpo.toString() || '{}')); return res.end(JSON.stringify({ id: `em_${correos.length}` })); }
  res.statusCode = 404; res.end('{}');
});

const puerto = await new Promise((ok) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
Object.assign(process.env, {
  PORT: String(puerto), ADMIN_PASSWORD: 'clave-de-prueba', WHATSAPP_TOKEN: 'token-de-prueba', WHATSAPP_PHONE_NUMBER_ID: '123',
  GRAPH_API_BASE: `http://127.0.0.1:${graphSrv.address().port}`,
  RESEND_API_KEY: 're_prueba', RESEND_API_BASE: `http://127.0.0.1:${resendSrv.address().port}`, CORREO_RECEPCION: 'reservas@hotelmalibu.co', PUBLIC_URL: 'https://bot.ejemplo.test',
  ANTHROPIC_API_KEY: 'sk-falsa-de-prueba', ANTHROPIC_BASE_URL: `http://127.0.0.1:${claudeSrv.address().port}`, IA_REINTENTOS: '0',
});
for (const k of ['DATABASE_URL', 'WHATSAPP_APP_SECRET', 'META_APP_SECRET', 'META_IG_APP_SECRET', 'CORREO_COPIA', 'CORREO_ALERTAS', 'IA_ALERTAS', 'ADMIN_TOTP_SECRET', 'ADMIN_USUARIO', 'VIK_SYNC_URL']) delete process.env[k];

await import('../src/index.js'); // arranca el servidor real en `puerto`
const { store } = await import('../src/almacen/conversaciones.js');

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperar(cond, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await espera(40); } return cond(); }
const BASE = `http://127.0.0.1:${puerto}`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* aun arrancando */ } await espera(100); }

const post = (ruta, cuerpo, cookie) => fetch(`${BASE}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(cuerpo) });
let idMsg = 0;
const escribe = (from, nombre, texto) => post('/webhook/whatsapp', { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ profile: { name: nombre } }], messages: [{ from, id: `wamid.t${++idMsg}`, type: 'text', text: { body: texto } }] } }] } ] });
const aTexto = (para) => whatsapp.filter((m) => m.para === para).map((m) => m.texto);

const login = await post('/admin/login', { usuario: 'recepcion', clave: 'clave-de-prueba' });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const get = (ruta) => fetch(`${BASE}${ruta}`, { headers: { Cookie: cookie } }).then((r) => r.json());
ok('el panel abre con la clave de prueba', login.status === 200 && cookie.startsWith('malibu_ses='));

const BERNARDO = '573001110001', MARYIN = '573001110002';

console.log('\n— La IA no puede (sin saldo) —');
ok('el webhook responde 200 de inmediato', (await escribe(BERNARDO, 'Bernardo  parra si', '¿Cuánto cuesta?')).status === 200);
await esperar(() => aTexto(BERNARDO).length >= 1);
ok('el cliente recibe UN mensaje de espera con su nombre', aTexto(BERNARDO).length === 1 && /^Hola Bernardo 👋 Gracias por escribir al Hotel Malibú\. En un momento te atendemos\./.test(aTexto(BERNARDO)[0]), JSON.stringify(aTexto(BERNARDO)));
await escribe(BERNARDO, 'Bernardo  parra si', 'del 20 al 22 de noviembre, 2 personas');
await escribe(BERNARDO, 'Bernardo  parra si', 'me llamo Bernardo Parra');
await espera(700);
ok('sus siguientes mensajes NO reciben otra vez lo mismo', aTexto(BERNARDO).length === 1, JSON.stringify(aTexto(BERNARDO)));
ok('...pero la IA sí se intentó con cada uno (por si ya se arregló)', peticionesClaude.length === 3, `${peticionesClaude.length} intentos`);
ok('otro cliente (otro chat) sí recibe su propio mensaje', (await escribe(MARYIN, 'Maryin Martinez', 'Buenas')).status === 200 && await esperar(() => aTexto(MARYIN).length >= 1) && /^Hola Maryin 👋/.test(aTexto(MARYIN)[0]));

console.log('\n— Lo que ve recepción —');
await esperar(() => correos.length >= 1);
ok('llegó UN correo a recepción explicando que se acabó el saldo', correos.length === 1 && /Valentina no puede responder/.test(correos[0].subject) && /se acabó el saldo/i.test(correos[0].html) && correos[0].to.includes('reservas@hotelmalibu.co'), `${correos.length}`);
const lista = (await get('/admin/api/conversaciones')).conversaciones;
const b = lista.find((c) => c.waId === BERNARDO), m = lista.find((c) => c.waId === MARYIN);
ok('en Conversaciones los dos chats salen «sin respuesta» y «necesitan atención»', b?.sinRespuestaIA === true && b?.necesitaAtencion === true && m?.sinRespuestaIA === true && m?.necesitaAtencion === true, JSON.stringify([b, m]));
let est = await get('/admin/api/ia/estado');
ok('el estado de la IA (franja roja) dice la causa, los pasos y cuántos esperan', est.caida === true && est.explicacion?.clave === 'saldo' && est.explicacion.pasos.length >= 2 && est.sinRespuesta === 2 && est.seguidos === 4, JSON.stringify(est).slice(0, 300));
ok('el id de la conversación no aparece completo en los errores recientes', est.recientes.every((r) => /•/.test(r.chat) && !r.chat.includes(BERNARDO)), JSON.stringify(est.recientes[0]));
ok('el panel sin sesión no puede ver el estado de la IA', (await fetch(`${BASE}/admin/api/ia/estado`, { redirect: 'manual' })).status !== 200);

console.log('\n— Recargan el saldo —');
modoClaude = 'ok';
const prueba = await (await post('/admin/api/ia/diag', {}, cookie)).json();
ok('«Probar conexión» sale bien y la franja se apaga', prueba.ok === true && (await get('/admin/api/ia/estado')).caida === false, JSON.stringify(prueba).slice(0, 300));
await esperar(() => correos.length >= 2);
ok('llega el correo «ya responde de nuevo»', correos.length === 2 && /ya responde de nuevo/.test(correos[1].subject));
await escribe(BERNARDO, 'Bernardo  parra si', 'hola de nuevo');
await esperar(() => aTexto(BERNARDO).length >= 2);
ok('Bernardo recibe respuesta REAL de Valentina', /Con gusto te ayudo/.test(aTexto(BERNARDO)[1] || ''), JSON.stringify(aTexto(BERNARDO)));
const ultimaPeticion = JSON.stringify(peticionesClaude.at(-1).messages).toLowerCase();
ok('...y Claude no vio el mensaje de espera (no lo imita)', !ultimaPeticion.includes('en un momento te atendemos') && ultimaPeticion.includes('cuánto cuesta') && ultimaPeticion.includes('hola de nuevo'), ultimaPeticion);
const lista2 = (await get('/admin/api/conversaciones')).conversaciones;
ok('su chat deja de estar «sin respuesta» (el de Maryin sigue esperando)', lista2.find((c) => c.waId === BERNARDO)?.sinRespuestaIA === false && lista2.find((c) => c.waId === MARYIN)?.sinRespuestaIA === true);

console.log('\n— Una persona toma el chat —');
store.registrarSaliente({ waId: MARYIN, autor: 'humano', texto: 'Hola Maryin, soy Laura de recepción.' });
ok('al contestar una persona, el chat de Maryin sale de «sin respuesta»', (await get('/admin/api/conversaciones')).conversaciones.find((c) => c.waId === MARYIN)?.sinRespuestaIA === false);

console.log(fallos === 0 ? '\n🎉 Todas las verificaciones pasaron.' : `\n💥 ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
