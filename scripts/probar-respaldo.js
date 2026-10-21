// ============================================================
//  probar-respaldo.js — Prueba OFFLINE de lo que pasa cuando Valentina (la IA) NO puede contestar:
//    · el mensaje de espera lleva el nombre del cliente y no se repite una y otra vez;
//    · el chat queda «sin respuesta» (y «necesita atención») hasta que conteste la IA o una persona;
//    · la IA no lee ese mensaje de espera como si lo hubiera escrito ella;
//    · recepción recibe un correo (una vez, no un aluvión) y otro cuando la IA vuelve;
//    · la franja roja del panel aparece con la causa en español;
//    · los seguimientos automáticos esperan mientras la IA está caída.
//    node scripts/probar-respaldo.js
//  Usa un Claude FALSO y un Resend FALSO en local. No toca Anthropic, Resend ni producción.
// ============================================================
import http from 'http';
import vm from 'vm';
import { readFileSync } from 'fs';
import { spawn } from 'child_process';

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperar(cond, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await dormir(25); } return cond(); }

// ---------- Claude falso ----------
let modo = 'ok';
const pedidosClaude = [];
const claude = http.createServer((req, res) => {
  const partes = [];
  req.on('data', (c) => partes.push(c));
  req.on('end', () => {
    try { pedidosClaude.push(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch { /* no es JSON */ }
    res.setHeader('Content-Type', 'application/json');
    const base = { id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-falso', usage: { input_tokens: 10, output_tokens: 5 } };
    if (modo === 'credito') { res.statusCode = 400; return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } })); }
    if (modo === 'caida') { res.statusCode = 500; return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Internal server error' } })); }
    return res.end(JSON.stringify({ ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: '¡Hola! 😊 Con gusto te ayudo con tu reserva.' }] }));
  });
});
await new Promise((r) => claude.listen(0, '127.0.0.1', r));

// ---------- Resend falso ----------
const correos = [];
const resend = http.createServer((req, res) => {
  const partes = [];
  req.on('data', (c) => partes.push(c));
  req.on('end', () => {
    try { correos.push(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch { /* ignorar */ }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: `em_${correos.length}` }));
  });
});
await new Promise((r) => resend.listen(0, '127.0.0.1', r));

const entorno = {
  ANTHROPIC_API_KEY: 'sk-falsa-de-prueba', ANTHROPIC_BASE_URL: `http://127.0.0.1:${claude.address().port}`, IA_REINTENTOS: '0',
  RESEND_API_KEY: 're_falsa', RESEND_API_BASE: `http://127.0.0.1:${resend.address().port}`,
  CORREO_RECEPCION: 'recepcion@prueba.test', CORREO_COPIA: '', CORREO_ALERTAS: 'dueno@prueba.test', PUBLIC_URL: 'https://bot.prueba.test',
};
Object.assign(process.env, entorno);
for (const k of ['DATABASE_URL', 'ANTHROPIC_MODELO', 'IA_ALERTAS', 'IA_ALERTA_CADA_MIN']) delete process.env[k];

