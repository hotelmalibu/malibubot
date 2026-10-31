// ============================================================
//  demo-retomar.js — Abre el panel REAL en tu computador con datos de EJEMPLO para probar el módulo «Retomar chats»
//  sin tocar nada de verdad: clientes inventados, y WhatsApp / Instagram / Messenger, correo y la IA son SIMULADOS
//  (los borradores los escribe un redactor de plantilla, no Valentina; en producción los escribe Claude).
//
//    node scripts/demo-retomar.js        y abre  http://localhost:3006/admin   (usuario: cualquiera · clave: prueba-local)
//
//  Todo lo que «se envía» se imprime en esta consola con el prefijo [demo]. Se apaga con Ctrl+C. No usa la base de datos real.
// ============================================================
import http from 'http';

const PUERTO = Number(process.env.DEMO_PUERTO) || 3006;
const servidor = (manejador) => new Promise((ok) => {
  const s = http.createServer((req, res) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => manejador(req, res, Buffer.concat(partes)));
  });
  s.listen(0, '127.0.0.1', () => ok(s));
});

// WhatsApp / Messenger / Instagram simulados: solo imprimen lo que el bot «enviaría».
const graph = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  let m = {};
  try { m = JSON.parse(cuerpo.toString() || '{}'); } catch { /* sin cuerpo */ }
  if (req.method === 'POST' && /\/messages/.test(req.url)) {
    const para = m.to || m.recipient?.id || '?';
    const texto = m.text?.body || m.message?.text || '';
    if (texto) console.log(`[demo] → se enviaría a ${para}: «${texto}»`);
    return res.end('{"messages":[{"id":"wamid.DEMO"}]}');
  }
  res.end('{}');
});

// «Claude» simulado: escribe una disculpa de plantilla según lo que preguntó el cliente.
const claude = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (!(req.method === 'POST' && req.url.startsWith('/v1/messages'))) { res.statusCode = 404; return res.end('{}'); }
  const p = JSON.parse(cuerpo.toString() || '{}');
  const sistema = (p.system || []).map((b) => b.text).join('\n');
  const nombre = (sistema.match(/«([^»]+)»/) || [])[1] || '';
  const primero = nombre.split(' ')[0];
  const ultimo = [...(p.messages || [])].reverse().find((m) => m.role === 'user');
  const dicho = typeof ultimo?.content === 'string' ? ultimo.content : JSON.stringify(ultimo?.content || '');
  const hola = `Hola${primero ? ' ' + primero : ''}, disculpa la demora en responderte 🙏 `;
  let texto;
  if (/evento|cotiz/i.test(dicho)) texto = hola + 'Para eventos y salones te atiende directamente nuestro equipo especializado: https://wa.me/573145933710. Y si necesitas habitaciones para los asistentes, con gusto te ayudo.';
  else if (/servicio/i.test(dicho)) texto = hola + 'Tenemos piscina, desayuno incluido, parqueadero gratis y WiFi en todo el hotel. ¿Para qué fechas te gustaría reservar y cuántas personas serían?';
  else if (/fecha|cuando|cuándo/i.test(dicho) && /no tengo|aún|todav/i.test(dicho)) texto = hola + 'Tranquilo, cuando tengas una idea de fechas me cuentas y te digo precio y disponibilidad al instante. ¿Más o menos para qué mes estarías pensando venir?';
  else if (/\d{1,2}\/\d{1,2}|noviembre|diciembre/i.test(dicho)) texto = hola + 'Te confirmo las fechas que me escribiste y te cuento el precio enseguida: ¿para cuántas personas serían?';
  else if (/cuesta|cu[aá]nto|precio|tarifa/i.test(dicho)) texto = hola + 'Con gusto te cuento el precio: ¿para qué fechas te gustaría la habitación y cuántas personas serían?';
  else texto = hola + '¿En qué te puedo ayudar? Si quieres reservar, cuéntame para qué fechas y cuántas personas serían.';
  console.log(`[demo] (IA simulada) redactó un borrador para ${nombre || 'un cliente'}`);
  res.end(JSON.stringify({ id: 'msg_demo', type: 'message', role: 'assistant', model: 'demo', content: [{ type: 'text', text: texto }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }));
});

const correo = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/emails') { try { console.log(`[demo] → correo a ${JSON.parse(cuerpo.toString()).to}: ${JSON.parse(cuerpo.toString()).subject}`); } catch { /* */ } return res.end('{"id":"em_demo"}'); }
  res.end('{}');
});

