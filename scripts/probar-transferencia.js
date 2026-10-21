// ============================================================
//  probar-transferencia.js — Prueba OFFLINE del pago por TRANSFERENCIA.
//  Levanta una Graph API (WhatsApp) y un Resend FALSOS en local, arranca el servidor real
//  y recorre el flujo completo: certificados -> comprobante -> correo a recepcion -> verificacion.
//    node scripts/probar-transferencia.js
//  No toca produccion: sin base de datos, sin WhatsApp ni correo reales.
// ============================================================
import http from 'http';
import net from 'net';

// ---- servidores falsos ----
const graph = { mensajes: [], subidas: [], consultas: [], descargas: [] };
const resend = { correos: [] };
const archivosCliente = new Map(); // media id del cliente -> { mime, bytes }
let resendFalla = false;

const servidor = (manejador) => new Promise((ok) => {
  const s = http.createServer((req, res) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => manejador(req, res, Buffer.concat(partes)));
  });
  s.listen(0, () => ok(s));
});

const graphSrv = await servidor((req, res, cuerpo) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && /\/123\/media$/.test(url.pathname)) {
    const texto = cuerpo.toString('latin1');
    graph.subidas.push({ bytes: cuerpo.length, tienePDF: texto.includes('%PDF-'), nombre: (texto.match(/filename="([^"]+)"/) || [])[1], tipo: (texto.match(/name="type"\r\n\r\n([^\r]+)/) || [])[1], auth: req.headers.authorization });
    return res.end(JSON.stringify({ id: `MEDIA-${graph.subidas.length}` }));
  }
  if (req.method === 'POST' && /\/123\/messages$/.test(url.pathname)) {
    graph.mensajes.push(JSON.parse(cuerpo.toString() || '{}'));
    return res.end('{"messages":[{"id":"wamid.X"}]}');
  }
  if (req.method === 'GET' && url.pathname.startsWith('/dl/')) {
    const id = decodeURIComponent(url.pathname.slice(4));
    const a = archivosCliente.get(id);
    graph.descargas.push({ id, auth: req.headers.authorization });
    if (!a) { res.statusCode = 404; return res.end('{}'); }
    res.setHeader('Content-Type', a.mime);
    return res.end(a.bytes);
  }
  const m = url.pathname.match(/^\/v21\.0\/([^/]+)$/);
  if (req.method === 'GET' && m && archivosCliente.has(decodeURIComponent(m[1]))) {
    const id = decodeURIComponent(m[1]);
    const a = archivosCliente.get(id);
    graph.consultas.push({ id, auth: req.headers.authorization });
    return res.end(JSON.stringify({ id, url: `http://127.0.0.1:${graphSrv.address().port}/dl/${encodeURIComponent(id)}`, mime_type: a.mime, file_size: a.bytes.length }));
  }
  res.statusCode = 404;
  res.end('{"error":{"message":"no existe"}}');
});

const resendSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/emails') {
    if (resendFalla) { res.statusCode = 500; return res.end('{"message":"fallo simulado"}'); }
    resend.correos.push(JSON.parse(cuerpo.toString() || '{}'));
    return res.end(JSON.stringify({ id: `email-${resend.correos.length}` }));
  }
  res.statusCode = 404;
  res.end('{}');
});

// Claude FALSO: guarda lo que recibe y contesta con un guion (para revisar el prompt real y la herramienta en accion).
const claude = { peticiones: [], guion: [] };
const claudeSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    claude.peticiones.push(JSON.parse(cuerpo.toString() || '{}'));
    const salida = claude.guion.shift() || [{ type: 'text', text: 'ok' }];
    const usa = salida.some((b) => b.type === 'tool_use');
    return res.end(JSON.stringify({ id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-falso', content: salida, stop_reason: usa ? 'tool_use' : 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }));
  }
  res.statusCode = 404; res.end('{}');
});

