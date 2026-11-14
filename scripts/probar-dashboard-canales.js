// probar-dashboard-canales.js — noches por mes y canal (gráfico del Dashboard) + filtro de reservas por día. node scripts/probar-dashboard-canales.js
import http from 'http';
process.env.ADMIN_PASSWORD = 'prueba-local';
process.env.ADMIN_USUARIO = '';
const { reservasStore } = await import('../src/almacen/reservas.js');
const { resumenOrigenes } = await import('../src/datos/origenes.js');
const { adminRouter } = await import('../src/admin/rutas.js');
const express = (await import('express')).default;

let ok = 0, mal = 0;
const prueba = (nombre, cond, extra = '') => { if (cond) { ok++; console.log('  ✓', nombre); } else { mal++; console.log('  ✗', nombre, extra); } };

// Fechas fijas (día Colombia = UTC-5, mediodía para no cruzar de día)
const ts = (iso) => new Date(iso + 'T17:00:00Z').getTime();
const hoyIso = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const anio = Number(hoyIso.slice(0, 4));
reservasStore.crear({ nombre: 'Ana', celular: '573001112233', estado: 'pagado', fuente: 'vikbooking-booking', checkIn: `${anio}-03-10`, checkOut: `${anio}-03-13`, cantidad: 2, creado: ts(`${anio}-03-02`) });   // 6 noches
reservasStore.crear({ nombre: 'Beto', estado: 'pagado', fuente: 'vikbooking-expedia', checkIn: `${anio}-03-20`, checkOut: `${anio}-03-21`, cantidad: 1, creado: ts(`${anio}-03-15`) });          // 1 noche
reservasStore.crear({ nombre: 'Caro', estado: 'pendiente_hotel', fuente: 'vikbooking', checkIn: `${anio}-04-01`, checkOut: `${anio}-04-03`, cantidad: 1, creado: ts(`${anio}-04-01`) });    // 2 noches
reservasStore.crear({ nombre: 'Dani', estado: 'en_proceso', fuente: 'bot', checkIn: `${anio}-03-05`, checkOut: `${anio}-03-06`, cantidad: 1, creado: ts(`${anio}-03-03`) });                // no confirmada
reservasStore.crear({ nombre: 'Hoy', celular: '573009998877', estado: 'pagado', fuente: 'bot', checkIn: `${anio + 1}-01-10`, checkOut: `${anio + 1}-01-12`, cantidad: 1 });               // creada ahora

console.log('Noches por mes y canal');
const d = resumenOrigenes({ anio });
prueba('mesesNoches tiene 12 meses', Array.isArray(d.mesesNoches) && d.mesesNoches.length === 12);
prueba('marzo Booking = 6 noches', d.mesesNoches[2].booking === 6, JSON.stringify(d.mesesNoches[2]));
prueba('marzo Expedia = 1 noche', d.mesesNoches[2].expedia === 1);
prueba('marzo: reserva en proceso no suma noches', d.mesesNoches[2].whatsapp === 0);
prueba('abril Web directa = 2 noches', d.mesesNoches[3].web === 2);
prueba('reservas por mes coinciden (marzo Booking = 1)', d.meses[2].booking === 1 && d.meses[2].expedia === 1);

const app = express(); app.use(express.json()); app.use('/admin', adminRouter);
const srv = await new Promise((r) => { const s = http.createServer(app); s.listen(0, () => r(s)); });
const base = `http://127.0.0.1:${srv.address().port}/admin/api/reservas`;
const pedir = async (qs = '') => (await (await fetch(base + qs)).json()).reservas;

console.log('Filtro de reservas por día');
const todas = await pedir();
prueba('sin filtro devuelve todas (5)', todas.length === 5, String(todas.length));
const marzo = await pedir(`?desde=${anio}-03-01&hasta=${anio}-03-31`);
prueba('marzo devuelve Ana, Beto y Dani', marzo.length === 3 && marzo.every((r) => ['Ana', 'Beto', 'Dani'].includes(r.nombre)), JSON.stringify(marzo.map((r) => r.nombre)));
const hoy = await pedir(`?desde=${hoyIso}&hasta=${hoyIso}`);
prueba('hoy devuelve solo la creada ahora', hoy.length === 1 && hoy[0].nombre === 'Hoy', JSON.stringify(hoy.map((r) => r.nombre)));
prueba('el celular viaja en la respuesta', hoy[0]?.celular === '573009998877');
const dia = await pedir(`?desde=${anio}-03-02&hasta=${anio}-03-02`);
prueba('un solo día exacto (2 de marzo)', dia.length === 1 && dia[0].nombre === 'Ana');
const solo = await pedir(`?desde=${anio}-04-01`);
prueba('solo «desde» funciona (abril en adelante)', solo.length === 2 && solo.some((r) => r.nombre === 'Caro'), JSON.stringify(solo.map((r) => r.nombre)));
const raro = await pedir('?desde=hola&hasta=x');
prueba('fechas inválidas se ignoran (devuelve todas)', raro.length === 5);
prueba('el canal sigue calculándose', marzo.find((r) => r.nombre === 'Ana').canal === 'Booking.com');

console.log('Filtro por canal y por tipo de fecha');
const nombres = (rs) => rs.map((r) => r.nombre).sort().join(',');
prueba('canal Booking = Ana', nombres(await pedir('?origen=booking')) === 'Ana');
prueba('canal Expedia = Beto', nombres(await pedir('?origen=expedia')) === 'Beto');
prueba('canal Web directa = Caro', nombres(await pedir('?origen=web')) === 'Caro');
prueba('canal MALIBUBOT = Dani y Hoy', nombres(await pedir('?origen=whatsapp')) === 'Dani,Hoy');
prueba('canal desconocido se ignora (todas)', (await pedir('?origen=zzz')).length === 5);
prueba('canal + fecha de creación (marzo, Booking)', nombres(await pedir(`?origen=booking&desde=${anio}-03-01&hasta=${anio}-03-31`)) === 'Ana');
prueba('canal + fecha que no cumple (abril, Booking) = ninguna', (await pedir(`?origen=booking&desde=${anio}-04-01&hasta=${anio}-04-30`)).length === 0);
prueba('check-in en marzo: Ana, Beto y Dani', nombres(await pedir(`?campo=checkin&desde=${anio}-03-01&hasta=${anio}-03-31`)) === 'Ana,Beto,Dani');
prueba('check-out el 21 de marzo: Beto', nombres(await pedir(`?campo=checkout&desde=${anio}-03-21&hasta=${anio}-03-21`)) === 'Beto');
prueba('check-in en marzo y canal Expedia: Beto', nombres(await pedir(`?campo=checkin&origen=expedia&desde=${anio}-03-01&hasta=${anio}-03-31`)) === 'Beto');
prueba('campo desconocido se trata como creación', nombres(await pedir(`?campo=zzz&desde=${anio}-03-02&hasta=${anio}-03-02`)) === 'Ana');

srv.close();
console.log(`\n${ok} bien, ${mal} mal`);
process.exit(mal ? 1 : 0);
