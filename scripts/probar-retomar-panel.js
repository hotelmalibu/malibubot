// ============================================================
//  probar-retomar-panel.js — Prueba OFFLINE de la pestaña «Retomar chats» del panel (el JavaScript de src/admin/panel.html):
//  se corre el código de la pestaña con una página y un servidor simulados y se revisa lo que dibuja y lo que pide.
//    node scripts/probar-retomar-panel.js
// ============================================================
import vm from 'vm';
import { readFileSync } from 'fs';

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };

const html = readFileSync(new URL('../src/admin/panel.html', import.meta.url), 'utf8');
const ini = html.indexOf('// ---------- Retomar chats sin respuesta ----------');
const fin = html.indexOf('// Arranque + ciclos de actualización');
ok('el panel tiene la pestaña, la sección y el diálogo de «Retomar chats»', ini > 0 && fin > ini && /id="tabRetomar"/.test(html) && /id="vistaRetomar"/.test(html) && /id="dlgRetomar"/.test(html) && /retomar: 'vistaRetomar'/.test(html) && /if \(v === 'retomar'\) cargarRetomar\(\)/.test(html));
let sintaxis = true; try { new vm.Script(html.slice(ini, fin)); } catch (e) { sintaxis = false; console.log('   error:', e.message); }
ok('el código de la pestaña no tiene errores de sintaxis', sintaxis);

// ---- Página simulada ----
const elementos = {};
const el = (id) => (elementos[id] ||= { id, innerHTML: '', textContent: '', style: {}, value: '', dataset: {}, closest: () => null, showModal() { this.abierto = true; }, close() { this.abierto = false; }, onclick: null });
const llamadas = [];       // lo que la pestaña le pide al servidor: { url, metodo, cuerpo }
const respuestas = [];     // respuestas simuladas (en orden)
const ahora = Date.now(), H = 3600 * 1000;
const ctx = vm.createContext({
  document: { getElementById: el, activeElement: null },
  fetch: async (url, op = {}) => {
    llamadas.push({ url, metodo: op.method || 'GET', cuerpo: op.body ? JSON.parse(op.body) : null });
    const r = respuestas.shift();
    if (r instanceof Error) throw r;
    return { ok: true, json: async () => r };
  },
  esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  haceCuanto: (ts) => `hace ${Math.round((Date.now() - ts) / H)} h`,
  tarjeta: (clase, ico, lbl, num, pie) => `<k class="${clase}"><l>${lbl}</l><n>${num}</n><p>${pie || ''}</p></k>`,
  mostrarVista: (v) => { ctx.__vista = v; }, abrir: (w) => { ctx.__abierto = w; }, vistaActual: 'retomar',
  setInterval: () => 0, setTimeout: (fn) => { fn(); return 0; }, Date, Number, Object, Promise, JSON, String, Math, console,
});
vm.runInContext(html.slice(ini, fin) + `
  this.api = { cargarRetomar, retPreparar, retEnviar, retEditar, retEnviarTodos, retEnviarListos, retPrepararTodos, retProgramar, retCancelarProgramacion, retVerChat, retVentana, retSiguiente8, retDatos: () => retDatos, borradores: retBorradores, enviados: retEnviados, ocupado: () => retOcupado };
`, ctx);
const A = ctx.api;
const pend = (waId, nombre, horas, extra = {}) => ({ waId, nombre, ultimoDelCliente: ahora - horas * H, ventanaHasta: ahora - horas * H + 24 * H, ultimoTexto: '¿Cuánto cuesta?', elegible: true, motivo: '', ...extra });
// «Botón»: lo que la pestaña lee del elemento que se pulsó (a qué chat pertenece)
const boton = (waId) => ({ closest: () => ({ dataset: { wa: waId }, querySelector: () => ({ disabled: false }) }) });
const area = (waId, valor) => ({ value: valor, closest: () => ({ dataset: { wa: waId }, querySelector: (q) => (q === '.ret-estado' ? { textContent: 'x' } : { disabled: false }) }) });