// puerto libre para el servidor real
const puerto = await new Promise((ok) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

// ---- entorno ANTES de importar los modulos (config lee el entorno al cargar) ----
Object.assign(process.env, {
  PORT: String(puerto),
  ADMIN_PASSWORD: 'clave-de-prueba',
  WHATSAPP_TOKEN: 'token-de-prueba',
  WHATSAPP_PHONE_NUMBER_ID: '123',
  GRAPH_API_BASE: `http://127.0.0.1:${graphSrv.address().port}`,
  RESEND_API_KEY: 're_prueba',
  RESEND_API_BASE: `http://127.0.0.1:${resendSrv.address().port}`,
  CORREO_RECEPCION: 'reservas@hotelmalibu.co',
  PUBLIC_URL: 'https://bot.ejemplo.test',
  ANTHROPIC_API_KEY: 'sk-falsa-de-prueba',
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${claudeSrv.address().port}`,
});
for (const k of ['DATABASE_URL', 'WHATSAPP_APP_SECRET', 'META_APP_SECRET', 'META_IG_APP_SECRET', 'CORREO_COPIA', 'TRANSFERENCIA_DATOS', 'TRANSFERENCIA_ACTIVA', 'ADMIN_TOTP_SECRET', 'ADMIN_USUARIO', 'VIK_SYNC_URL']) delete process.env[k];

await import('../src/index.js'); // arranca el servidor real en `puerto`
const { ejecutarHerramienta, responderIA } = await import('../src/ia/agente.js');
const { reservasStore } = await import('../src/almacen/reservas.js');
const { store } = await import('../src/almacen/conversaciones.js');
const { documentosStore } = await import('../src/datos/documentos.js');
const { esTransferencia, REF_ESPERA } = await import('../src/pagos/transferencia.js');
const { mensajeSeguimiento } = await import('../src/ia/seguimiento.js');

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperar(cond, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await espera(40); } return cond(); }

const BASE = `http://127.0.0.1:${puerto}`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* aun arrancando */ } await espera(100); }

// /health indica la version desplegada (en Render viene de RENDER_GIT_COMMIT)
const sinCommit = await (await fetch(`${BASE}/health`)).json();
process.env.RENDER_GIT_COMMIT = 'abcdef1234567890';
const conCommit = await (await fetch(`${BASE}/health`)).json();
delete process.env.RENDER_GIT_COMMIT;
ok('/health responde ok y, en Render, dice qué versión está desplegada', sinCommit.ok === true && sinCommit.commit === undefined && conCommit.commit === 'abcdef1', JSON.stringify([sinCommit, conCommit]));

// ---- ayudas ----
const pdf = (marca) => Buffer.from(`%PDF-1.4\n% ${marca}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const enHoy = (dias) => { const d = new Date(Date.now() + dias * 864e5); return d.toISOString().slice(0, 10); };
const IN = enHoy(20), OUT = enHoy(22);
const CLIENTE = '573001112233';
const reserva = { tipoHabitacion: 'Habitación Estándar', checkIn: IN, checkOut: OUT, personas: 2, nombre: 'Ana María Pérez', email: 'ana@correo.co' };

const post = (ruta, cuerpo, cookie) => fetch(`${BASE}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(cuerpo) });
const webhook = (msg, nombre = 'Ana') => post('/webhook/whatsapp', { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ profile: { name: nombre } }], messages: [msg] } }] }] });
const imagen = (from, id, mime = 'image/png', caption = '') => ({ from, id: `wamid.${id}`, type: 'image', image: { id: `IMG-${id}`, mime_type: mime, sha256: 'x', ...(caption ? { caption } : {}) } });
const documento = (from, id, mime, filename) => ({ from, id: `wamid.${id}`, type: 'document', document: { id: `DOC-${id}`, mime_type: mime, filename } });
const textos = () => graph.mensajes.filter((m) => m.type === 'text').map((m) => m.text.body);
const documentosEnviados = () => graph.mensajes.filter((m) => m.type === 'document');

