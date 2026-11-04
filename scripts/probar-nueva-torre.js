// ============================================================
//  probar-nueva-torre.js — Prueba OFFLINE de la NUEVA TORRE (habitaciones Estándar inteligentes).
//
//  Valentina le pregunta al cliente (junto con celular y forma de pago) si quiere hospedarse en la nueva torre, con
//  habitación inteligente. Si dice que SÍ, la herramienta de reserva recibe `nuevaTorre: true` y:
//    · la reserva queda con un COMENTARIO («El cliente escogió la NUEVA TORRE con habitación inteligente para hospedarse.»);
//    · ese comentario llega en el correo a recepción (aviso destacado + «NUEVA TORRE» en el asunto);
//    · al cliente se le confirma por WhatsApp que quedó anotado (sin prometerle un número de habitación).
//  Solo con la Habitación Estándar y la Estándar Ubique.
//    node scripts/probar-nueva-torre.js
//  Usa un WhatsApp, un Claude, un Resend y un RAPYD FALSOS en local. No toca nada real.
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
// Un viernes (la Estándar Ubique solo se vende de viernes a domingo).
const viernes = (() => { for (let d = 21; d < 35; d++) { if (new Date(enHoy(d) + 'T12:00:00').getDay() === 5) return d; } return 21; })();
const VIE_IN = enHoy(viernes), VIE_OUT = enHoy(viernes + 1);
const pdf = (marca) => Buffer.from(`%PDF-1.4\n% ${marca}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`);
const BASE = `http://127.0.0.1:${puerto}`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* aun arrancando */ } await espera(100); }
const aRecepcion = () => correos.filter((c) => (c.to || []).includes?.('reservas@hotelmalibu.co') || c.to === 'reservas@hotelmalibu.co');
const aCliente = (email) => correos.filter((c) => c.to === email || (Array.isArray(c.to) && c.to.includes(email)));
const nuevo = (waId, nombre) => store.registrarEntrante({ waId, nombre, tipo: 'text', texto: 'Hola' });
const TORRE = COMENTARIO_NUEVA_TORRE;

