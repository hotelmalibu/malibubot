// ============================================================
//  probar-tarifa-diciembre.js — Prueba OFFLINE de la TARIFA DE DICIEMBRE (Junior Suite Twins, llegadas del 15-dic-2026 al 6-ene-2027):
//    · Valentina la ofrece primero a parejas, familias y grupos de 3 (antes la olvidaba y cotizaba la Estándar / la Ubique);
//    · el día de la semana lo da un calendario calculado por el código (dijo «domingo» el 28 de diciembre y es lunes);
//    · la Twins tiene cupo limitado: cuando se agota, la herramienta lo rechaza y manda ofrecer la Estándar al mismo precio.
//    node scripts/probar-tarifa-diciembre.js
//  Usa un WhatsApp, un Resend y un Claude FALSOS en local. No toca nada real.
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
const graphSrv = await servidor((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"messages":[{"id":"wamid.X"}]}'); });
const resendSrv = await servidor((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"id":"em_1"}'); });

Object.assign(process.env, {
  WHATSAPP_TOKEN: 'token-de-prueba', WHATSAPP_PHONE_NUMBER_ID: '123', GRAPH_API_BASE: `http://127.0.0.1:${graphSrv.address().port}`,
  RESEND_API_KEY: 're_prueba', RESEND_API_BASE: `http://127.0.0.1:${resendSrv.address().port}`, CORREO_RECEPCION: 'reservas@hotelmalibu.co', PUBLIC_URL: 'https://bot.ejemplo.test',
  ANTHROPIC_API_KEY: 'sk-falsa-de-prueba', IA_REINTENTOS: '0', GOOGLE_OCUPACION_URL: '', CUPO_TWINS: '5',
});
for (const k of ['DATABASE_URL', 'CORREO_COPIA', 'CORREO_ALERTAS', 'VIK_SYNC_URL']) delete process.env[k];

const F = await import('../src/util/fechas.js');
const H = await import('../src/datos/habitaciones.js');
const C = await import('../src/datos/cupo.js');
const A = await import('../src/ia/agente.js');
const { reservasStore } = await import('../src/almacen/reservas.js');
const { store } = await import('../src/almacen/conversaciones.js');

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };
const silencio = async (fn) => { const e = console.error; const w = console.warn; const l = console.log; console.error = () => {}; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };

console.log('— El día de la semana —');
ok('el 28 de diciembre de 2026 es LUNES (y el 27, domingo)', F.diaSemana('2026-12-28') === 'lunes' && F.diaSemana('2026-12-27') === 'domingo' && F.diaSemana('2027-01-01') === 'viernes');
const cal = F.calendarioSemanas('2026-10-30', 150);
const dic = cal.find((l) => l.startsWith('diciembre 2026:')) || '';
ok('el calendario trae octubre a marzo, una línea por mes', cal.length === 6 && cal[0].startsWith('octubre 2026:') && cal.at(-1).startsWith('marzo 2027:'), JSON.stringify(cal.map((l) => l.slice(0, 16))));
ok('diciembre 2026: lunes 7, 14, 21, 28 y domingos 6, 13, 20, 27', /lun 7, 14, 21, 28/.test(dic) && /dom 6, 13, 20, 27/.test(dic), dic);
// Prueba de propiedad: cada día de los 150 está en la lista del día de la semana que le toca.
const mapa = {};
for (const l of cal) { const [mes, resto] = l.split(': '); mapa[mes] = {}; for (const parte of resto.split(' · ')) { const [d, ...nums] = parte.split(' '); mapa[mes][d] = nums.join(' ').split(', ').map(Number); } }
const nombresMes = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const cortos = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
let malos = 0;
for (let i = 0; i < 150; i++) { const iso = F.sumarDias('2026-10-30', i); const d = new Date(iso + 'T12:00:00Z'); const lista = mapa[`${nombresMes[d.getUTCMonth()]} ${d.getUTCFullYear()}`]?.[cortos[d.getUTCDay()]] || []; if (!lista.includes(d.getUTCDate())) malos++; }
ok('los 150 días del calendario caen en el día de la semana correcto', malos === 0, `${malos} errores`);

console.log('\n— Cuándo aplica la tarifa de diciembre —');
ok('llegadas del 15-dic-2026 al 6-ene-2027 sí; antes y después no', H.enNavidad('2026-12-15') && H.enNavidad('2026-12-28') && H.enNavidad('2027-01-06') && !H.enNavidad('2026-12-14') && !H.enNavidad('2027-01-07') && !H.enNavidad('2026-11-20'));
ok('la Twins cuesta $309.000 (igual que la Estándar)', H.TWINS.precioDesde === 309000 && H.TIPOS_HABITACION.find((t) => t.id === 'estandar').precioDesde === 309000);

console.log('\n— Lo que Valentina lee —');
const wa = A.sistema(''), social = A.sistema('Instagram');
ok('trae la regla «TARIFA DE DICIEMBRE (NO LA OLVIDES)» con la Twins a $309.000 por noche', /TARIFA DE DICIEMBRE \(NO LA OLVIDES\)/.test(wa) && /Junior Suite Twins a \$309\.000 por noche, impuestos incluidos/.test(wa));
ok('para parejas, «habitación doble», 3 adultos y familias: la Twins es la PRIMERA opción', /habitación para 2 personas \(pareja, "habitación doble", "para dos"\), para 3 adultos o para una familia con niños, la PRIMERA y principal opción/.test(wa));
ok('en esas fechas no ofrece la Ubique, no habla de tarifa de semana vs fin de semana y no menciona el día', /NO ofrezcas la Estándar Ubique, NO hables de tarifas distintas entre semana y fin de semana y NO menciones el día de la semana/.test(wa));
ok('la regla general de 2 personas dice que en esas fechas NO aplica (excepción)', /EXCEPCIÓN: si la llegada cae del 15 de diciembre de 2026 al 6 de enero de 2027 NO uses esta regla/.test(wa) && /"habitación doble"/.test(wa));
ok('ya no queda la regla vieja «2 personas sin niños sigue la regla de siempre»', !/Para 2 personas sin niños sigue la regla de siempre/.test(wa));
ok('pide revisar el cupo («twinsDisponibles») y, si se agotó, ofrecer la Estándar al mismo precio', /twinsDisponibles/.test(wa) && /ofrécele la Habitación Estándar al mismo precio \(\$309\.000\)/.test(wa));
ok('manda NO calcular el día de la semana de memoria y trae el calendario', /NUNCA lo calcules de memoria/.test(wa) && (wa.match(/CALENDARIO · /g) || []).length >= 4);
ok('lo mismo para Instagram y Messenger', /TARIFA DE DICIEMBRE \(NO LA OLVIDES\)/.test(social) && /CALENDARIO · /.test(social));
ok('los prompts no tienen huecos ("undefined")', !/undefined|\[object/.test(wa + social));

console.log('\n— Cupo de la Twins —');
const reservar = (cuando, habitacion, { estado = 'pagado', cantidad = 1, fuente = 'bot' } = {}) => reservasStore.crear({ waId: '573009990001', celular: '573009990001', nombre: 'Prueba', habitacion, personas: 2, cantidad, checkIn: cuando[0], checkOut: cuando[1], monto: 309000, estado, fuente });
ok('sin reservas hay 5 Twins por noche (CUPO_TWINS)', C.twinsDisponiblesEn('2026-12-28') === 5 && C.nocheSinCupoTwins('2026-12-28', '2026-12-29', 1) === null);
for (let i = 0; i < 4; i++) reservar(['2026-12-27', '2026-12-30'], 'Junior Suite Twins');
ok('con 4 reservadas (27 al 30) queda 1 por noche', C.twinsDisponiblesEn('2026-12-27') === 1 && C.twinsDisponiblesEn('2026-12-29') === 1 && C.twinsDisponiblesEn('2026-12-30') === 5);
ok('piden 1: cabe; piden 2: no cabe y dice cuál noche', C.nocheSinCupoTwins('2026-12-28', '2026-12-29', 1) === null && C.nocheSinCupoTwins('2026-12-28', '2026-12-29', 2) === '2026-12-28');
reservar(['2026-12-28', '2026-12-29'], 'Junior Suite Navidad', { estado: 'pendiente_hotel', fuente: 'vikbooking-booking' });
ok('una reserva de Vik («Junior Suite Navidad») también cuenta: el 28 ya no quedan', C.twinsDisponiblesEn('2026-12-28') === 0 && C.twinsDisponiblesEn('2026-12-27') === 1);
reservar(['2026-12-28', '2026-12-29'], 'Junior Suite Twins', { estado: 'cancelado' });
reservar(['2026-12-28', '2026-12-29'], 'Junior Suite Twins', { estado: 'en_proceso' });
reservar(['2026-12-28', '2026-12-29'], 'Habitación Estándar');
ok('canceladas, en proceso y otras habitaciones NO cuentan', C.twinsDisponiblesEn('2026-12-28') === 0 && C.twinsDisponiblesEn('2026-12-27') === 1);
for (let i = 0; i < 3; i++) { reservar(['2027-01-02', '2027-01-03'], 'Junior Suite Twins', { estado: 'cancelado' }); reservar(['2027-01-02', '2027-01-03'], 'Junior Suite Twins', { estado: 'en_proceso' }); }
ok('seis canceladas o en proceso en una noche no le restan nada (siguen las 5 Twins)', C.twinsDisponiblesEn('2027-01-02') === 5 && C.nocheSinCupoTwins('2027-01-02', '2027-01-03', 5) === null);
ok('una estadía de varias noches se bloquea en la primera noche sin cupo (27 al 30 → el 28)', C.nocheSinCupoTwins('2026-12-27', '2026-12-30', 1) === '2026-12-28');

const wa1 = '573009990002', wa2 = '573009990003';
store.registrarEntrante({ waId: wa1, nombre: 'Xiomara Prueba', tipo: 'text', texto: 'precio habitacion doble 28 de dic' });
store.registrarEntrante({ waId: wa2, nombre: 'Otra Prueba', tipo: 'text', texto: 'hola' });
const nRes = reservasStore.listar().length;
let r = await silencio(() => A.ejecutarHerramienta(wa1, 'reservar_pago_en_hotel', { tipoHabitacion: 'Junior Suite Twins', checkIn: '2026-12-28', checkOut: '2026-12-29', personas: 2 }));
ok('sin cupo: la herramienta rechaza la Twins y le dice a Valentina que ofrezca la Estándar a $309.000', r.ok === false && /ya no tiene cupo para la noche del 2026-12-28/.test(r.error) && /Habitación Estándar \(\$309\.000 la noche/.test(r.error) && reservasStore.listar().length === nRes, JSON.stringify(r));
r = await silencio(() => A.ejecutarHerramienta(wa1, 'reservar_pago_en_hotel', { tipoHabitacion: 'Habitación Estándar', checkIn: '2026-12-28', checkOut: '2026-12-29', personas: 2 }));
ok('...y la Estándar de esas mismas fechas sí se reserva', r.ok === true && r.monto === 309000, JSON.stringify(r));
r = await silencio(() => A.ejecutarHerramienta(wa2, 'reservar_pago_en_hotel', { tipoHabitacion: 'Junior Suite Twins', checkIn: '2026-12-31', checkOut: '2027-01-02', personas: 2, nombre: 'Otra Prueba' }));
ok('otras fechas con cupo: la Twins se reserva a $309.000 por noche (2 noches = $618.000)', r.ok === true && r.monto === 618000 && r.tipo === 'Junior Suite Twins', JSON.stringify(r));
r = await silencio(() => A.ejecutarHerramienta(wa2, 'reservar_pago_en_hotel', { tipoHabitacion: 'Junior Suite Twins', checkIn: '2026-11-20', checkOut: '2026-11-21', personas: 2, nombre: 'Otra Prueba' }));
ok('fuera de la temporada la Twins sigue bloqueada (promoción solo del 15-dic al 6-ene)', r.ok === false && /promoción válida solo para llegadas/.test(r.error), JSON.stringify(r));

console.log('\n— consultar_disponibilidad —');
let d = await A.ejecutarHerramienta(wa1, 'consultar_disponibilidad', { fecha: '2026-12-28' });
ok('dice que el 28 de diciembre es lunes (lo calcula el código) y cuántas Twins quedan', d.diaSemana === 'lunes' && d.twinsDisponibles === 0 && /Estándar al mismo precio/.test(d.nota_twins), JSON.stringify(d).slice(0, 300));
d = await A.ejecutarHerramienta(wa1, 'consultar_disponibilidad', { fecha: '2026-12-31' });
ok('otra noche de diciembre: dice el día y las Twins que quedan (con el cupo de arriba)', d.diaSemana === 'jueves' && d.twinsDisponibles === 4, JSON.stringify(d).slice(0, 300));
d = await A.ejecutarHerramienta(wa1, 'consultar_disponibilidad', { fecha: '2026-11-10' });
ok('fuera de la temporada: solo el día de la semana, sin hablar de Twins', d.diaSemana === 'martes' && d.twinsDisponibles === undefined, JSON.stringify(d).slice(0, 300));
d = await A.ejecutarHerramienta(wa1, 'consultar_disponibilidad', {});
ok('sin fecha: usa hoy (Colombia) y dice su día de la semana', d.diaSemana === F.diaSemana(F.diaColombia()), JSON.stringify(d).slice(0, 200));
d = await A.ejecutarHerramienta(wa1, 'consultar_disponibilidad', { fecha: 'mañana' });
ok('una fecha mal escrita no rompe la herramienta', typeof d.diaSemana === 'string');

[graphSrv, resendSrv].forEach((s) => s.close());
console.log(fallos === 0 ? '\n🎉 Todas las verificaciones pasaron.' : `\n💥 ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