const R = await import('../src/ia/respaldo.js');
const { responderIA, saludIA, iaCaida } = await import('../src/ia/agente.js');
const { store } = await import('../src/almacen/conversaciones.js');
const { enviarSeguimientos } = await import('../src/ia/seguimiento.js');
const silencio = async (fn) => { const e = console.error; const w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
const MIN = 60 * 1000, HORA = 60 * MIN;

console.log('— El mensaje de espera —');
ok('lleva el primer nombre del cliente y conserva la frase fija', /^Hola Bernardo 👋 Gracias por escribir al Hotel Malibú\. En un momento te atendemos\./.test(R.textoRespaldo('Bernardo  parra si')), R.textoRespaldo('Bernardo  parra si'));
ok('sin nombre: no inventa saludo', R.textoRespaldo('').startsWith('Gracias por escribir') && R.textoRespaldo(null).startsWith('Gracias por escribir'));
ok('un nombre solo de emojis o demasiado largo no se usa', R.textoRespaldo('✌🏻🔥').startsWith('Gracias') && R.textoRespaldo('Fundacionparaeldesarrolloregional').startsWith('Gracias'));
ok('el texto viejo y el nuevo se reconocen como mensaje de espera; una respuesta normal no', R.esRespaldo('Gracias por escribir al Hotel Malibú. En un momento te atendemos. Para reservas...') && R.esRespaldo(R.textoRespaldo('Ana')) && !R.esRespaldo('¡Hola! Con gusto te ayudo.'));

console.log('\n— No se repite lo mismo —');
const ahora = 1_800_000_000_000;
const chat = (...ms) => ({ nombre: 'Bernardo', mensajes: ms.map(([autor, texto, ts]) => ({ autor, texto, ts })) });
const esp = R.textoRespaldo('Bernardo');
ok('se mandó hace 5 min: no se repite', R.respaldoReciente(chat(['cliente', 'Hola', ahora - 6 * MIN], ['bot', esp, ahora - 5 * MIN], ['cliente', 'dime', ahora - 1 * MIN]), ahora));
ok('se mandó hace 31 min: ya se puede volver a mandar', !R.respaldoReciente(chat(['cliente', 'Hola', ahora - 32 * MIN], ['bot', esp, ahora - 31 * MIN]), ahora));
ok('si después contestó la IA o una persona, no cuenta como «reciente»', !R.respaldoReciente(chat(['bot', esp, ahora - 5 * MIN], ['humano', 'Hola, soy Laura de recepción', ahora - 3 * MIN]), ahora));
ok('el aviso de llamadas y el de seguimiento no cuentan como respuesta (siguen sin respuesta)',
  R.respaldoReciente(chat(['bot', esp, ahora - 10 * MIN], ['bot', '📞 Para llamadas por WhatsApp comunícate con nosotros al +57 314 593 3714.', ahora - 9 * MIN]), ahora) &&
  R.sinRespuestaIA(chat(['bot', esp, ahora - 4 * HORA], ['bot', 'Hola Ana 👋 Soy Valentina, del Hotel Malibú. Quedé pendiente de tu reserva 😊', ahora - 1 * HORA]), ahora));
ok('chat vacío: no hay nada que decidir', !R.respaldoReciente(chat(), ahora) && !R.sinRespuestaIA(chat(), ahora) && !R.sinRespuestaIA(null, ahora));
let d1 = R.decidirRespaldo(chat(['cliente', 'Hola', ahora - MIN]), 'Bernardo', ahora);
ok('primera vez: manda el mensaje con el nombre', typeof d1.texto === 'string' && d1.texto.includes('Hola Bernardo'));
ok('segunda vez seguida: no manda nada', R.decidirRespaldo(chat(['cliente', 'Hola', ahora - 3 * MIN], ['bot', d1.texto, ahora - 2 * MIN], ['cliente', '¿Cuánto cuesta?', ahora - 1 * MIN]), 'Bernardo', ahora).omitir === true);
ok('pasados 30 min vuelve a mandarlo', typeof R.decidirRespaldo(chat(['bot', d1.texto, ahora - 31 * MIN], ['cliente', 'hola?', ahora - MIN]), 'Bernardo', ahora).texto === 'string');
ok('si el webhook no trae nombre, usa el que ya tiene el chat', R.decidirRespaldo(chat(['cliente', 'Hola', ahora - MIN]), '', ahora).texto.includes('Hola Bernardo'));

console.log('\n— El chat queda «sin respuesta» en el panel —');
let n = 0;
const nuevoChat = (texto, nombre = 'Cliente Prueba') => { const waId = `57301${String(3000000 + ++n)}`; store.registrarEntrante({ waId, nombre, tipo: 'text', texto }); return waId; };
const fila = (waId) => store.listar().find((c) => c.waId === waId);
const w1 = nuevoChat('¿Cuánto cuesta?');
ok('mientras la IA contesta con normalidad, el chat no se marca', !fila(w1).sinRespuestaIA && !fila(w1).necesitaAtencion);
store.registrarSaliente({ waId: w1, autor: 'bot', texto: R.textoRespaldo('Cliente Prueba') });
ok('después del mensaje de espera queda «sin respuesta» y «necesita atención»', fila(w1).sinRespuestaIA === true && fila(w1).necesitaAtencion === true);
store.registrarEntrante({ waId: w1, nombre: 'Cliente Prueba', tipo: 'text', texto: '2 personas, del 20 al 22' });
ok('si el cliente sigue escribiendo y nadie contesta, sigue marcado', fila(w1).sinRespuestaIA === true);
store.registrarSaliente({ waId: w1, autor: 'humano', texto: 'Hola, soy Laura de recepción. Para esas fechas tenemos...' });
ok('apenas contesta una persona, la marca se quita sola', fila(w1).sinRespuestaIA === false && fila(w1).necesitaAtencion === false);
const w2 = nuevoChat('Buenas');
store.registrarSaliente({ waId: w2, autor: 'bot', texto: R.textoRespaldo('X') });
store.obtener(w2).mensajes.forEach((m) => { m.ts -= 80 * HORA; });
ok('un mensaje de espera de hace más de 72 h ya no marca el chat (no queda pendiente para siempre)', fila(w2).sinRespuestaIA === false);

console.log('\n— La IA no imita el mensaje de espera —');
const w3 = nuevoChat('Hola, quiero una habitación');
store.registrarSaliente({ waId: w3, autor: 'bot', texto: R.textoRespaldo('Cliente Prueba') });
store.registrarEntrante({ waId: w3, nombre: 'Cliente Prueba', tipo: 'text', texto: '¿Cuánto cuesta?' });
modo = 'ok'; pedidosClaude.length = 0;
const r3 = await responderIA(w3);
const enviado = pedidosClaude.at(-1)?.messages || [];
ok('responde con normalidad', typeof r3 === 'string' && /ayudo/.test(r3), String(r3));
ok('Claude NO recibe el mensaje de espera en el historial', enviado.length > 0 && !JSON.stringify(enviado).toLowerCase().includes('en un momento te atendemos'), JSON.stringify(enviado));
ok('...pero sí recibe lo que escribió el cliente (sus dos mensajes seguidos; la API los junta en un turno)', enviado.length === 2 && enviado.every((m) => m.role === 'user') && JSON.stringify(enviado).includes('quiero una habitación') && JSON.stringify(enviado).includes('Cuánto cuesta'), JSON.stringify(enviado));

console.log('\n— Correo a recepción cuando la IA no puede —');
modo = 'credito'; correos.length = 0;
await silencio(() => responderIA(nuevoChat('Hola, ¿tienen habitación?')));
await esperar(() => correos.length >= 1);
const c1 = correos[0] || {};
ok('sin saldo: sale UN correo al primer fallo', correos.length === 1, `${correos.length} correos`);
ok('...va a recepción y al dueño', Array.isArray(c1.to) && c1.to.includes('recepcion@prueba.test') && c1.to.includes('dueno@prueba.test'), JSON.stringify(c1.to));
ok('...con asunto claro y la causa en español sencillo', /Valentina no puede responder/.test(c1.subject || '') && /se acabó el saldo/i.test(c1.html || '') && /Buy credits/.test(c1.html || ''), c1.subject);
ok('...con enlace al panel y sin ningún dato secreto', /bot\.prueba\.test\/admin/.test(c1.html || '') && !/sk-falsa|re_falsa/.test(c1.html || ''));
await silencio(() => responderIA(nuevoChat('¿Y para el sábado?')));
await dormir(300);
ok('un segundo fallo seguido NO manda otro correo (nada de aluvión)', correos.length === 1, `${correos.length} correos`);
let s = saludIA();
ok('el panel sabe que está caída y por qué', s.caida === true && s.explicacion?.clave === 'saldo' && s.explicacion.pasos.some((p) => /Billing/.test(p)) && s.seguidos === 2, JSON.stringify(s.explicacion));
ok('la franja cuenta cuántos clientes esperan', s.recientes.length === 2 && s.aviso.enviados === 1 && s.aviso.abierta === true);
ok('iaCaida() lo confirma (los seguimientos esperan)', iaCaida() === true);

modo = 'ok';
await responderIA(nuevoChat('Hola otra vez'));
await esperar(() => correos.length >= 2);
ok('cuando la IA vuelve llega UN correo «ya responde de nuevo»', correos.length === 2 && /ya responde de nuevo/.test(correos[1].subject || '') && /Caída/.test(correos[1].html || ''), correos[1]?.subject);
await responderIA(nuevoChat('Otro más'));
await dormir(300);
ok('...y no se repite en las siguientes respuestas buenas', correos.length === 2);
s = saludIA();
ok('el panel vuelve a la normalidad', s.caida === false && s.explicacion === null && s.seguidos === 0 && iaCaida() === false);

console.log('\n— Fallos pasajeros (Claude saturado) —');
modo = 'caida'; correos.length = 0;
await silencio(() => responderIA(nuevoChat('Hola 1')));
await silencio(() => responderIA(nuevoChat('Hola 2')));
await dormir(300);
ok('1 o 2 fallos pasajeros no mandan correo', correos.length === 0, `${correos.length} correos`);
ok('...pero a los 2 seguidos la franja roja ya aparece', saludIA().caida === true && saludIA().explicacion?.clave === 'caida');
await silencio(() => responderIA(nuevoChat('Hola 3')));
await esperar(() => correos.length >= 1);
ok('al tercer fallo seguido sale el correo', correos.length === 1 && /saturado|falla temporal/i.test(correos[0].html || ''), `${correos.length}`);
modo = 'ok';
await responderIA(nuevoChat('Hola 4'));
await esperar(() => correos.length >= 2);
ok('y al volver, el correo de recuperación', correos.length === 2 && /ya responde de nuevo/.test(correos[1].subject || ''));

console.log('\n— La prueba de conexión del panel cierra la caída —');
modo = 'credito'; correos.length = 0;
await silencio(() => responderIA(nuevoChat('Hola 5')));
await esperar(() => correos.length >= 1);
const { probarIA } = await import('../src/ia/agente.js');
let p = await silencio(() => probarIA());
ok('con la IA todavía sin saldo, la prueba falla y la franja sigue roja', p.ok === false && saludIA().caida === true);
modo = 'ok';
p = await probarIA();
await esperar(() => correos.length >= 2);
ok('cuando recargan el saldo y pulsan «Probar conexión», la franja se apaga sin esperar a un cliente', p.ok === true && saludIA().caida === false && saludIA().seguidos === 0);
ok('...y llega el correo de recuperación', correos.length === 2 && /ya responde de nuevo/.test(correos[1].subject || ''));

console.log('\n— Los seguimientos automáticos esperan a la IA —');
let llamadas = 0;
const original = store.paraSeguimiento;
store.paraSeguimiento = (...a) => { llamadas++; return []; };
const { config } = await import('../src/config.js');
config.seguimiento.activo = true;
modo = 'credito';
await silencio(() => responderIA(nuevoChat('Hola 6')));
const logs = []; const log0 = console.log; console.log = (...a) => logs.push(a.join(' '));
await enviarSeguimientos();
console.log = log0;
ok('con la IA caída no busca a quién escribirle', llamadas === 0 && logs.some((l) => /esperan a que vuelva/.test(l)), logs.join(' | '));
modo = 'ok';
await responderIA(nuevoChat('Hola 7'));
await enviarSeguimientos();
ok('con la IA sana, los seguimientos siguen como siempre', llamadas === 1);
store.paraSeguimiento = original;

console.log('\n— IA_ALERTAS=false apaga los correos —');
await esperar(() => correos.length >= 2); await dormir(300); // que terminen los correos pendientes de la seccion anterior
correos.length = 0;
modo = 'credito';
const hijo = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
  const { responderIA, saludIA } = await import(${JSON.stringify(new URL('../src/ia/agente.js', import.meta.url).href)});
  const { store } = await import(${JSON.stringify(new URL('../src/almacen/conversaciones.js', import.meta.url).href)});
  store.registrarEntrante({ waId: '573019990000', nombre: 'P', tipo: 'text', texto: 'hola' });
  console.error = () => {};
  await responderIA('573019990000');
  console.log(JSON.stringify({ caida: saludIA().caida }));
  setTimeout(() => process.exit(0), 600);
`], { env: { ...process.env, ...entorno, IA_ALERTAS: 'false', DATABASE_URL: '' } });
let salida = ''; hijo.stdout.on('data', (c) => { salida += c; });
await new Promise((r) => hijo.on('close', r));
ok('con IA_ALERTAS=false la franja del panel sigue funcionando pero no sale ningún correo', JSON.parse(salida.trim().split('\n').pop()).caida === true && correos.length === 0, `${salida} · ${correos.length} correos`);

console.log('\n— La franja roja del panel —');
const html = readFileSync(new URL('../src/admin/panel.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let sintaxisOk = true; try { scripts.forEach((js) => new vm.Script(js)); } catch (e) { sintaxisOk = false; console.log('   error de sintaxis en el panel:', e.message); }
ok('el panel sigue sin errores de sintaxis', sintaxisOk && scripts.length >= 1);
ok('tiene la franja, la marca «SIN RESPUESTA» y el botón de prueba', /id="avisoIA"/.test(html) && /pill sinresp/.test(html) && /probarIAPanel/.test(html));
const trozo = html.slice(html.indexOf('let ultimaPruebaIA'), html.indexOf('// Arranque + ciclos de actualización'));
const clases = new Set();
const el = { style: { display: 'none' }, innerHTML: '', classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c) } };
const respuestas = {};
const ctx = vm.createContext({
  document: { getElementById: (id) => (id === 'avisoIA' ? el : { innerHTML: '' }) },
  fetch: async (url, op) => ({ ok: true, json: async () => respuestas[`${(op && op.method) || 'GET'} ${url}`] || respuestas[url] }),
  esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  cargarLista: () => {}, setTimeout: () => {}, Date, Object,
});
vm.runInContext(trozo + '\nthis.cargar = cargarSaludIA; this.probar = probarIAPanel;', ctx);
respuestas['/admin/api/ia/estado'] = { ok: true, caida: false, explicacion: null };
await ctx.cargar();
ok('IA sana: la franja está oculta', el.style.display === 'none');
respuestas['/admin/api/ia/estado'] = { ok: true, caida: true, desde: ahora, sinRespuesta: 9, explicacion: { causa: 'Se acabó el saldo de la cuenta de Anthropic.', pasos: ['Entra a console.anthropic.com', 'Pulsa «Buy credits»'] } };
await ctx.cargar();
ok('IA caída: la franja se muestra con la causa, los pasos y cuántos clientes esperan', el.style.display === 'block' && /Se acabó el saldo/.test(el.innerHTML) && /Buy credits/.test(el.innerHTML) && /<b>9<\/b> clientes esperan/.test(el.innerHTML) && /Probar conexión/.test(el.innerHTML), el.innerHTML);
respuestas['/admin/api/ia/estado'] = { ok: true, caida: true, sinRespuesta: 1, explicacion: { causa: 'Texto con <script>alert(1)</script>', pasos: [] } };
await ctx.cargar();
ok('un texto con etiquetas no se cuela en la página (se escapa)', !/<script>alert/.test(el.innerHTML) && /&lt;script&gt;/.test(el.innerHTML) && /<b>1<\/b> cliente espera/.test(el.innerHTML));

// Despues de recargar el saldo: «Probar conexión» muestra el resultado en verde aunque la franja roja ya se haya apagado.
respuestas['/admin/api/ia/estado'] = { ok: true, caida: false, explicacion: null };
respuestas['POST /admin/api/ia/diag'] = { ok: true, intentos: { minimo: { ok: true }, completo: { ok: true } } };
const boton = { disabled: false, textContent: '' };
await ctx.probar(boton);
ok('probar conexión con éxito: aviso verde «Valentina ya puede responder» (y no se borra de inmediato)', el.style.display === 'block' && clases.has('bien') && /Valentina ya puede responder/.test(el.innerHTML) && /SIN RESPUESTA/.test(el.innerHTML), el.innerHTML);
await ctx.cargar();
ok('...ni siquiera cuando el panel se refresca solo mientras tanto', el.style.display === 'block' && clases.has('bien'));
respuestas['POST /admin/api/ia/diag'] = { ok: false, intentos: { minimo: { ok: false, mensaje: 'Your credit balance is too low' } } };
respuestas['/admin/api/ia/estado'] = { ok: true, caida: true, sinRespuesta: 2, explicacion: { causa: 'Se acabó el saldo.', pasos: [] } };
await ctx.probar(boton);
ok('probar conexión sin saldo: sigue la franja roja (no verde) con el motivo exacto', el.style.display === 'block' && !clases.has('bien') && /Sigue fallando: Your credit balance is too low/.test(el.innerHTML), el.innerHTML);

claude.close(); resend.close();
console.log(fallos === 0 ? '\n🎉 Todas las verificaciones pasaron.' : `\n💥 ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