// ============================================================
console.log('— Certificados (almacén de documentos) —');
await documentosStore.guardar('cert-davivienda', { nombre: 'Certificado Davivienda 2026.pdf', datos: pdf('davivienda') });
ok('guarda un PDF válido', documentosStore.listar().find((d) => d.clave === 'cert-davivienda')?.cargado === true);
const rechazos = [];
for (const [clave, datos] of [['cert-davivienda', Buffer.from('no soy un pdf')], ['cert-davivienda', Buffer.alloc(0)], ['cert-davivienda', Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(4 * 1024 * 1024)])], ['inventada', pdf('x')]]) {
  try { await documentosStore.guardar(clave, { nombre: 'x.pdf', datos }); rechazos.push(false); } catch (e) { rechazos.push(!!e.deUso); }
}
ok('rechaza lo que no es PDF, lo vacío, lo muy pesado y claves inventadas', rechazos.every(Boolean), JSON.stringify(rechazos));
ok('el PDF original sigue intacto tras los rechazos', documentosStore.obtener('cert-davivienda').datos.toString().includes('davivienda'));
await documentosStore.eliminar('cert-davivienda');
ok('se puede quitar un certificado', documentosStore.listar().find((d) => d.clave === 'cert-davivienda')?.cargado === false);

// ============================================================
console.log('\n— Herramienta reservar_pago_transferencia —');
let r = await ejecutarHerramienta(CLIENTE, 'reservar_pago_transferencia', reserva);
ok('sin certificados cargados no promete nada y marca el chat para recepción', r.ok === false && /todavía no están cargados/.test(r.error) && store.obtener(CLIENTE)?.escalado === true);
ok('y no deja ninguna reserva creada', reservasStore.vigentesDe(CLIENTE).length === 0 && graph.mensajes.length === 0);
store.establecerModo(CLIENTE, 'bot'); // vuelve a modo bot (la escalada lo había pasado a recepción)

await documentosStore.guardar('cert-davivienda', { nombre: 'Certificado Davivienda 2026.pdf', datos: pdf('davivienda') });
await documentosStore.guardar('cert-bancolombia', { nombre: 'Certificado Bancario Bancolombia.pdf', datos: pdf('bancolombia') });

r = await ejecutarHerramienta('fb:98765', 'reservar_pago_transferencia', reserva);
ok('por Messenger/Instagram no aplica y remite al WhatsApp del hotel', r.ok === false && /WhatsApp/.test(r.error) && /573002299991/.test(r.error));
r = await ejecutarHerramienta(CLIENTE, 'reservar_pago_transferencia', { ...reserva, tipoHabitacion: 'Inventada' });
ok('tipo de habitación desconocido se rechaza', r.ok === false);
r = await ejecutarHerramienta(CLIENTE, 'reservar_pago_transferencia', { ...reserva, tipoHabitacion: 'Junior Suite Twins' });
ok('mantiene los candados de la promoción (Twins solo 15-dic a 6-ene)', r.ok === false && /promoci/i.test(r.error));
ok('nada se envió en los rechazos', graph.mensajes.length === 0 && graph.subidas.length === 0);

r = await ejecutarHerramienta(CLIENTE, 'reservar_pago_transferencia', reserva);
ok('con certificados: ok, 2 certificados enviados', r.ok === true && r.certificadosEnviados.join() === 'Davivienda,Bancolombia', JSON.stringify(r));
ok('sube cada PDF a WhatsApp con su token y su tipo', graph.subidas.length === 2 && graph.subidas.every((s) => s.tienePDF && s.tipo === 'application/pdf' && s.auth === 'Bearer token-de-prueba'));
const docs = documentosEnviados();
ok('envía dos mensajes de documento al cliente con su leyenda y nombre', docs.length === 2 && docs.every((d) => d.to === CLIENTE && /^MEDIA-/.test(d.document.id)) && /Davivienda/.test(docs[0].document.caption) && /Bancolombia/.test(docs[1].document.caption) && /\.pdf$/i.test(docs[0].document.filename), JSON.stringify(docs));
let reservaT = reservasStore.vigentesDe(CLIENTE)[0];
ok('deja la reserva EN PROCESO (no confirmada) marcada como transferencia', reservaT && reservaT.estado === 'en_proceso' && esTransferencia(reservaT) && reservaT.referenciaPago === REF_ESPERA && reservaT.monto === 618000 && reservaT.fuente === 'bot', JSON.stringify(reservaT));
ok('la instrucción al asistente prohíbe confirmar y dar datos bancarios', /PENDIENTE/.test(r.instruccion) && /NO digas que la reserva está confirmada/.test(r.instruccion) && /NO inventes números de cuenta/.test(r.instruccion));
ok('el historial del panel registra los envíos', (store.obtener(CLIENTE)?.mensajes || []).filter((m) => /📎/.test(m.texto)).length === 2);

