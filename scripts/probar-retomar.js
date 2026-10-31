// ============================================================
//  probar-retomar.js — Prueba OFFLINE de «retomar los chats sin respuesta»: Valentina les escribe con disculpas, una vez a cada
//  uno, solo a quien se puede (dentro de 24 h, sin persona atendiendo, sin reserva), sin crear reservas, con vista previa,
//  programada a una hora y con resumen por correo.
//    node scripts/probar-retomar.js
//  Usa un Claude, un WhatsApp/Messenger y un Resend FALSOS en local. No toca nada real.
// ============================================================
import http from 'http';

const servidor = (manejador) => new Promise((ok) => {
  const s = http.createServer((req, res) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => manejador(req, res, Buffer.concat(partes)));
  });
  s.listen(0, () => ok(s));
});

const enviados = [];          // lo que el bot manda a los clientes: { canal, para, texto }
const correos = [];
const peticiones = [];
const guion = [];
let modo = 'ok';
const graphSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  const m = JSON.parse(cuerpo.toString() || '{}');
  if (req.method === 'POST' && /\/123\/messages$/.test(req.url)) { enviados.push({ canal: 'wa', para: m.to, texto: m.text?.body }); return res.end('{"messages":[{"id":"wamid.X"}]}'); }
  if (req.method === 'POST' && /\/me\/messages/.test(req.url)) { enviados.push({ canal: 'social', para: m.recipient?.id, texto: m.message?.text }); return res.end('{"message_id":"m.X"}'); }
  res.end('{}');
});
const claudeSrv = await servidor((req, res, cuerpo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    peticiones.push(JSON.parse(cuerpo.toString() || '{}'));
    if (modo === 'credito') { res.statusCode = 400; return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } })); }
    const salida = guion.shift() || [{ type: 'text', text: 'Hola, disculpa la demora en responderte 🙏 ¿Para qué fechas te gustaría la habitación y cuántas personas serían?' }];
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

Object.assign(process.env, {
  WHATSAPP_TOKEN: 'token-de-prueba', WHATSAPP_PHONE_NUMBER_ID: '123', GRAPH_API_BASE: `http://127.0.0.1:${graphSrv.address().port}`, META_PAGE_TOKEN: 'token-pagina-de-prueba',
  RESEND_API_KEY: 're_prueba', RESEND_API_BASE: `http://127.0.0.1:${resendSrv.address().port}`, CORREO_RECEPCION: 'reservas@hotelmalibu.co', PUBLIC_URL: 'https://bot.ejemplo.test',
  ANTHROPIC_API_KEY: 'sk-falsa-de-prueba', ANTHROPIC_BASE_URL: `http://127.0.0.1:${claudeSrv.address().port}`, IA_REINTENTOS: '0',
});
for (const k of ['DATABASE_URL', 'CORREO_COPIA', 'CORREO_ALERTAS', 'META_IG_TOKEN', 'IA_ALERTAS']) delete process.env[k];
process.env.IA_ALERTAS = 'false'; // los avisos de «IA caida» no son lo que se prueba aqui

const { store } = await import('../src/almacen/conversaciones.js');
const { reservasStore } = await import('../src/almacen/reservas.js');
const { textoRespaldo } = await import('../src/ia/respaldo.js');
const A = await import('../src/ia/agente.js');
const R = await import('../src/ia/retomar.js');

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperar(cond, ms = 4000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await dormir(30); } return cond(); }
const silencio = async (fn) => { const e = console.error; const w = console.warn; const l = console.log; console.error = () => {}; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };
const HORA = 3600 * 1000;

/** Chat que recibio SOLO el mensaje de espera (+ opcionalmente el seguimiento automatico), de hace `horas` horas. */
function crear(waId, nombre, texto, { horas = 5, seguimiento = false, respuestaReal = false } = {}) {
  store.registrarEntrante({ waId, nombre, tipo: 'text', texto, canal: waId.startsWith('ig:') ? 'Instagram' : undefined });
  store.registrarSaliente({ waId, autor: 'bot', texto: respuestaReal ? '¡Hola! Con gusto te ayudo 😊' : textoRespaldo(nombre) });
  if (seguimiento) store.registrarSaliente({ waId, autor: 'bot', texto: 'Hola 👋 Soy Valentina, del Hotel Malibú. Quedé pendiente de tu reserva 😊 ¿Te ayudo a apartar la habitación?' });
  store.obtener(waId).mensajes.forEach((m) => { m.ts -= horas * HORA; });
}
const W1 = '573001110001', I1 = 'ig:17841400000001', H1 = '573001110002', R1 = '573001110003', V1 = '573001110004', A1 = '573001110005';
crear(W1, 'Bernardo  parra si', '¿Cuánto cuesta?', { horas: 14, seguimiento: true });
crear(I1, 'Fabian Muñoz B', '¿Qué servicios ofrece el hotel?', { horas: 5 });
crear(H1, 'Kevin', 'numero de personas: 1 Adulto', { horas: 6 });
store.obtener(H1).modo = 'humano';
crear(R1, 'Rosa Pérez', 'quiero reservar', { horas: 7 });
reservasStore.crear({ waId: R1, celular: R1, nombre: 'Rosa Pérez', habitacion: 'Habitación Estándar', personas: 2, cantidad: 1, checkIn: '2026-12-01', checkOut: '2026-12-02', monto: 100000, estado: 'pendiente_hotel', fuente: 'bot' });
crear(V1, 'Vera Vieja', 'hola', { horas: 25 });
crear(A1, 'Ana Atendida', 'hola', { horas: 3, respuestaReal: true });

