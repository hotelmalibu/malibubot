// ============================================================
//  probar-franja-canales.js — Prueba OFFLINE de los numeros de la franja del Dashboard
//  «Habitaciones reservadas por canal» (los da resumenOrigenes, el mismo calculo de «Reservas por canal»).
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
let n = 0;
const reserva = (fuente, estado, cantidad, creado) => reservasStore.crear({
  nombre: `Huésped ${++n}`, celular: `57300${String(1000000 + n)}`, habitacion: 'Habitación Estándar', personas: 2, cantidad,
  checkIn: '2026-12-20', checkOut: '2026-12-22', monto: 309000 * cantidad, estado, fuente, creado: dia(creado),
});

// --- MALIBUBOT (bot y recepcion desde el chat)
reserva('bot', 'pagado', 2, '2026-10-10');
reserva('humano', 'pendiente_hotel', 1, '2026-10-12');
reserva('bot', 'en_proceso', 5, '2026-10-12');   // no cuenta: aun sin confirmar
reserva('bot', 'rechazado', 7, '2026-10-12');    // no cuenta
// --- Web directa
reserva('vikbooking', 'pagado', 3, '2026-10-05');
// --- Booking
reserva('vikbooking-booking', 'pendiente_hotel', 4, '2026-09-20');
reserva('vikbooking-booking', 'cancelado', 9, '2026-09-21'); // no cuenta
// --- Expedia
reserva('vikbooking-expedia', 'pagado', 1, '2026-10-14');
// --- Otros (manuales y canales sin identificar)
reserva('manual', 'pagado', 2, '2026-10-14');
reserva('vikbooking-ota', 'pendiente_hotel', 1, '2025-12-30');

const hab = (r) => Object.fromEntries(r.origenes.map((o) => [o.id, o.habitaciones]));
const res = (r) => Object.fromEntries(r.origenes.map((o) => [o.id, o.reservas]));
const suma = (r) => r.origenes.reduce((s, o) => s + o.habitaciones, 0);

console.log('— Habitaciones por canal —');
let r = resumenOrigenes({});
ok('todo el tiempo: cuenta las HABITACIONES (no las reservas) de las confirmadas, por canal', JSON.stringify(hab(r)) === JSON.stringify({ whatsapp: 3, web: 3, booking: 4, expedia: 1, otros: 3 }), JSON.stringify(hab(r)));
ok('...y las reservas aparte (una reserva puede tener varias habitaciones)', JSON.stringify(res(r)) === JSON.stringify({ whatsapp: 2, web: 1, booking: 1, expedia: 1, otros: 2 }), JSON.stringify(res(r)));
ok('no cuenta las que están en proceso, rechazadas ni canceladas', suma(r) === 14, String(suma(r)));

r = resumenOrigenes({ desde: '2026-10-01', hasta: '2026-10-14' });
ok('este mes (por fecha en que se hizo la reserva): deja fuera septiembre y 2025', JSON.stringify(hab(r)) === JSON.stringify({ whatsapp: 3, web: 3, booking: 0, expedia: 1, otros: 2 }), JSON.stringify(hab(r)));

r = resumenOrigenes({ desde: '2026-10-14', hasta: '2026-10-14' });
ok('hoy: solo lo reservado ese día', JSON.stringify(hab(r)) === JSON.stringify({ whatsapp: 0, web: 0, booking: 0, expedia: 1, otros: 2 }), JSON.stringify(hab(r)));

r = resumenOrigenes({ desde: '2026-01-01', hasta: '2026-10-14' });
ok('este año: no incluye lo reservado en 2025', hab(r).otros === 2 && suma(r) === 13, JSON.stringify(hab(r)));

r = resumenOrigenes({ desde: '2027-01-01', hasta: '2027-12-31' });
ok('un periodo sin reservas da ceros en todos los canales', suma(r) === 0 && r.origenes.length === 5, JSON.stringify(hab(r)));

console.log('\n— Canal de cada reserva —');
ok('bot y recepción → MALIBUBOT; Vik → web / Booking / Expedia; manuales y OTA sin identificar → Otros',
  origenDe({ fuente: 'bot' }) === 'whatsapp' && origenDe({ fuente: 'humano' }) === 'whatsapp' && origenDe({ fuente: 'vikbooking' }) === 'web' &&
  origenDe({ fuente: 'vikbooking-booking' }) === 'booking' && origenDe({ fuente: 'vikbooking-expedia' }) === 'expedia' &&
  origenDe({ fuente: 'manual' }) === 'otros' && origenDe({ fuente: 'vikbooking-ota' }) === 'otros');

console.log(fallos === 0 ? '\n🎉 Todas las verificaciones pasaron.' : `\n💥 ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