r = await ejecutarHerramienta(CLIENTE, 'reservar_pago_transferencia', reserva);
ok('si pide los datos otra vez los reenvía SIN duplicar la reserva', r.ok === true && reservasStore.vigentesDe(CLIENTE).length === 1 && documentosEnviados().length === 4);

// ============================================================
console.log('\n— Comprobante del cliente (webhook) —');
archivosCliente.set('IMG-c1', { mime: 'image/png', bytes: PNG });
const correosAntes = resend.correos.length;
const resp = await webhook(imagen(CLIENTE, 'c1', 'image/png', 'Listo, ya transferí el 50%'));
ok('el webhook responde 200 de inmediato', resp.status === 200);
ok('reenvía el comprobante por correo a recepción', await esperar(() => resend.correos.length === correosAntes + 1), `correos: ${resend.correos.length}`);
const correo = resend.correos.at(-1) || {};
ok('descargó el archivo de WhatsApp con el token', graph.consultas.some((c) => c.id === 'IMG-c1' && c.auth === 'Bearer token-de-prueba') && graph.descargas.some((c) => c.id === 'IMG-c1' && c.auth === 'Bearer token-de-prueba'));
ok('va a reservas@hotelmalibu.co con asunto claro y el canal', correo.to?.includes('reservas@hotelmalibu.co') && /Soporte de pago por transferencia/.test(correo.subject) && /Ana María Pérez/.test(correo.subject) && /WhatsApp \(bot\)/.test(correo.subject), correo.subject);
ok('adjunta EXACTAMENTE el archivo del cliente (base64)', correo.attachments?.length === 1 && Buffer.from(correo.attachments[0].content, 'base64').equals(PNG) && /\.png$/.test(correo.attachments[0].filename), JSON.stringify(correo.attachments?.map((a) => a.filename)));
ok('el correo trae los datos de la reserva y el valor total', /Habitación Estándar/.test(correo.html) && /\$618\.000/.test(correo.html) && new RegExp(IN).test(correo.html) && /573001112233/.test(correo.html));
ok('incluye lo que escribió el cliente junto al comprobante', /ya transferí el 50%/.test(correo.html));
ok('explica a recepción cómo verificar (total / abono)', /Pago total verificado/.test(correo.html) && /Abono verificado/.test(correo.html));
ok('la reserva queda marcada con comprobante recibido', await esperar(() => /comprobante recibido/.test(reservaT.referenciaPago)), reservaT.referenciaPago);
ok('le responde al cliente que lo recibió y se lo pasó a recepción', await esperar(() => textos().some((t) => /Recibí tu comprobante/.test(t) && /recepción/.test(t))));
ok('en el panel queda la marca de la imagen con lo que escribió', (store.obtener(CLIENTE)?.mensajes || []).some((m) => m.tipo === 'image' && /📷 Imagen — Listo, ya transferí/.test(m.texto)));

const nCorreos = resend.correos.length;
await webhook(imagen(CLIENTE, 'c1', 'image/png'));
await espera(400);
ok('un webhook repetido (mismo archivo) no reenvía otro correo', resend.correos.length === nCorreos);

