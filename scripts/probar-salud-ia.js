// ============================================================
//  probar-salud-ia.js — Prueba OFFLINE de la «salud» de Valentina (la IA): que el bot sepa y diga POR QUE
//  no pudo responder (saldo, clave, modelo, sin texto...) y que se vea en el panel (/api/ia/estado y /api/ia/diag).
//    node scripts/probar-salud-ia.js
//  Usa un Claude FALSO en local. No toca Anthropic ni produccion.
// ============================================================
import http from 'http';
import { spawnSync } from 'child_process';

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };

// Claude falso: contesta segun el modo.
let modo = 'ok';
let peticiones = 0;
const claude = http.createServer((req, res) => {
  const partes = [];
  req.on('data', (c) => partes.push(c));
  req.on('end', () => {
    peticiones++;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('request-id', 'req_prueba_123');
    const base = { id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-falso', usage: { input_tokens: 10, output_tokens: 5 } };
    if (modo === 'credito') { res.statusCode = 400; return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } })); }
    if (modo === 'clave') { res.statusCode = 401; return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); }
    if (modo === 'sin_texto') return res.end(JSON.stringify({ ...base, stop_reason: 'end_turn', content: [] }));
    if (modo === 'bucle') return res.end(JSON.stringify({ ...base, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `tu_${peticiones}`, name: 'consultar_disponibilidad', input: { fecha: '2026-12-20' } }] }));
    return res.end(JSON.stringify({ ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: '¡Hola! 😊 Bienvenido al Hotel Malibú.' }] }));
  });
});
await new Promise((r) => claude.listen(0, '127.0.0.1', r));

Object.assign(process.env, { ANTHROPIC_API_KEY: 'sk-falsa-de-prueba', ANTHROPIC_BASE_URL: `http://127.0.0.1:${claude.address().port}` });
for (const k of ['DATABASE_URL', 'ANTHROPIC_MODELO']) delete process.env[k];

const { responderIA, saludIA, probarIA } = await import('../src/ia/agente.js');
const { store } = await import('../src/almacen/conversaciones.js');
const silencio = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

let n = 0;
const nuevoChat = (texto = 'Hola, ¿cuánto cuesta?') => { const waId = `57300${String(2000000 + ++n)}`; store.registrarEntrante({ waId, nombre: 'Prueba', tipo: 'text', texto }); return waId; };

console.log('— Cuando Claude rechaza la petición —');
modo = 'credito';
let r = await silencio(() => responderIA(nuevoChat()));
let s = saludIA();
ok('sin saldo: responderIA da null (el bot usará el mensaje de respaldo)', r === null);
ok('...y la salud dice el motivo exacto: 400, invalid_request_error y «credit balance»', s.errores === 1 && s.seguidos === 1 && s.recientes[0].estado === 400 && s.recientes[0].tipo === 'invalid_request_error' && /credit balance/.test(s.recientes[0].mensaje), JSON.stringify(s.recientes[0]));
ok('...con el id de la petición para pedirle ayuda a Anthropic', s.recientes[0].idPeticion === 'req_prueba_123', s.recientes[0].idPeticion);
ok('...y sin guardar el número completo del cliente', /•/.test(s.recientes[0].chat) && !/^57300\d{7}$/.test(s.recientes[0].chat), s.recientes[0].chat);
modo = 'clave';
await silencio(() => responderIA(nuevoChat()));
s = saludIA();
ok('clave inválida: 401 authentication_error y ya van 2 fallos seguidos', s.seguidos === 2 && s.recientes[0].estado === 401 && s.recientes[0].tipo === 'authentication_error', JSON.stringify(s.recientes[0]));

console.log('\n— Respuestas sin texto o que no terminan —');
modo = 'sin_texto';
r = await silencio(() => responderIA(nuevoChat()));
s = saludIA();
ok('Claude contesta pero sin texto: null y motivo «sin_texto»', r === null && s.recientes[0].tipo === 'sin_texto' && s.seguidos === 3, JSON.stringify(s.recientes[0]));
modo = 'bucle';
const antes = peticiones;
r = await silencio(() => responderIA(nuevoChat()));
s = saludIA();
ok('Claude pide herramientas sin parar: corta a las 4 vueltas y lo dice', r === null && peticiones - antes === 4 && s.recientes[0].tipo === 'sin_respuesta_final', `${peticiones - antes} peticiones · ${JSON.stringify(s.recientes[0])}`);

console.log('\n— Cuando todo vuelve a funcionar —');
modo = 'ok';
r = await responderIA(nuevoChat());
s = saludIA();
ok('responde de verdad', typeof r === 'string' && /Bienvenido/.test(r), String(r));
ok('...y el contador de fallos seguidos vuelve a 0 (los errores quedan en el historial)', s.seguidos === 0 && s.ok === 1 && s.errores === 4 && s.ultimoOk > 0 && s.recientes.length === 4, JSON.stringify({ ok: s.ok, errores: s.errores, seguidos: s.seguidos, recientes: s.recientes.length }));

console.log('\n— Prueba de conexión del panel (POST /api/ia/diag) —');
let d = await probarIA();
ok('con Claude sano: las dos pruebas (mínima y con las instrucciones reales) salen bien', d.ok === true && d.intentos.minimo.ok && d.intentos.completo.ok && d.claveConfigurada === true, JSON.stringify(d));
modo = 'credito';
d = await probarIA();
ok('sin saldo: dice cuál prueba falló y por qué', d.ok === false && d.intentos.minimo.ok === false && d.intentos.minimo.estado === 400 && /credit balance/.test(d.intentos.minimo.mensaje), JSON.stringify(d.intentos.minimo));
ok('la prueba no cuenta como respuesta de Valentina (no cambia la salud)', saludIA().ok === 1 && saludIA().errores === 4);

console.log('\n— Sin clave de Anthropic —');
const hijo = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
  delete process.env.DATABASE_URL; process.env.ANTHROPIC_API_KEY = '';
  const { probarIA, saludIA, responderIA } = await import(${JSON.stringify(new URL('../src/ia/agente.js', import.meta.url).href)});
  const { store } = await import(${JSON.stringify(new URL('../src/almacen/conversaciones.js', import.meta.url).href)});
  store.registrarEntrante({ waId: '573009990000', nombre: 'P', tipo: 'text', texto: 'hola' });
  console.error = () => {};
  const r = await responderIA('573009990000');
  console.log(JSON.stringify({ r, d: await probarIA(), s: saludIA() }));
  process.exit(0);
`], { encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: '' } });
let sin = null;
try { sin = JSON.parse(hijo.stdout.trim().split('\n').pop()); } catch { /* se muestra abajo */ }
ok('sin ANTHROPIC_API_KEY: lo dice claro y marca el error', !!sin && sin.r === null && sin.d.claveConfigurada === false && sin.d.ok === false && sin.s.recientes[0]?.tipo === 'sin_clave' && /ANTHROPIC_API_KEY/.test(sin.s.recientes[0].mensaje), hijo.stdout + hijo.stderr);

claude.close();
console.log(fallos === 0 ? '\n🎉 Todas las verificaciones pasaron.' : `\n💥 ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