console.log('— Quiénes están pendientes —');
let lista = R.listarPendientes();
const por = (id) => lista.find((p) => p.waId === id);
ok('salen los chats «sin respuesta» y no el que ya recibió una respuesta de verdad', lista.length === 5 && !por(A1) && [W1, I1, H1, R1, V1].every((id) => por(id)), JSON.stringify(lista.map((p) => p.waId)));
ok('van primero los que antes pierden su ventana de 24 h', lista[0].waId === V1 && lista[1].waId === W1 && lista.at(-1).waId === I1, JSON.stringify(lista.map((p) => p.nombre)));
ok('solo son elegibles quienes se pueden retomar (WhatsApp con seguimiento e Instagram)', por(W1).elegible && por(I1).elegible && !por(H1).elegible && !por(R1).elegible && !por(V1).elegible);
ok('cada omitido dice por qué: atiende una persona / ya tiene reserva / pasaron más de 24 h', /persona/.test(por(H1).motivo) && /reserva confirmada/.test(por(R1).motivo) && /24 h/.test(por(V1).motivo), JSON.stringify([por(H1).motivo, por(R1).motivo, por(V1).motivo]));
ok('muestra el último mensaje del cliente y cuándo se le cierra la ventana', por(W1).ultimoTexto === '¿Cuánto cuesta?' && por(W1).ventanaHasta > Date.now());

console.log('\n— Vista previa (no envía nada) —');
const nPet0 = peticiones.length;
let vp = await R.retomarPendientes({ enviar: false });
ok('redacta un borrador para cada elegible y nada más', vp.borradores === 2 && vp.omitidos === 3 && vp.fallos === 0 && vp.resultados.filter((x) => x.estado === 'borrador').every((x) => /disculpa/.test(x.texto)), JSON.stringify(vp.resultados.map((x) => x.estado)));
ok('no se mandó ningún mensaje y todos siguen «sin respuesta»', enviados.length === 0 && R.listarPendientes().length === 5);
const reqW1 = peticiones.slice(nPet0).find((p) => JSON.stringify(p.messages).includes('Cuánto cuesta'));
ok('al modelo le llega el aviso de disculpas como tercer bloque del sistema (sin romper el cache del primero)', reqW1.system.length === 3 && reqW1.system[0].cache_control?.type === 'ephemeral' && reqW1.system[2].cache_control === undefined && /SIN RESPONDER varias horas/.test(reqW1.system[2].text) && /NO crees reservas/.test(reqW1.system[2].text));
ok('el historial termina en el mensaje del cliente (se quitó el seguimiento automático del final) y no trae el mensaje de espera', reqW1.messages.at(-1).role === 'user' && !JSON.stringify(reqW1.messages).includes('Quedé pendiente') && !JSON.stringify(reqW1.messages).toLowerCase().includes('en un momento te atendemos'), JSON.stringify(reqW1.messages));

console.log('\n— Envío real —');
const rr = await R.retomarPendientes({ enviar: true, pausaMs: 0 });
ok('se les escribe a los dos elegibles, en orden de ventana: primero WhatsApp (el más antiguo), luego Instagram', rr.enviados === 2 && rr.omitidos === 3 && enviados.length === 2 && enviados[0].canal === 'wa' && enviados[0].para === W1 && enviados[1].canal === 'social' && enviados[1].para === '17841400000001', JSON.stringify(enviados));
ok('el texto lleva la disculpa', enviados.every((m) => /disculpa/.test(m.texto)));
lista = R.listarPendientes();
ok('quedan atendidos: el chat cambia de estado y sale de «sin respuesta»; los demás siguen igual', !por(W1) && !por(I1) && !!por(H1) && !!por(R1) && !!por(V1), JSON.stringify(lista.map((p) => p.nombre)));
const filaW1 = store.listar().find((c) => c.waId === W1);
ok('en el panel el chat ya no necesita atención y el mensaje quedó anotado como de Valentina', filaW1.sinRespuestaIA === false && filaW1.necesitaAtencion === false && store.obtener(W1).mensajes.at(-1).autor === 'bot' && /disculpa/.test(store.obtener(W1).mensajes.at(-1).texto));
const otra = await R.retomarPendientes({ enviar: true, pausaMs: 0 });
ok('si se corre otra vez no le escribe de nuevo a nadie (una sola vez a cada uno)', otra.enviados === 0 && enviados.length === 2);

