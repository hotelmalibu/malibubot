// ============================================================
//  probar-vik.js — Prueba OFFLINE del aviso "Reserva confirmada" (Vik Booking).
//  Levanta una Graph API falsa en local y llama al procesador directamente.
//    node scripts/probar-vik.js
// ============================================================
import http from 'http';

process.env.VIK_ACTIVO = 'true';
process.env.VIK_MODO_PRUEBA = 'false';
process.env.VIK_WEBHOOK_KEY = 'clave-de-prueba';
process.env.WHATSAPP_TOKEN = 'x';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123';

const enviados = [];
let graphFalla = false;
const servidor = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (graphFalla) { res.statusCode = 400; return res.end('{"error":{"message":"template not approved"}}'); }
    const m = JSON.parse(cuerpo || '{}');
    enviados.push({ a: m.to, plantilla: m.template?.name, idioma: m.template?.language?.code, params: m.template?.components?.[0]?.parameters?.map((p) => p.text) });
    res.end('{"messages":[{"id":"wamid.X"}]}');
  });
});
await new Promise((r) => servidor.listen(0, r));
process.env.GRAPH_API_BASE = `http://127.0.0.1:${servidor.address().port}`;

const { procesarConfirmacion, claveValida, destinoDe, estadoVik, probarPlantilla } = await import('../src/vikbooking/confirmada.js');
const { reservasStore } = await import('../src/almacen/reservas.js');

let fallos = 0;
const ok = (n, c) => { console.log((c ? '✅ ' : '❌ ') + n); if (!c) fallos++; };
const reserva = (extra = {}) => ({ id: 501, sid: 'abc123', ts: 1790000000, phone: '300 123 4567', name: 'ANA maría pérez', checkin: '2026-10-02', checkout: '2026-10-03', ...extra });

// clave
const req = (k) => ({ get: () => k });
ok('clave correcta pasa', claveValida(req('clave-de-prueba')) === true);
ok('clave incorrecta o vacía no pasa', claveValida(req('otra')) === false && claveValida(req('')) === false);

// celulares
ok('celular 10 dígitos -> 57', destinoDe('300 123 4567') === '573001234567');
ok('+57 con espacios', destinoDe('+57 (300) 123-4567') === '573001234567');
ok('fijo o basura se descarta', destinoDe('2806663') === '' && destinoDe('no tiene') === '');

// envío
let r = await procesarConfirmacion(reserva());
ok('envía la plantilla con nombre, ingreso y salida', r.estado === 'enviado' && enviados.length === 1
  && enviados[0].plantilla === 'malibu_reserva_confirmada' && enviados[0].idioma === 'es'
  && enviados[0].params[0] === 'Ana' && String(enviados[0].params[1]) === '501'
  && /2 de octubre/.test(enviados[0].params[2]) && /3 de octubre/.test(enviados[0].params[3])
  && enviados[0].params[4].includes('sid=abc123&ts=1790000000'));

r = await procesarConfirmacion(reserva());
ok('segunda llamada de la misma reserva no envía', r.estado === 'duplicado' && enviados.length === 1);

// fechas solo con marca de tiempo
r = await procesarConfirmacion(reserva({ id: 502, checkin: '', checkout: '', checkin_ts: 1790000000, checkout_ts: 1790086400 }));
ok('fechas a partir de la marca de tiempo', r.estado === 'enviado' && enviados.length === 2 && /\d/.test(enviados[1].params[2]));

// casos que no envían
r = await procesarConfirmacion(reserva({ id: 503, phone: 'sin celular' }));
ok('sin celular válido se omite', r.estado === 'omitido' && enviados.length === 2);
r = await procesarConfirmacion(reserva({ id: 504, ota: 'BK9' }));
ok('reserva de Booking/OTA se omite', r.estado === 'omitido' && enviados.length === 2);
r = await procesarConfirmacion({ phone: '3001234567' });
ok('sin número de reserva es inválido', r.ok === false && r.http === 400);
r = await procesarConfirmacion(reserva({ id: 505, checkin: '', checkout: '' }));
ok('sin fechas es inválido', r.ok === false && r.http === 400);