// Entorno ANTES de cargar la app (lee el entorno al importarla). Se pisan TODAS las conexiones externas, aunque haya un .env real.
const base = (s) => `http://127.0.0.1:${s.address().port}`;
Object.assign(process.env, {
  PORT: String(PUERTO), ADMIN_PASSWORD: 'prueba-local', ADMIN_USUARIO: '', ADMIN_TOTP_SECRET: '', DATABASE_URL: '',
  WHATSAPP_TOKEN: 'demo', WHATSAPP_PHONE_NUMBER_ID: '123', GRAPH_API_BASE: base(graph), INSTAGRAM_API_BASE: base(graph), META_PAGE_TOKEN: 'demo', META_IG_TOKEN: 'demo',
  RESEND_API_KEY: 'demo', RESEND_API_BASE: base(correo), CORREO_RECEPCION: 'reservas@ejemplo.test', CORREO_COPIA: '', CORREO_ALERTAS: '',
  ANTHROPIC_API_KEY: 'demo', ANTHROPIC_BASE_URL: base(claude), ANTHROPIC_MODELO: 'demo', IA_ALERTAS: 'false', IA_REINTENTOS: '0',
  VIK_SYNC_URL: '', VIK_CRON_URL: '', VIK_CRON_ACTIVO: 'false', GOOGLE_OCUPACION_URL: '', RAPYD_ACCESS_KEY: '', RAPYD_SECRET_KEY: '',
  SEGUIMIENTO_ACTIVO: 'false', RECORDATORIO_ACTIVO: 'false', PUBLIC_URL: `http://localhost:${PUERTO}`,
});

await import('../src/index.js'); // arranca el servidor real del panel
const { store } = await import('../src/almacen/conversaciones.js');
const { reservasStore } = await import('../src/almacen/reservas.js');
const { textoRespaldo } = await import('../src/ia/respaldo.js');

// ---- Clientes de ejemplo (inventados): recibieron SOLO el mensaje de espera hace unas horas ----
const H = 3600 * 1000;
function sembrar(waId, nombre, texto, horas, { seguimiento = false, humano = false } = {}) {
  store.registrarEntrante({ waId, nombre, tipo: 'text', texto, canal: waId.startsWith('ig:') ? 'Instagram' : waId.startsWith('fb:') ? 'Messenger' : undefined });
  store.registrarSaliente({ waId, autor: 'bot', texto: textoRespaldo(nombre) });
  if (seguimiento) store.registrarSaliente({ waId, autor: 'bot', texto: `Hola ${nombre.split(' ')[0]} 👋 Soy Valentina, del Hotel Malibú. Quedé pendiente de tu reserva 😊 ¿Te ayudo a apartar la habitación? Cuéntame tus fechas y te la dejo lista en un minuto. 🌴` });
  const conv = store.obtener(waId);
  conv.mensajes.forEach((m) => { m.ts -= horas * H; });
  conv.ultimaActividad -= horas * H;
  if (humano) conv.modo = 'humano';
}
sembrar('ig:17841400000011', 'Carlos Peña', 'Hola, ¿qué servicios ofrece el hotel?', 9);
sembrar('573001230001', 'Laura Gómez', '¿Cuánto cuesta una habitación para este fin de semana?', 14);
sembrar('ig:17841400000012', 'Marta Ríos', 'quiero reservar para 2 personas pero todavía no tengo fechas', 3);
sembrar('573001230002', 'Eventos Andina SAS', 'requiero una cotización para un evento corporativo de 80 personas', 6);
sembrar('fb:61234000000013', 'Julián Torres', 'Buenas tardes, ¿tienen habitaciones disponibles?', 22.4);
sembrar('573001230003', 'Daniela Ortiz', '11/12 al 13/12, 2 personas', 20, { seguimiento: true });
sembrar('573001230004', 'Andrés Salcedo', 'numero de personas: 1 adulto', 6, { humano: true });
sembrar('573001230005', 'Rosa Marín', 'quiero reservar una habitación', 7);
reservasStore.crear({ waId: '573001230005', celular: '573001230005', nombre: 'Rosa Marín', habitacion: 'Habitación Estándar', personas: 2, cantidad: 1, checkIn: '2026-12-01', checkOut: '2026-12-02', monto: 100000, estado: 'pendiente_hotel', fuente: 'bot' });
sembrar('573001230006', 'Pedro Vega', 'hola', 31);

console.log('\n====================================================================');
console.log(` Demo de «Retomar chats» listo:  http://localhost:${PUERTO}/admin`);
console.log(' Usuario: cualquiera (p. ej. recepcion) · Clave: prueba-local');
console.log(' Todo es de ejemplo: nada sale a clientes reales. Ctrl+C para cerrar.');
console.log('====================================================================\n');