console.log('\n— Nunca crea una reserva por sí solo —');
const W2 = '573001110006';
crear(W2, 'Wilson Rey', 'del 20 al 22 de noviembre, 2 personas, pago al llegar', { horas: 4 });
guion.push(
  [{ type: 'tool_use', id: 'tu_1', name: 'reservar_pago_en_hotel', input: { tipoHabitacion: 'Habitación Estándar', checkIn: '2026-11-20', checkOut: '2026-11-22', nombre: 'Wilson Rey', personas: 2 } }],
  [{ type: 'text', text: 'Hola Wilson, disculpa la demora 🙏 Te confirmo: Estándar del 20 al 22 de noviembre. ¿Me confirmas tu celular para dejarla lista?' }],
);
const nReservas = reservasStore.listar().length, nPet1 = peticiones.length;
const rw = await silencio(() => R.retomarChat(W2, { enviar: true }));
const resultadoHerr = JSON.stringify(peticiones[nPet1 + 1].messages.at(-1).content);
ok('si el modelo intenta reservar, la herramienta lo rechaza y no se crea nada', rw.estado === 'enviado' && /Todavía no reserves/.test(resultadoHerr) && reservasStore.listar().length === nReservas, resultadoHerr);

console.log('\n— Cuando la IA falla —');
const W3 = '573001110007';
crear(W3, 'Wanda Paz', 'hola', { horas: 3 });
modo = 'credito';
const nEnv = enviados.length;
const rf = await silencio(() => R.retomarChat(W3, { enviar: true }));
ok('sin saldo: no se manda nada y el chat sigue pendiente (se dice el motivo)', rf.estado === 'fallo' && /credit balance/i.test(rf.motivo) && enviados.length === nEnv && !!R.listarPendientes().find((p) => p.waId === W3), JSON.stringify(rf));
await silencio(() => A.responderIA(W3)); // la IA falla de verdad en un chat: queda marcada como caída
ok('con la IA caída, la retomada completa se detiene sin escribirle a nadie', (await R.retomarPendientes({ enviar: true, pausaMs: 0 })).abortado?.includes('no está respondiendo') && enviados.length === nEnv);
modo = 'ok';
await A.probarIA(); // «Probar conexión» ya funciona: la IA vuelve

console.log('\n— Programada a una hora —');
const t0 = Date.now();
crear('573001110008', 'Pedro Pablo', 'buenas', { horas: 2 });
const prog = R.programarRetomada(t0 + 1000);
ok('queda programada (y guardada en los ajustes) sin haber corrido', prog.hecho === false && R.estadoRetomada().cuando === t0 + 1000 && R.estadoRetomada().hecho === false);
const nEnv2 = enviados.length;
ok('antes de la hora no hace nada', (await R.revisarRetomada(t0)) === null && enviados.length === nEnv2);
const nCorreos = correos.length;
const corrida = await silencio(() => R.revisarRetomada(t0 + 2000));
ok('a la hora corre, escribe a los pendientes elegibles (Wanda y Pedro) y queda «hecha» con su resumen', corrida?.enviados === 2 && R.estadoRetomada().hecho === true && R.estadoRetomada().resumen.enviados === 2 && enviados.length === nEnv2 + 2, JSON.stringify(R.estadoRetomada()));
await esperar(() => correos.length > nCorreos);
const correo = correos.at(-1) || {};
ok('llega a recepción el correo con el resumen: quién recibió mensaje y a quién no se le escribió y por qué', /Valentina retomó 2 chats/.test(correo.subject) && /Mensaje enviado/.test(correo.html) && /lo atiende una persona/.test(correo.html) && /24 h/.test(correo.html), correo.subject);
ok('no corre dos veces', (await R.revisarRetomada(t0 + 3000)) === null && enviados.length === nEnv2 + 2);
R.programarRetomada(t0 - 7 * HORA);
crear('573001110009', 'Tarde Tarde', 'hola', { horas: 1 });
const nEnv3 = enviados.length;
ok('si se perdió la hora por más de 6 h (servidor caído), no corre sola: se marca vencida', (await R.revisarRetomada(t0)) === null && R.estadoRetomada().vencida === true && enviados.length === nEnv3);
R.cancelarRetomada();
ok('se puede cancelar', R.estadoRetomada() === null);

[graphSrv, claudeSrv, resendSrv].forEach((s) => s.close());
console.log(fallos === 0 ? '\n🎉 Todas las verificaciones pasaron.' : `\n💥 ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
