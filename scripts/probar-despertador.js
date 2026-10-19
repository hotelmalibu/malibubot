// ============================================================
//  probar-despertador.js — Prueba OFFLINE del «despertador» de la IA de Vik Booking:
//  cada pocos minutos MALIBUBOT llama a index.php?option=com_vikbooking&task=crontab para que
//  el contestador de mensajes de Booking (canal AI de e4jConnect) trabaje.
//    node scripts/probar-despertador.js
//  Usa una web falsa en local. No toca el hotel ni produccion.
// ============================================================
import http from 'http';

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// La web falsa del hotel: anota cada llamada; responde segun el modo. Como el firewall real, rechaza (465) lo que no trae User-Agent.
let modo = 'ok';
let llamadas = [];
const web = http.createServer((req, res) => {
  llamadas.push({ url: req.url, ua: req.headers['user-agent'] || '' });
  if (!req.headers['user-agent']) { res.statusCode = 465; return res.end('Access Denied'); }
  if (modo === 'bloqueo') { res.statusCode = 466; res.setHeader('Content-Type', 'text/html'); return res.end('<html>Access Denied</html>'); }
  if (modo === 'lento') return setTimeout(() => res.end(), 1200);
  res.statusCode = 200; // la tarea programada de Vik responde 200 sin cuerpo
  res.end();
});
await new Promise((r) => web.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${web.address().port}`;

// Entorno ANTES de importar los modulos (config lee el entorno al cargar).
Object.assign(process.env, { VIK_SYNC_URL: `${BASE}/malibubot-sync.php`, VIK_SYNC_KEY: 'clave-de-prueba' });
for (const k of ['DATABASE_URL', 'VIK_CRON_URL', 'VIK_CRON_ACTIVO', 'VIK_CRON_MIN', 'VIK_CRON_TIMEOUT_MS']) delete process.env[k];

const { config } = await import('../src/config.js');
const { urlDespertador, estadoDespertador, despertarVik, programarDespertador } = await import('../src/vikbooking/despertar.js');

/** Corre algo sin el ruido del log del modulo. */
async function callado(fn) {
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
}

console.log('— A qué dirección llama —');
ok('por defecto, la tarea programada de VikBooking en la misma web de VIK_SYNC_URL', urlDespertador() === `${BASE}/index.php?option=com_vikbooking&task=crontab`, urlDespertador());
config.vik.cronUrl = `${BASE}/otra-ruta?task=crontab`;
ok('VIK_CRON_URL tiene prioridad', urlDespertador() === `${BASE}/otra-ruta?task=crontab`);
config.vik.cronUrl = '';
config.vik.cronActivo = false;
ok('VIK_CRON_ACTIVO=false lo apaga', urlDespertador() === '' && estadoDespertador().activo === false && programarDespertador() === false);
config.vik.cronActivo = true;
const syncGuardada = config.vik.syncUrl;
config.vik.syncUrl = '';
ok('sin dirección de la web no hace nada', urlDespertador() === '' && programarDespertador() === false);
config.vik.syncUrl = syncGuardada;

console.log('\n— Una llamada —');
let e = await callado(() => despertarVik());
ok('llama a index.php?option=com_vikbooking&task=crontab con User-Agent y queda en verde', llamadas.length === 1 && /option=com_vikbooking&task=crontab$/.test(llamadas[0].url) && llamadas[0].ua === 'MALIBUBOT-cron/1.0' && e.ok === true && e.http === 200 && e.fallosSeguidos === 0 && e.llamadas === 1, JSON.stringify([llamadas, e]));
ok('el estado dice cuándo y cuánto tardó (para el panel)', e.ts > 0 && e.ms >= 0 && e.activo === true && e.cadaMin === 5 && e.error === '');

console.log('\n— Fallos —');
modo = 'bloqueo';
e = await callado(() => despertarVik());
ok('si el firewall bloquea (466) queda en rojo con un mensaje claro', e.ok === false && /466/.test(e.error) && /firewall/.test(e.error) && e.fallosSeguidos === 1, e.error);
e = await callado(() => despertarVik());
ok('los fallos seguidos se cuentan', e.fallosSeguidos === 2);
modo = 'ok';
e = await callado(() => despertarVik());
ok('cuando la web vuelve, se recupera y el contador vuelve a 0', e.ok === true && e.fallosSeguidos === 0 && e.error === '');
config.vik.syncUrl = 'http://no-existe.invalid/malibubot-sync.php';
e = await callado(() => despertarVik());
ok('dominio que no existe: mensaje claro que nombra la variable', e.ok === false && /No se encontró el dominio de VIK_CRON_URL/.test(e.error), e.error);
config.vik.syncUrl = syncGuardada;

console.log('\n— Sin solaparse y programado —');
modo = 'lento';
llamadas = [];
await callado(() => Promise.all([despertarVik(), despertarVik(), despertarVik()]));
ok('tres llamadas a la vez hacen una sola petición (nunca se solapan)', llamadas.length === 1, String(llamadas.length));
modo = 'ok';
llamadas = [];
const programado = await callado(async () => { const r = programarDespertador({ primeraVezMs: 50, cadaMs: 250 }); await espera(1100); return r; });
ok('programado: llama solo, una y otra vez', programado === true && llamadas.length >= 3, String(llamadas.length));

web.close();
console.log(fallos === 0 ? '\n🎉 Todas las verificaciones pasaron.' : `\n💥 ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