// un PDF como comprobante
archivosCliente.set('DOC-c2', { mime: 'application/pdf', bytes: pdf('comprobante-bancolombia') });
await webhook(documento(CLIENTE, 'c2', 'application/pdf', 'Comprobante Bancolombia.pdf'));
ok('también reenvía un PDF, con su nombre original', await esperar(() => resend.correos.length === nCorreos + 1) && resend.correos.at(-1).attachments[0].filename === 'Comprobante Bancolombia.pdf' && /Comprobante n\.º<\/td><td[^>]*>2</.test(resend.correos.at(-1).html));
ok('la referencia pasa a "(2)"', /comprobante recibido \(2\)/.test(reservaT.referenciaPago), reservaT.referenciaPago);

// archivo que no sirve
archivosCliente.set('DOC-c3', { mime: 'application/vnd.ms-excel', bytes: Buffer.from('xx') });
const nT = textos().length;
await webhook(documento(CLIENTE, 'c3', 'application/vnd.ms-excel', 'cuentas.xls'));
ok('un Excel no sirve: le pide foto o PDF y no manda correo', await esperar(() => textos().length > nT) && /foto\* o \*PDF/.test(textos().at(-1)) && resend.correos.length === nCorreos + 1);

// foto de alguien SIN transferencia pendiente: flujo de siempre (numero de llamadas), sin correo
const OTRO = '573009998877';
archivosCliente.set('IMG-o1', { mime: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]) });
const nO = textos().length;
await webhook(imagen(OTRO, 'o1', 'image/jpeg'), 'Otro');
ok('foto de un cliente sin transferencia pendiente: responde con el número de llamadas (como antes) y no manda correo', await esperar(() => textos().length > nO) && /Para llamadas por WhatsApp/.test(textos().at(-1)) && resend.correos.length === nCorreos + 1);

// modo humano: reenvia sin escribirle al cliente
store.establecerModo(CLIENTE, 'humano');
archivosCliente.set('IMG-h1', { mime: 'image/png', bytes: PNG });
const nTh = textos().length;
await webhook(imagen(CLIENTE, 'h1'));
ok('con recepción al mando igual se reenvía el comprobante, pero el bot no escribe', await esperar(() => resend.correos.length === nCorreos + 2) && textos().length === nTh);
store.establecerModo(CLIENTE, 'bot');

// tope de comprobantes por reserva
const { config } = await import('../src/config.js');
const topeOriginal = config.transferencia.maxPorReserva;
config.transferencia.maxPorReserva = 3; // ya lleva 3 reenviados
archivosCliente.set('IMG-t1', { mime: 'image/png', bytes: PNG });
const nCt = resend.correos.length;
await webhook(imagen(CLIENTE, 't1'));
await espera(500);
ok('al llegar al tope por reserva ya no reenvía más correos', resend.correos.length === nCt);
config.transferencia.maxPorReserva = topeOriginal;

// descarga imposible -> avisa y marca
const OTRA = '573004445566';
await documentosStore.guardar('cert-bancolombia', { nombre: 'Certificado Bancario Bancolombia.pdf', datos: pdf('bancolombia') });
await ejecutarHerramienta(OTRA, 'reservar_pago_transferencia', { ...reserva, nombre: 'Luis Gómez' });
const nTd = textos().length;
await webhook(imagen(OTRA, 'noexiste', 'image/png'), 'Luis');
ok('si no se puede abrir el archivo, avisa al cliente y marca el chat para atención', await esperar(() => textos().length > nTd) && /inconveniente para abrir/.test(textos().at(-1)) && store.obtener(OTRA)?.escalado === true);

// correo que falla -> no miente al cliente
archivosCliente.set('IMG-f1', { mime: 'image/png', bytes: PNG });
resendFalla = true;
store.establecerModo(OTRA, 'bot'); // la descarga fallida lo había pasado a recepción
const nTf = textos().length;
await webhook(imagen(OTRA, 'f1', 'image/png'), 'Luis');
ok('si el correo NO sale, no le dice que ya se lo pasó a recepción y deja el chat marcado', await esperar(() => textos().length > nTf, 15000) && /inconveniente al pasárselo/.test(textos().at(-1)) && !/Ya se lo pasé/.test(textos().at(-1)) && store.obtener(OTRA)?.escalado === true);
resendFalla = false;
ok('la reserva sigue esperando comprobante (no quedó "recibido" en falso)', reservasStore.vigentesDe(OTRA)[0]?.referenciaPago === REF_ESPERA);