const lista = {
  ok: true, programada: null,
  pendientes: [
    pend('573001', 'Laura <b>Gómez</b>', 14),
    pend('ig:555', 'Fabian Muñoz', 5),
    pend('573002', 'Kevin', 6, { elegible: false, motivo: 'lo atiende una persona' }),
    pend('573003', 'Vera', 30, { elegible: false, motivo: 'pasaron más de 24 h desde su último mensaje: el canal ya no permite escribirle' }),
  ],
};

console.log('\n— Lo que dibuja —');
respuestas.push(lista);
await A.cargarRetomar();
ok('pide la lista al servidor', llamadas[0].url === '/admin/api/ia/retomar' && llamadas[0].metodo === 'GET');
ok('las tarjetas cuentan: 4 sin respuesta, 2 se pueden retomar, 2 no', /Sin respuesta<\/l><n>4/.test(el('kpisRetomar').innerHTML) && /Se pueden retomar<\/l><n>2/.test(el('kpisRetomar').innerHTML) && /No se les puede escribir<\/l><n>2/.test(el('kpisRetomar').innerHTML));
ok('la pestaña muestra el contador (solo los que se pueden retomar)', el('contRetomar').textContent === 2 && el('contRetomar').style.display === 'inline-flex');
const listaHtml = el('retLista').innerHTML;
ok('una ficha por chat, con canal, ventana y el último mensaje', (listaHtml.match(/class="ret-item/g) || []).length === 4 && /WhatsApp/.test(listaHtml) && /Instagram/.test(listaHtml) && /le puedes escribir/.test(listaHtml) && /¿Cuánto cuesta\?/.test(listaHtml));
ok('quien no se puede retomar dice por qué y no tiene recuadro ni botón de enviar', /lo atiende una persona\./.test(listaHtml) && /el canal ya no permite escribirle\./.test(listaHtml) && (listaHtml.match(/<textarea/g) || []).length === 2);
ok('los nombres con etiquetas salen escapados (no se cuelan en la página)', !/<b>Gómez/.test(listaHtml) && /&lt;b&gt;G/.test(listaHtml));
ok('sin borradores, «Enviar los preparados» está apagado', /id="retBtnEnviarTodos" disabled/.test(el('retBarra').innerHTML));
ok('la programación propone la próxima 8:00 a. m.', /datetime-local/.test(el('retProg').innerHTML) && /T08:00"/.test(el('retProg').innerHTML), el('retProg').innerHTML.slice(0, 300));
const v = A.retVentana(ahora + 90 * 60000 + 30000), v2 = A.retVentana(ahora + 10 * H), v3 = A.retVentana(ahora - 1000);
ok('la ventana se pinta rojo si queda poco, verde si queda mucho y «cerró» si ya pasó', v.clase === 'ya' && /1 h 30 min/.test(v.txt) && v2.clase === 'ok' && v3.clase === 'ya' && /cerró/.test(v3.txt));

console.log('\n— Preparar y enviar un chat —');
llamadas.length = 0; respuestas.push({ ok: true, estado: 'borrador', texto: 'Hola Laura, disculpa la demora 🙏' });
await A.retPreparar(boton('573001'));
ok('pide el borrador de ESE chat (sin enviar)', llamadas[0].url === '/admin/api/ia/retomar/chat' && llamadas[0].cuerpo.waId === '573001' && llamadas[0].cuerpo.accion === 'borrador');
ok('el borrador queda en el recuadro y se habilita «Enviar los preparados (1)»', A.borradores['573001'] === 'Hola Laura, disculpa la demora 🙏' && /Hola Laura, disculpa la demora/.test(el('retLista').innerHTML) && /Enviar los 1 preparados/.test(el('retBarra').innerHTML) && !/id="retBtnEnviarTodos" disabled/.test(el('retBarra').innerHTML));
A.retEditar(area('573001', 'Hola Laura, disculpa la demora 🙏 ¡Te esperamos!'));
ok('si se edita, se conserva lo editado', A.borradores['573001'].endsWith('¡Te esperamos!'));
llamadas.length = 0; respuestas.push({ ok: false, estado: 'fallo', motivo: 'La IA falló (400 · invalid_request_error): Your credit balance is too low' });
await A.retPreparar(boton('ig:555'));
ok('si la IA falla, la ficha muestra el motivo y no deja un borrador', /credit balance/.test(el('retLista').innerHTML) && !A.borradores['ig:555']);
llamadas.length = 0; respuestas.push({ ok: true, estado: 'enviado', texto: 'Hola Laura, disculpa la demora 🙏 ¡Te esperamos!' }, { ...lista, pendientes: lista.pendientes.slice(1) });
await A.retEnviar(boton('573001'));
ok('al enviar manda EL TEXTO EDITADO (no pide otro a la IA)', llamadas[0].cuerpo.waId === '573001' && llamadas[0].cuerpo.accion === 'enviar' && llamadas[0].cuerpo.texto === 'Hola Laura, disculpa la demora 🙏 ¡Te esperamos!');
ok('queda anotado en «Retomados en esta sesión» y se refresca la lista', A.enviados.length === 1 && /Retomados en esta sesión/.test(el('retResumen').innerHTML) && llamadas[1].url === '/admin/api/ia/retomar' && !A.borradores['573001']);
ok('no se puede enviar si el servidor lo rechaza: se ve el motivo y el chat sigue ahí', await (async () => {
  A.borradores['ig:555'] = 'Hola Fabian'; respuestas.push({ ok: false, estado: 'omitido', motivo: 'ya se le contestó' }, lista);
  await A.retEnviar(boton('ig:555'));
  return /ya se le contestó/.test(el('retLista').innerHTML) && A.enviados.length === 1;
})());

console.log('\n— Varios a la vez —');
for (const k of Object.keys(A.borradores)) delete A.borradores[k];
respuestas.length = 0; llamadas.length = 0; respuestas.push(lista); await A.cargarRetomar();
respuestas.push({ ok: true, enviar: false, resultados: [{ waId: '573001', estado: 'borrador', texto: 'Borrador A' }, { waId: 'ig:555', estado: 'borrador', texto: 'Borrador B' }, { waId: '573002', estado: 'omitido', motivo: 'lo atiende una persona' }] });
await A.retPrepararTodos();
ok('«Preparar los mensajes» pide la vista previa y llena los recuadros vacíos', llamadas.at(-1).url.endsWith('/vista-previa') && llamadas.at(-1).metodo === 'POST' && A.borradores['573001'] === 'Borrador A' && A.borradores['ig:555'] === 'Borrador B' && A.ocupado() === false);
A.borradores['573001'] = 'Texto editado a mano'; respuestas.push({ ok: true, resultados: [{ waId: '573001', estado: 'borrador', texto: 'Otro borrador' }] });
await A.retPrepararTodos();
ok('no pisa un texto que la persona ya editó', A.borradores['573001'] === 'Texto editado a mano');
respuestas.push(new Error('sin red')); await A.retPrepararTodos();
ok('si no hay conexión lo dice y queda libre', /error de conexión/.test(el('retBarra').innerHTML) && A.ocupado() === false);
A.borradores['573001'] = 'Mensaje 1'; A.borradores['ig:555'] = 'Mensaje 2';
llamadas.length = 0; respuestas.length = 0; respuestas.push(lista);
await A.cargarRetomar();
A.retEnviarTodos();
ok('pide confirmación antes de enviar a varios, con la lista de nombres', el('dlgRetomar').abierto === true && /Enviar 2 mensajes/.test(el('dlgRetTitulo').textContent) && /Laura/.test(el('dlgRetTexto').innerHTML) && /Fabian Muñoz/.test(el('dlgRetTexto').innerHTML) && typeof el('dlgRetOk').onclick === 'function');
llamadas.length = 0; respuestas.length = 0;
respuestas.push({ ok: true, texto: 'Mensaje 1' }, { ok: true, texto: 'Mensaje 2' }, { ...lista, pendientes: lista.pendientes.slice(2) });
await A.retEnviarListos();
ok('al confirmar se envía a cada uno, uno por uno, con su propio texto', llamadas.filter((l) => l.cuerpo?.accion === 'enviar').map((l) => `${l.cuerpo.waId}:${l.cuerpo.texto}`).join('|') === '573001:Mensaje 1|ig:555:Mensaje 2');
ok('termina libre (no queda «ocupado») y con el contador al día (ya no quedan chats para retomar)', A.ocupado() === false && el('contRetomar').textContent === 0 && el('contRetomar').style.display === 'none');

console.log('\n— Programar —');
llamadas.length = 0; respuestas.length = 0; respuestas.push({ ok: true, programada: { cuando: ahora + 5 * H, hecho: false } }, { ...lista, programada: { cuando: ahora + 5 * H, hecho: false } });
el('retCuando').value = '2026-10-31T08:00';
await A.retProgramar();
const prog = llamadas.find((l) => l.url.endsWith('/programar'));
ok('manda la fecha y hora como instante exacto (ISO) al servidor', !!prog && prog.metodo === 'POST' && prog.cuerpo.cuando === new Date('2026-10-31T08:00').toISOString(), JSON.stringify(prog));
ok('al quedar programada muestra «Programado para…» y «Cancelar programación»', /Programado para/.test(el('retProg').innerHTML) && /Cancelar programación/.test(el('retProg').innerHTML) && /Envío programado<\/l><n>Sí/.test(el('kpisRetomar').innerHTML));
llamadas.length = 0; respuestas.length = 0; respuestas.push({ ok: true }, { ...lista, programada: null });
await A.retCancelarProgramacion();
ok('cancelar avisa al servidor y vuelve el formulario', llamadas[0].url.endsWith('/cancelar') && /datetime-local/.test(el('retProg').innerHTML));
llamadas.length = 0; respuestas.length = 0; respuestas.push({ ok: false, error: '«cuando» debe ser una fecha con hora y zona…' });
el('retCuando').value = '2026-10-31T08:00';
await A.retProgramar();
ok('si el servidor rechaza la fecha, se ve el motivo', /debe ser una fecha/.test(el('retProgMsg').textContent));
ok('sin fecha elegida no pide nada', await (async () => { llamadas.length = 0; el('retCuando').value = ''; await A.retProgramar(); return llamadas.length === 0; })());
llamadas.length = 0; respuestas.length = 0; respuestas.push({ ...lista, programada: { cuando: ahora - 3 * H, hecho: true, inicio: ahora - 3 * H, resumen: { enviados: 6, omitidos: 2, fallos: 0 } } });
await A.cargarRetomar();
ok('después de correr, muestra el resumen de la última programación', /6 enviados, 2 no se retomaron, 0 fallaron/.test(el('retProg').innerHTML));

console.log('\n— Ver el chat —');
A.retVerChat(boton('573001'));
ok('«Ver chat» abre la pestaña Conversaciones en ese chat', ctx.__vista === 'chats' && ctx.__abierto === '573001');

console.log('\n— Sin pendientes —');
respuestas.length = 0; respuestas.push({ ok: true, programada: null, pendientes: [] });
await A.cargarRetomar();
ok('sin chats pendientes muestra un mensaje tranquilo y el contador se oculta', /No hay chats sin respuesta/.test(el('retLista').innerHTML) && el('contRetomar').style.display === 'none');

console.log(fallos === 0 ? '\n🎉 Todas las verificaciones pasaron.' : `\n💥 ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