console.log('— Las instrucciones de Valentina —');
for (const [canal, p] of [['WhatsApp', A.sistema('')], ['Instagram', A.sistema('Instagram')], ['WhatsApp con usuario', A.sistema('', { sinCelular: true })]]) {
  ok(`${canal}: al cerrar una Estándar le pregunta si quiere la nueva torre, junto con celular y forma de pago`, /NUEVA TORRE \(solo con la Habitación Estándar y la Estándar Ubique/.test(p) && /pregúntale también si quiere hospedarse en la NUEVA TORRE/.test(p) && /si quieres hospedarte en nuestra nueva torre \(habitación inteligente: aire y luces automatizados y comandos de voz\) y si pagas en línea o al llegar al hotel/.test(p));
  ok(`${canal}: si dice que sí usa nuevaTorre: true y se lo dice sin prometer habitación; si no, no insiste`, /llama la herramienta con nuevaTorre: true/.test(p) && /COMENTARIOS de la reserva/.test(p) && /sin prometerle un número de habitación/.test(p) && /NO insistas ni se lo repitas/.test(p));
  ok(`${canal}: no la ofrece con King, Triple, Suite de Lujo ni Twins, y la regla de «DOS cosas» sigue intacta para el resto`, /Con los otros tipos \(King, Triple, Suite de Lujo, Twins\) no se la ofrezcas ni pases nuevaTorre/.test(p) && /SOLO confirmas DOS cosas/.test(p) && /Solo confírmame tu celular y si pagas en línea o al llegar al hotel/.test(p));
}
const tools = (peticionesClaude.length ? peticionesClaude.at(-1) : (await silencio(() => A.simularIA({ canal: 'whatsapp', nombre: 'Ana', mensajes: [{ de: 'cliente', texto: 'hola' }] })), peticionesClaude.at(-1))).tools || [];
const conTorre = tools.filter((t) => t.input_schema?.properties?.nuevaTorre).map((t) => t.name).sort();
ok('las 3 herramientas que reservan reciben `nuevaTorre` (booleano); las demás no', JSON.stringify(conTorre) === JSON.stringify(['generar_link_pago', 'reservar_pago_en_hotel', 'reservar_pago_transferencia']) && tools.every((t) => !t.input_schema?.properties?.nuevaTorre || t.input_schema.properties.nuevaTorre.type === 'boolean'), JSON.stringify(conTorre));

console.log('\n— Ayudas —');
const est = TIPOS_HABITACION.find((t) => t.id === 'estandar'), ubi = TIPOS_HABITACION.find((t) => t.id === 'estandar_ubique'), king = TIPOS_HABITACION.find((t) => t.id === 'junior_king');
ok('solo la Estándar y la Estándar Ubique admiten la nueva torre', admiteNuevaTorre(est) && admiteNuevaTorre(ubi) && !admiteNuevaTorre(king) && !admiteNuevaTorre(TIPOS_HABITACION.find((t) => t.id === 'junior_twins')) && !admiteNuevaTorre(undefined));
ok('se reconoce por el comentario y da la frase para el cliente (solo si la pidió)', pidioNuevaTorre({ comentarios: TORRE }) && !pidioNuevaTorre({ comentarios: 'Llega tarde' }) && !pidioNuevaTorre({}) && /nueva torre, con habitación inteligente/.test(lineaNuevaTorre({ comentarios: TORRE })) && lineaNuevaTorre({}) === '');
ok('los comentarios se limpian: una línea, máximo 300 caracteres', limpiarComentarios('  hola\n\nmundo\t\u0007 ') === 'hola mundo' && limpiarComentarios('x'.repeat(500)).length === 300 && limpiarComentarios(undefined) === '' && limpiarComentarios(null) === '');

console.log('\n— Pago en el hotel + nueva torre —');
const ROSA = '573001110011';
nuevo(ROSA, 'Rosa Pérez');
const base = { tipoHabitacion: 'Habitación Estándar', checkIn: IN, checkOut: OUT, personas: 2, email: 'rosa@ejemplo.test' };
graph.mensajes.length = 0; correos.length = 0;
let r = await silencio(() => A.ejecutarHerramienta(ROSA, 'reservar_pago_en_hotel', { ...base, nuevaTorre: true }));
const rosa = reservasStore.vigentesDe(ROSA)[0];
ok('la reserva queda con el comentario de la nueva torre', r.ok === true && rosa?.comentarios === TORRE && rosa.estado === 'pendiente_hotel', JSON.stringify(r) + JSON.stringify(rosa));
ok('a Valentina se le dice que quedó anotado en los comentarios y le llega a recepción, sin prometer habitación', /COMENTARIOS de la reserva/.test(r.instruccion) && /llega al correo de recepción/.test(r.instruccion) && /sin prometerle un número de habitación/.test(r.instruccion));
const deRecepcionDe = (nombre) => aRecepcion().find((x) => x.html.includes(nombre));
await esperar(() => deRecepcionDe('Rosa Pérez') && aCliente('rosa@ejemplo.test').length >= 1);
const recep = deRecepcionDe('Rosa Pérez'), cli = aCliente('rosa@ejemplo.test')[0];
ok('el correo al hotel lleva el aviso destacado con el comentario y «NUEVA TORRE» en el asunto', /NUEVA TORRE/.test(recep.subject) && /COMENTARIOS DE LA RESERVA: El cliente escogió la NUEVA TORRE con habitación inteligente para hospedarse\./.test(recep.html), JSON.stringify(recep).slice(0, 400));
ok('el correo al cliente NO lleva el aviso interno', !/COMENTARIOS DE LA RESERVA/.test(cli.html) && !/NUEVA TORRE/.test(cli.subject));
await esperar(() => graph.mensajes.some((m) => m.to === ROSA && m.type === 'text'));
const wa = graph.mensajes.find((m) => m.to === ROSA && m.type === 'text');
ok('el WhatsApp de confirmación le dice que quedó anotado (sin prometer habitación)', /Dejamos anotado en tu reserva que quieres hospedarte en la nueva torre, con habitación inteligente; le llega a recepción\./.test(wa?.text?.body || '') && !/habitación (número|N°)/i.test(wa.text.body), JSON.stringify(wa));

console.log('\n— Sin nueva torre todo queda como antes —');
const LUIS = '573001110012';
nuevo(LUIS, 'Luis Vega');
graph.mensajes.length = 0; correos.length = 0;
r = await silencio(() => A.ejecutarHerramienta(LUIS, 'reservar_pago_en_hotel', { ...base, email: 'luis@ejemplo.test' }));
const luis = reservasStore.vigentesDe(LUIS)[0];
await esperar(() => deRecepcionDe('Luis Vega') && graph.mensajes.some((m) => m.to === LUIS && m.type === 'text'));
ok('si no la pidió: sin comentarios, sin etiqueta en el asunto, sin aviso en el correo ni línea en el WhatsApp', r.ok === true && luis.comentarios === '' && !/NUEVA TORRE|COMENTARIOS DE LA RESERVA/.test(deRecepcionDe('Luis Vega').subject + deRecepcionDe('Luis Vega').html) && !/nueva torre/i.test(graph.mensajes.find((m) => m.to === LUIS && m.type === 'text').text.body) && !/COMENTARIOS|nueva torre/i.test(r.instruccion));
const SOFI = '573001110013';
nuevo(SOFI, 'Sofía Mora');
r = await silencio(() => A.ejecutarHerramienta(SOFI, 'reservar_pago_en_hotel', { ...base, email: 'sofia@ejemplo.test', nuevaTorre: false }));
const r2 = await silencio(() => A.ejecutarHerramienta('573001110014', 'reservar_pago_en_hotel', { ...base, nombre: 'Tomás Gil', nuevaTorre: 'no' }));
ok('`nuevaTorre: false` (o cualquier cosa que no sea un sí explícito) no anota nada', r.ok === true && reservasStore.vigentesDe(SOFI)[0].comentarios === '' && r2.ok === true && reservasStore.vigentesDe('573001110014')[0].comentarios === '');
const TOMI = '573001110015';
nuevo(TOMI, 'Tomás Rey');
r = await silencio(() => A.ejecutarHerramienta(TOMI, 'reservar_pago_en_hotel', { ...base, email: 'tomi@ejemplo.test', nuevaTorre: 'true' }));
ok('un «true» escrito como texto también cuenta como sí', r.ok === true && reservasStore.vigentesDe(TOMI)[0].comentarios === TORRE);

console.log('\n— Estándar Ubique sí; los otros tipos no —');
const UBI = '573001110016';
nuevo(UBI, 'Úrsula Díaz');
r = await silencio(() => A.ejecutarHerramienta(UBI, 'reservar_pago_en_hotel', { ...base, tipoHabitacion: 'Habitación Estándar Ubique', checkIn: VIE_IN, checkOut: VIE_OUT, email: 'ursula@ejemplo.test', nuevaTorre: true }));
ok('la Estándar Ubique (fin de semana) también la admite', r.ok === true && reservasStore.vigentesDe(UBI)[0]?.comentarios === TORRE, JSON.stringify(r));
const KING = '573001110017';
nuevo(KING, 'Karen Ríos');
r = await silencio(() => A.ejecutarHerramienta(KING, 'reservar_pago_en_hotel', { ...base, tipoHabitacion: 'Junior Suite King', email: 'karen@ejemplo.test', nuevaTorre: true }));
ok('con Junior Suite King NO la admite: no crea la reserva y le dice a Valentina que ofrezca la Estándar', r.ok === false && /solo con la Habitación Estándar y la Estándar Ubique/.test(r.error) && /Junior Suite King/.test(r.error) && reservasStore.vigentesDe(KING).length === 0, JSON.stringify(r));
r = await silencio(() => A.ejecutarHerramienta(KING, 'generar_link_pago', { ...base, tipoHabitacion: 'Suite de Lujo', nuevaTorre: true }));
ok('...ni con la Suite de Lujo en el pago en línea', r.ok === false && /Suite de Lujo/.test(r.error) && reservasStore.vigentesDe(KING).length === 0);

console.log('\n— Pago en línea + nueva torre —');
const ANA = '573001110018';
nuevo(ANA, 'Ana Gómez');
correos.length = 0;
r = await silencio(() => A.ejecutarHerramienta(ANA, 'generar_link_pago', { ...base, email: 'ana@ejemplo.test', nuevaTorre: true }));
const ana = reservasStore.vigentesDe(ANA)[0];
ok('el link se genera y la reserva en proceso ya lleva el comentario', r.ok === true && ana?.estado === 'en_proceso' && ana.comentarios === TORRE && /COMENTARIOS de la reserva/.test(r.instruccion), JSON.stringify(r));
await silencio(() => confirmarPago(ana)); // el pago se aprueba (lo hace el webhook de RAPYD)
await esperar(() => deRecepcionDe('Ana Gómez'));
const correoAna = deRecepcionDe('Ana Gómez');
ok('al aprobarse el pago, el correo al hotel trae el comentario y la etiqueta', reservasStore.obtenerPorId(ana.id).estado === 'pagado' && /NUEVA TORRE/.test(correoAna.subject) && /COMENTARIOS DE LA RESERVA: El cliente escogió la NUEVA TORRE/.test(correoAna.html), JSON.stringify(correoAna).slice(0, 300));

console.log('\n— Transferencia + nueva torre —');
await documentosStore.guardar('cert-davivienda', { nombre: 'Certificado Davivienda 2026.pdf', datos: pdf('davivienda') });
await documentosStore.guardar('cert-bancolombia', { nombre: 'Certificado Bancario Bancolombia.pdf', datos: pdf('bancolombia') });
const TERE = '573001110019';
nuevo(TERE, 'Teresa Cano');
r = await silencio(() => A.ejecutarHerramienta(TERE, 'reservar_pago_transferencia', { ...base, email: 'tere@ejemplo.test', nuevaTorre: true }));
const tere = reservasStore.vigentesDe(TERE)[0];
ok('la reserva pendiente de transferencia lleva el comentario', r.ok === true && tere?.estado === 'en_proceso' && tere.comentarios === TORRE && /COMENTARIOS de la reserva/.test(r.instruccion), JSON.stringify(r));
correos.length = 0;
await silencio(() => enviarComprobanteTransferencia(tere, { nombre: 'comprobante.pdf', datos: Buffer.from('%PDF-1.4 x'), bytes: 10 }, { numero: 1 }));
await esperar(() => correos.some((x) => /Soporte de pago por transferencia/.test(x.subject)));
const correoTere = correos.find((x) => /Soporte de pago por transferencia/.test(x.subject));
ok('el correo del comprobante a recepción también trae el aviso y la etiqueta', /NUEVA TORRE/.test(correoTere.subject) && /COMENTARIOS DE LA RESERVA: El cliente escogió la NUEVA TORRE/.test(correoTere.html), JSON.stringify(correoTere).slice(0, 300));
// Reservó con pago en el hotel SIN la torre y luego pasa a transferencia y SÍ la quiere: misma reserva, comentario agregado.
const PACO = '573001110020';
nuevo(PACO, 'Paco Ruiz');
await silencio(() => A.ejecutarHerramienta(PACO, 'reservar_pago_en_hotel', { ...base, email: 'paco@ejemplo.test' }));
const antes = reservasStore.listar().length;
r = await silencio(() => A.ejecutarHerramienta(PACO, 'reservar_pago_transferencia', { ...base, email: 'paco@ejemplo.test', nuevaTorre: true }));
const paco = reservasStore.vigentesDe(PACO);
ok('si ya tenía la reserva y ahora la escoge, se reutiliza (no se duplica) y se le agrega el comentario', r.ok === true && paco.length === 1 && reservasStore.listar().length === antes && paco[0].comentarios === TORRE, JSON.stringify(paco));
await silencio(() => A.ejecutarHerramienta(PACO, 'reservar_pago_transferencia', { ...base, email: 'paco@ejemplo.test', nuevaTorre: true }));
ok('...y si lo pide otra vez no se repite el comentario', reservasStore.vigentesDe(PACO)[0].comentarios === TORRE);

console.log('\n— El texto del comentario se escapa en el correo —');
const veneno = reservasStore.crear({ waId: '573001110021', celular: '573001110021', nombre: 'Prueba', habitacion: 'Habitación Estándar', checkIn: IN, checkOut: OUT, estado: 'pendiente_hotel', fuente: 'humano', comentarios: '<img src=x onerror=alert(1)> llega tarde' });
correos.length = 0;
const { confirmarReservaPorCorreo } = await import('../src/correo/enviar.js');
await silencio(() => confirmarReservaPorCorreo(veneno));
await esperar(() => correos.some((x) => x.html.includes('llega tarde')));
const correoVeneno = correos.find((x) => x.html.includes('llega tarde'));
ok('un comentario con HTML sale como texto (no se ejecuta) y no marca «NUEVA TORRE»', !/<img src=x/.test(correoVeneno.html) && /&lt;img src=x onerror=alert\(1\)&gt; llega tarde/.test(correoVeneno.html) && !/NUEVA TORRE/.test(correoVeneno.subject), correoVeneno.html.slice(0, 300));

console.log('\n— El panel —');
const login = await fetch(`${BASE}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'recepcion', clave: 'clave-de-prueba' }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const api = (ruta, cuerpo) => fetch(`${BASE}/admin/api${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then(async (x) => ({ status: x.status, ...(await x.json()) }));
ok('el panel abre con la clave de prueba', login.status === 200 && cookie.startsWith('malibu_ses='));
const lista = (await api('/reservas')).reservas;
ok('la lista de reservas trae los comentarios', lista.find((x) => x.id === rosa.id)?.comentarios === TORRE && lista.find((x) => x.id === luis.id)?.comentarios === '');
let c = await api('/reservas', { nombre: 'Marta Ríos', celular: '+57 300 555 1212', habitacion: 'Habitación Estándar', checkIn: IN, checkOut: OUT, estado: 'pagado', comentarios: ' Escogió la nueva torre\ncon habitación inteligente ' });
ok('recepción puede crear una reserva con comentarios (se limpian a una línea)', c.ok === true && c.reserva.comentarios === 'Escogió la nueva torre con habitación inteligente', JSON.stringify(c));
let m = await api(`/reservas/${rosa.id}/modificar`, { comentarios: `${TORRE} Habitación TB-204.` });
ok('...y editar los comentarios de una reserva (sin tocar cantidad ni personas)', m.ok === true && m.reserva.comentarios === `${TORRE} Habitación TB-204.` && m.reserva.cantidad === 1, JSON.stringify(m));
m = await api(`/reservas/${rosa.id}/modificar`, { cantidad: 2 });
ok('modificar solo la cantidad NO borra los comentarios', m.ok === true && m.reserva.comentarios.includes('TB-204') && m.reserva.cantidad === 2);
m = await api(`/reservas/${rosa.id}/modificar`, { comentarios: '' });
ok('un texto vacío los borra', m.ok === true && m.reserva.comentarios === '');
m = await api(`/reservas/${rosa.id}/modificar`, { comentarios: { x: 1 } });
ok('si no son un texto, se rechaza', m.status === 400 && /texto/.test(m.error));
const chat = '573001110022';
nuevo(chat, 'Lucía Pardo');
c = await api(`/conversaciones/${chat}/confirmar-reserva`, { nombre: 'Lucía Pardo', celular: '+57 300 111 2222', checkIn: IN, checkOut: OUT, habitacion: 'Habitación Estándar', comentarios: 'Quiere la nueva torre' });
ok('al confirmar una reserva desde el chat también se pueden anotar comentarios', c.ok === true && c.reserva.comentarios === 'Quiere la nueva torre', JSON.stringify(c).slice(0, 300));

console.log('\n— Base de datos y panel (revisión del código) —');
const fuente = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const db = fuente('../src/almacen/db.js'), panel = fuente('../src/admin/panel.html');
ok('la base guarda los comentarios (columna nueva, en el alta y en la actualización)', /ALTER TABLE reservas ADD COLUMN IF NOT EXISTS comentarios TEXT/.test(db) && /cantidad, comentarios\)/.test(db) && /\$17,\$18\)/.test(db) && /comentarios = EXCLUDED\.comentarios/.test(db) && /r\.cantidad \|\| 1, r\.comentarios \|\| ''/.test(db));
ok('el panel muestra los comentarios (etiqueta dorada), permite escribirlos al crear y editarlos al modificar', /\.tag-torre/.test(panel) && /id="rComentarios"/.test(panel) && /comentarios: document\.getElementById\('rComentarios'\)/.test(panel) && /reservasCache/.test(panel) && /Comentarios de la reserva \(llegan en el correo a recepción/.test(panel));
hidratarReservas([{ id: 900, wa_id: '573009990009', celular: '573009990009', nombre: 'Rehidratada', habitacion: 'Habitación Estándar', check_in: IN, check_out: OUT, estado: 'pendiente_hotel', fuente: 'bot', creado: Date.now(), comentarios: TORRE }]);
ok('al arrancar se recuperan de la base de datos', reservasStore.obtenerPorId(900)?.comentarios === TORRE);

console.log(fallos ? `\n❌ ${fallos} comprobación(es) fallaron.` : '\n✅ Todo bien: la nueva torre llega hasta el correo del hotel.');
process.exit(fallos ? 1 : 0);
