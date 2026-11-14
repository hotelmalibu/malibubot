// probar-cierres-no-son-reservas.js — las «Habitación cerrada» de Vik no se cuentan como reservas. node scripts/probar-cierres-no-son-reservas.js
process.env.VIK_SYNC_URL = 'http://127.0.0.1:1/x'; process.env.VIK_SYNC_KEY = 'k'; process.env.RESEND_API_KEY = ''; process.env.WHATSAPP_TOKEN = '';
const { esCierreVik } = await import('../src/vikbooking/sincronizar.js');
const { reservasStore } = await import('../src/almacen/reservas.js');
const { resumenOrigenes } = await import('../src/datos/origenes.js');

let ok = 0, mal = 0;
const prueba = (n, c) => { if (c) { ok++; console.log('  ✓', n); } else { mal++; console.log('  ✗', n); } };

console.log('Reconocer un cierre');
const cierre = { id: 4545, status: 'confirmed', name: '', email: '', phone: '', total: 0, ota: '', channel: '' };
prueba('cierre con el archivo viejo (por su forma)', esCierreVik(cierre));
prueba('cierre con el archivo nuevo (closure=1)', esCierreVik({ ...cierre, closure: 1, name: 'x' }));
prueba('archivo nuevo dice closure=0: NO es cierre aunque venga vacío', !esCierreVik({ ...cierre, closure: 0 }));
prueba('reserva web normal no es cierre', !esCierreVik({ id: 1, status: 'confirmed', name: 'Ana Pérez', email: 'a@x.co', phone: '3001112233', total: 309000, ota: '', channel: '' }));
prueba('reserva de Booking (sin celular) no es cierre', !esCierreVik({ id: 2, status: 'confirmed', name: 'Lina', email: 'l@guest.booking.com', phone: '', total: 250000, ota: '555', channel: 'booking.com_Booking.com' }));
prueba('reserva de Expedia sin datos pero con canal no es cierre', !esCierreVik({ id: 3, status: 'confirmed', name: '', email: '', phone: '', total: 0, ota: '', channel: 'expedia_A-Expedia' }));
prueba('orden en espera sin datos no es cierre', !esCierreVik({ ...cierre, status: 'standby' }));
prueba('orden cancelada sin datos no es cierre', !esCierreVik({ ...cierre, status: 'cancelled' }));

console.log('Quitar los cierres ya registrados');
const mk = (vikId, fuente, nombre) => reservasStore.crear({ nombre, estado: 'pagado', fuente, referenciaPago: `vik:${vikId}`, checkIn: '2026-11-14', checkOut: '2026-11-15', cantidad: 1 });
mk(4545, 'vikbooking', ''); mk(4546, 'vikbooking', ''); mk(4600, 'vikbooking', 'Ana'); mk(4601, 'vikbooking-booking', 'Lina');
reservasStore.crear({ nombre: 'Bot', estado: 'pagado', fuente: 'bot', referenciaPago: 'vik:4545', checkIn: '2026-11-14', checkOut: '2026-11-15' });
const quitadas = reservasStore.quitarVikPorIds([4545, 4546]);
prueba('quitó 2 cierres de Vik', quitadas === 2);
prueba('no tocó las reservas reales', reservasStore.listar().filter((r) => ['Ana', 'Lina'].includes(r.nombre)).length === 2);
prueba('no tocó una reserva del bot aunque comparta número', reservasStore.listar().some((r) => r.fuente === 'bot'));
const d = resumenOrigenes({});
prueba('Web directa ya no cuenta los cierres (1 = Ana)', d.origenes.find((o) => o.id === 'web').reservas === 1);

console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
