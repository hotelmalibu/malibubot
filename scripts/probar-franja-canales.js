// ============================================================
//  probar-franja-canales.js — Prueba OFFLINE de los numeros de la franja del Dashboard
//  «Noches reservadas por canal» (los da resumenOrigenes, el mismo calculo de «Reservas por canal»).
//  Noches = noches de habitacion: una reserva de 2 habitaciones por 3 noches suma 6.
//    node scripts/probar-franja-canales.js
//  Sin base de datos, WhatsApp ni correo reales.
// ============================================================
delete process.env.DATABASE_URL;

const { reservasStore } = await import('../src/almacen/reservas.js');
const { resumenOrigenes, origenDe } = await import('../src/datos/origenes.js');

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };

// Mediodia de Colombia (17:00 UTC) del dia indicado: el dia no cambia con la zona horaria.
const dia = (iso) => Date.parse(`${iso}T17:00:00Z`);
const ENTRADA = '2026-12-20';
const salida = (noches) => new Date(Date.parse(`${ENTRADA}T12:00:00Z`) + noches * 864e5).toISOString().slice(0, 10);
let n = 0;
const reserva = (fuente, estado, cantidad, creado, noches) => reservasStore.crear({
  nombre: `Huésped ${++n}`, celular: `57300${String(1000000 + n)}`, habitacion: 'Habitación Estándar', personas: 2, cantidad,
  checkIn: ENTRADA, checkOut: noches == null ? '' : salida(noches), monto: 309000 * cantidad, estado, fuente, creado: dia(creado),
});

// --- MALIBUBOT (bot y recepcion desde el chat)
reserva('bot', 'pagado', 2, '2026-10-10', 3);            // 2 habitaciones x 3 noches = 6
reserva('humano', 'pendiente_hotel', 1, '2026-10-12', 2); // 2
reserva('bot', 'pagado', 2, '2026-10-14', null);          // sin fecha de salida: cuenta 1 noche x 2 habitaciones = 2
reserva('bot', 'en_proceso', 5, '2026-10-12', 4);         // no cuenta: aun sin confirmar
reserva('bot', 'rechazado', 7, '2026-10-12', 2);          // no cuenta
// --- Web directa
reserva('vikbooking', 'pagado', 3, '2026-10-05', 2);      // 6
// --- Booking
reserva('vikbooking-booking', 'pendiente_hotel', 4, '2026-09-20', 5); // 20
reserva('vikbooking-booking', 'cancelado', 9, '2026-09-21', 3);       // no cuenta
// --- Expedia
reserva('vikbooking-expedia', 'pagado', 1, '2026-10-14', 1); // 1
// --- Otros (manuales y canales sin identificar)
reserva('manual', 'pagado', 2, '2026-10-14', 2);             // 4
reserva('vikbooking-ota', 'pendiente_hotel', 1, '2025-12-30', 7); // 7 (del año pasado)

const noches = (r) => Object.fromEntries(r.origenes.map((o) => [o.id, o.noches]));
const hab = (r) => Object.fromEntries(r.origenes.map((o) => [o.id, o.habitaciones]));
const res = (r) => Object.fromEntries(r.origenes.map((o) => [o.id, o.reservas]));
const suma = (r) => r.origenes.reduce((s, o) => s + o.noches, 0);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('— Noches por canal —');
let r = resumenOrigenes({});
ok('todo el tiempo: cuenta las NOCHES DE HABITACIÓN de las confirmadas, por canal', igual(noches(r), { whatsapp: 10, web: 6, booking: 20, expedia: 1, otros: 11 }), JSON.stringify(noches(r)));
ok('...una reserva de 2 habitaciones por 3 noches suma 6 (no 3 ni 2)', noches(resumenOrigenes({ desde: '2026-10-10', hasta: '2026-10-10' })).whatsapp === 6);
ok('...sin fecha de salida cuenta 1 noche por habitación', noches(resumenOrigenes({ desde: '2026-10-14', hasta: '2026-10-14' })).whatsapp === 2);
ok('...no cuenta las que están en proceso, rechazadas ni canceladas', suma(r) === 48, String(suma(r)));
ok('...las reservas y las habitaciones siguen calculándose aparte', igual(res(r), { whatsapp: 3, web: 1, booking: 1, expedia: 1, otros: 2 }) && igual(hab(r), { whatsapp: 5, web: 3, booking: 4, expedia: 1, otros: 3 }), JSON.stringify([res(r), hab(r)]));

r = resumenOrigenes({ desde: '2026-10-01', hasta: '2026-10-14' });
ok('este mes (por fecha en que se hizo la reserva): deja fuera septiembre y 2025', igual(noches(r), { whatsapp: 10, web: 6, booking: 0, expedia: 1, otros: 4 }), JSON.stringify(noches(r)));

r = resumenOrigenes({ desde: '2026-10-14', hasta: '2026-10-14' });
ok('hoy: solo lo reservado ese día', igual(noches(r), { whatsapp: 2, web: 0, booking: 0, expedia: 1, otros: 4 }), JSON.stringify(noches(r)));

r = resumenOrigenes({ desde: '2026-01-01', hasta: '2026-10-14' });
ok('este año: no incluye lo reservado en 2025', noches(r).otros === 4 && suma(r) === 41, JSON.stringify(noches(r)));

r = resumenOrigenes({ desde: '2027-01-01', hasta: '2027-12-31' });
ok('un periodo sin reservas da ceros en todos los canales', suma(r) === 0 && r.origenes.length === 5, JSON.stringify(noches(r)));

console.log('\n— Canal de cada reserva —');
ok('bot y recepción → MALIBUBOT; Vik → web / Booking / Expedia; manuales y OTA sin identificar → Otros',
  origenDe({ fuente: 'bot' }) === 'whatsapp' && origenDe({ fuente: 'humano' }) === 'whatsapp' && origenDe({ fuente: 'vikbooking' }) === 'web' &&
  origenDe({ fuente: 'vikbooking-booking' }) === 'booking' && origenDe({ fuente: 'vikbooking-expedia' }) === 'expedia' &&
  origenDe({ fuente: 'manual' }) === 'otros' && origenDe({ fuente: 'vikbooking-ota' }) === 'otros');

console.log(fallos === 0 ? '\n🎉 Todas las verificaciones pasaron.' : `\n💥 ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