// ============================================================
console.log('\n— Panel de recepción (API) —');
const login = await post('/admin/login', { usuario: 'recepcion', clave: 'clave-de-prueba' });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
ok('el panel abre con la clave de prueba', login.status === 200 && cookie.startsWith('malibu_ses='));
const get = (ruta) => fetch(`${BASE}${ruta}`, { headers: { Cookie: cookie } });
let j = await (await get('/admin/api/transferencia')).json();
ok('lista el estado de los certificados', j.ok && j.documentos.length === 2 && j.documentos.every((d) => d.cargado) && j.correoDestino.includes('reservas@hotelmalibu.co') && j.pendientes >= 2, JSON.stringify(j));
ok('sin sesión el panel no responde', (await fetch(`${BASE}/admin/api/transferencia`, { redirect: 'manual' })).status !== 200);

let sub = await (await post('/admin/api/transferencia/documentos/cert-davivienda', { nombre: '../../etc/Certificado nuevo.pdf', base64: pdf('davivienda-nuevo').toString('base64') }, cookie)).json();
ok('sube/reemplaza un certificado desde el panel y limpia el nombre', sub.ok && sub.documento.nombre === 'Certificado nuevo.pdf' && documentosStore.obtener('cert-davivienda').datos.toString().includes('davivienda-nuevo'), JSON.stringify(sub));
sub = await post('/admin/api/transferencia/documentos/cert-davivienda', { nombre: 'x.pdf', base64: Buffer.from('hola').toString('base64') }, cookie);
ok('el panel rechaza lo que no es PDF', sub.status === 400 && (await sub.json()).ok === false);
const ver = await get('/admin/api/transferencia/documentos/cert-davivienda/ver');
ok('se puede ver el PDF cargado (solo con sesión)', ver.status === 200 && ver.headers.get('content-type') === 'application/pdf' && (await ver.text()).includes('davivienda-nuevo'));
sub = await (await fetch(`${BASE}/admin/api/transferencia/documentos/cert-bancolombia`, { method: 'DELETE', headers: { Cookie: cookie } })).json();
ok('se puede quitar un certificado', sub.ok && !documentosStore.obtener('cert-bancolombia'));
await post('/admin/api/transferencia/documentos/cert-bancolombia', { nombre: 'Certificado Bancario Bancolombia.pdf', base64: pdf('bancolombia').toString('base64') }, cookie);

// prueba de envio al celular del dueño
const nDocs = documentosEnviados().length;
let pr = await (await post('/admin/api/transferencia/probar', { celular: '300 777 8899' }, cookie)).json();
ok('"Enviarme una prueba" manda los certificados a ese celular (con indicativo 57)', pr.ok && documentosEnviados().length === nDocs + 2 && documentosEnviados().at(-1).to === '573007778899', JSON.stringify(pr));
pr = await post('/admin/api/transferencia/probar', { celular: 'abc' }, cookie);
ok('la prueba rechaza un celular inválido', pr.status === 400);

// verificacion de recepcion
const idT = reservaT.id;
const nCv = resend.correos.length, nTv = textos().length;
let ver1 = await (await post(`/admin/api/reservas/${idT}/estado`, { estado: 'pendiente_hotel', verificacion: 'abono' }, cookie)).json();
ok('"Abono verificado": reserva confirmada con saldo en el hotel', ver1.ok && reservasStore.obtenerPorId(idT).estado === 'pendiente_hotel' && reservasStore.obtenerPorId(idT).referenciaPago === 'Transferencia bancaria · abono verificado', JSON.stringify(ver1));
ok('avisa al cliente del abono por WhatsApp (saldo en el hotel)', await esperar(() => textos().length > nTv) && /Recibimos tu abono/.test(textos().at(-1)) && /saldo/.test(textos().at(-1)));
ok('manda correos de confirmación (cliente y recepción) con el texto de abono', await esperar(() => resend.correos.length >= nCv + 2) && resend.correos.slice(nCv).some((c) => c.to.includes('ana@correo.co') && /abono recibido/i.test(c.subject)) && resend.correos.slice(nCv).some((c) => c.to.includes('reservas@hotelmalibu.co') && /ABONO RECIBIDO/.test(c.subject)));
const nCv2 = resend.correos.length;
ver1 = await (await post(`/admin/api/reservas/${idT}/estado`, { estado: 'pendiente_hotel', verificacion: 'abono' }, cookie)).json();
await espera(300);
ok('repetir "Abono verificado" no vuelve a escribirle al cliente', resend.correos.length === nCv2);
ok('tras el abono la reserva sigue aceptando comprobantes (el saldo)', (await import('../src/pagos/transferencia.js')).transferenciaPendienteDe(CLIENTE)?.id === idT);