// WhatsApp rechaza -> no se marca y se puede reintentar
graphFalla = true;
r = await procesarConfirmacion(reserva({ id: 506 }));
ok('si WhatsApp rechaza responde error 502', r.ok === false && r.http === 502);
graphFalla = false;
r = await procesarConfirmacion(reserva({ id: 506 }));
ok('y al reintentar sí se envía', r.estado === 'enviado' && enviados.length === 3);

// ---- integración con el panel (reservas de Vik Booking) ----
const vik = (id) => reservasStore.buscarPorReferencia(`vik:${id}`);
const detalle = { rooms: [{ name: 'Habitación Estándar (S)', adults: 2, children: 1 }], total: 309000, email: 'ana@correo.co' };
const antesPanel = reservasStore.listar().length;
r = await procesarConfirmacion(reserva({ id: 601, ...detalle }));
let v = vik(601);
ok('la reserva queda registrada en el panel con todos sus datos', !!v && v.estado === 'pagado' && v.fuente === 'vikbooking'
  && v.nombre === 'ANA maría pérez' && v.habitacion === 'Habitación Estándar (S)' && v.personas === 3 && v.monto === 309000
  && v.checkIn === '2026-10-02' && v.checkOut === '2026-10-03' && v.email === 'ana@correo.co' && v.waId === '573001234567');
r = await procesarConfirmacion(reserva({ id: 601, ...detalle }));
ok('repetir la llamada no duplica la reserva en el panel', reservasStore.listar().filter((x) => x.referenciaPago === 'vik:601').length === 1);
const nAntes = enviados.length;
r = await procesarConfirmacion(reserva({ id: 602, status: 'standby', ...detalle }));
ok('reserva en espera: se registra "en proceso" y NO envía WhatsApp', r.estado === 'registrada' && vik(602)?.estado === 'en_proceso' && enviados.length === nAntes);
r = await procesarConfirmacion(reserva({ id: 602, status: 'confirmed', ...detalle }));
ok('al confirmarse la misma reserva pasa a pagado y sí envía', vik(602)?.estado === 'pagado' && r.estado === 'enviado' && enviados.length === nAntes + 1);
r = await procesarConfirmacion(reserva({ id: 602, status: 'cancelled', ...detalle }));
ok('al cancelarse en Vik queda cancelada en el panel', r.estado === 'cancelada' && vik(602)?.estado === 'cancelado');
r = await procesarConfirmacion(reserva({ id: 603, ota: 'BK9', phone: '', ...detalle }));
ok('reserva de OTA se registra como canal externo, sin WhatsApp', vik(603)?.fuente === 'vikbooking-ota' && r.estado === 'omitido');
r = await procesarConfirmacion(reserva({ id: 604, phone: 'sin celular', ...detalle }));
ok('sin celular igual queda en el panel', !!vik(604) && vik(604).celular === '' && r.estado === 'omitido');
ok('el panel sumó solo las reservas nuevas de Vik', reservasStore.listar().length > antesPanel);

// prueba de plantilla a un celular (ruta /admin/api/vik/probar)
const nAntesPrueba = enviados.length;
let pr = await probarPlantilla('3001234567');
ok('probarPlantilla envía la plantilla con datos de ejemplo', pr.ok === true && enviados.at(-1).params[0] === 'Prueba' && enviados.length === nAntesPrueba + 1);
pr = await probarPlantilla('abc');
ok('probarPlantilla rechaza un celular inválido', pr.ok === false);
graphFalla = true;
pr = await probarPlantilla('3001234567');
ok('probarPlantilla devuelve el motivo de Meta', pr.ok === false && /template not approved/.test(pr.error));
graphFalla = false;

console.log('\nEstado:', JSON.stringify({ enviados: estadoVik().enviados }));
servidor.close();
console.log(fallos ? `\n❌ ${fallos} verificación(es) fallaron` : '\n✅ Todas las verificaciones pasaron');
process.exit(fallos ? 1 : 0);