const nTv2 = textos().length;
let ver2 = await (await post(`/admin/api/reservas/${idT}/estado`, { estado: 'pagado', verificacion: 'total' }, cookie)).json();
ok('"Pago total verificado": reserva PAGADA y se avisa al cliente', ver2.ok && reservasStore.obtenerPorId(idT).estado === 'pagado' && await esperar(() => textos().length > nTv2) && /Tu pago fue confirmado/.test(textos().at(-1)));
ok('ya pagada deja de contar como pendiente de verificar', (await import('../src/pagos/transferencia.js')).transferenciaPendienteDe(CLIENTE) === null);
ok('y su referencia ya no dice "esperando"/"abono": queda "pago total verificado"', reservasStore.obtenerPorId(idT).referenciaPago === 'Transferencia bancaria · pago total verificado', reservasStore.obtenerPorId(idT).referenciaPago);
const mal = await post(`/admin/api/reservas/${reservasStore.listar().find((x) => !esTransferencia(x))?.id ?? 999}/estado`, { estado: 'pagado', verificacion: 'total' }, cookie);
ok('la verificación solo vale para reservas de transferencia', mal.status === 400 || mal.status === 404);
const idOtra = reservasStore.vigentesDe(OTRA)[0].id;
const nCp = resend.correos.length, nTp = textos().length;
const plano = await (await post(`/admin/api/reservas/${idOtra}/estado`, { estado: 'pagado' }, cookie)).json();
await espera(400);
ok('el cambio de estado normal (sin verificación) sigue siendo silencioso, como antes', plano.ok && reservasStore.obtenerPorId(idOtra).estado === 'pagado' && resend.correos.length === nCp && textos().length === nTp);

// el panel (HTML) trae la sección y los botones
const html = await (await get('/admin/')).text();
ok('el panel incluye la sección "Pago por transferencia" y los botones de verificación', /Pago por transferencia/.test(html) && /verificarTransferencia/.test(html) && /subirCertificado/.test(html) && /Pago total verificado/.test(html));

// ============================================================
console.log('\n— Valentina (IA simulada): el prompt real y la herramienta en acción —');
const CLIA = '573006660011';
store.registrarEntrante({ waId: CLIA, nombre: 'Sofía', tipo: 'text', texto: 'Quiero pagar por transferencia, a nombre de Sofía Rojas' });
const nDocsIA = documentosEnviados().length, nPetAntes = claude.peticiones.length;
claude.guion.push(
  [{ type: 'tool_use', id: 'tu_1', name: 'reservar_pago_transferencia', input: { tipoHabitacion: 'Habitación Estándar', checkIn: IN, checkOut: OUT, nombre: 'Sofía Rojas', personas: 2 } }],
  [{ type: 'text', text: 'Te envié los certificados 🏦 Cuando transfieras, mándame la foto del comprobante por aquí.' }]
);
const respIA = await responderIA(CLIA);
const peticion1 = claude.peticiones[nPetAntes], peticion2 = claude.peticiones[nPetAntes + 1];
const sistemaWA = peticion1?.system?.[0]?.text || '';
ok('el asistente recibe la herramienta nueva', (peticion1?.tools || []).some((x) => x.name === 'reservar_pago_transferencia' && x.input_schema.required.includes('nombre')));
ok('en WhatsApp el prompt ofrece pago en línea o en el hotel y deja la transferencia para cuando el cliente la pide', /dos formas de pago de siempre/.test(sistemaWA) && /NO la ofrezcas tú/.test(sistemaWA) && /TRANSFERENCIA bancaria a Davivienda o Bancolombia/.test(sistemaWA) && /reservar_pago_transferencia/.test(sistemaWA) && /NO inventes números de cuenta/.test(sistemaWA));
ok('el prompt no dejó huecos ni "undefined"', !/undefined|\[object/.test(sistemaWA));
const resultadoTool = JSON.stringify(peticion2?.messages?.at(-1)?.content || '');
ok('la herramienta se ejecutó y el asistente recibió la instrucción (certificados enviados, reserva pendiente)', /tool_result/.test(resultadoTool) && /YA se enviaron/.test(resultadoTool) && /PENDIENTE/.test(resultadoTool));
ok('se enviaron los dos certificados al cliente y se creó la reserva en proceso', documentosEnviados().length === nDocsIA + 2 && reservasStore.vigentesDe(CLIA)[0]?.estado === 'en_proceso' && esTransferencia(reservasStore.vigentesDe(CLIA)[0]));
ok('la respuesta final al cliente es la que escribió el asistente', respIA === 'Te envié los certificados 🏦 Cuando transfieras, mándame la foto del comprobante por aquí.');
const nPetSocial = claude.peticiones.length;
store.registrarEntrante({ waId: 'fb:555', nombre: 'Luis', tipo: 'text', texto: 'hola', canal: 'Messenger' });
claude.guion.push([{ type: 'text', text: 'Hola' }]);
await responderIA('fb:555');
const sistemaFB = claude.peticiones[nPetSocial]?.system?.[0]?.text || '';
ok('en Messenger/Instagram el prompt NO ofrece transferencia y remite al WhatsApp', /NO se atiende por Messenger/.test(sistemaFB) && !/tres opciones/.test(sistemaFB) && /573002299991/.test(sistemaFB) && !/undefined/.test(sistemaFB));

// ============================================================
console.log('\n— Seguimiento automático —');
ok('el recordatorio a quien debe su comprobante habla del comprobante (y conserva la marca anti-repetición)', /comprobante de tu transferencia/.test(mensajeSeguimiento({ nombre: 'Ana Pérez' }, { transferencia: true })) && /Quedé pendiente de tu reserva/.test(mensajeSeguimiento({ nombre: 'Ana' }, { transferencia: true })));
ok('el seguimiento normal no cambia', /¿Te ayudo a apartar la habitación\?/.test(mensajeSeguimiento({ nombre: 'Ana' })));

// ============================================================
console.log('\n— Escape del correo (seguridad) —');
const ATACANTE = '573005550000';
await ejecutarHerramienta(ATACANTE, 'reservar_pago_transferencia', { ...reserva, nombre: '<img src=x onerror=alert(1)> Juan' });
archivosCliente.set('IMG-x1', { mime: 'image/png', bytes: PNG });
const nCx = resend.correos.length;
await webhook(imagen(ATACANTE, 'x1', 'image/png', '<script>alert(1)</script>'), '<b>Hacker</b>');
await esperar(() => resend.correos.length === nCx + 1);
const cx = resend.correos.at(-1) || { html: '' };
ok('lo que escribe el cliente (nombre y mensaje) va escapado en el correo a recepción', !/<script>|<img src=x/.test(cx.html) && /&lt;script&gt;/.test(cx.html) && /&lt;img src=x/.test(cx.html));

console.log('\nCorreos enviados en la prueba:', resend.correos.length, '| mensajes WhatsApp:', graph.mensajes.length, '| PDF subidos a WhatsApp:', graph.subidas.length);
console.log(fallos ? `\n❌ ${fallos} verificación(es) fallaron` : '\n✅ Todas las verificaciones pasaron');
process.exit(fallos ? 1 : 0);
