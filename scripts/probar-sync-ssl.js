// ============================================================
//  probar-sync-ssl.js — Prueba OFFLINE de la sincronizacion con Vik cuando la web del hotel
//  manda su certificado SSL SIN el intermedio (lo que paso el 13-oct-2026 y dejaba el panel en
//  «Vik Booking: Falló: fetch failed»).
//    node scripts/probar-sync-ssl.js
//  Necesita openssl (viene con Git). Crea una cadena de prueba (raiz -> intermedio -> hoja), levanta
//  servidores HTTPS locales y recorre: cadena completa, cadena incompleta, sin intermedio disponible,
//  autoridad desconocida, nombre equivocado, clave mala, respuesta que no es JSON, redireccion,
//  tiempo agotado, conexion rechazada y dominio inexistente. No toca produccion.
// ============================================================
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { X509Certificate } from 'crypto';
import https from 'https';
import net from 'net';

const ESTE = fileURLToPath(import.meta.url);

// ------------------------------------------------------------
//  Proceso padre: crea los certificados y lanza el hijo con la raiz de prueba como autoridad confiable
//  (NODE_EXTRA_CA_CERTS se lee al arrancar Node, por eso hace falta un proceso aparte).
// ------------------------------------------------------------
function crearCertificados(dir) {
  const env = { ...process.env, OPENSSL_CONF: join(dir, 'openssl.cnf') };
  writeFileSync(join(dir, 'openssl.cnf'), [
    '[req]', 'distinguished_name = dn', 'prompt = no', '[dn]', 'CN = prueba',
    '[ca]', 'basicConstraints = critical,CA:TRUE', 'keyUsage = critical,keyCertSign,cRLSign',
    '[inter]', 'basicConstraints = critical,CA:TRUE,pathlen:0', 'keyUsage = critical,keyCertSign,cRLSign',
    '[hoja]', 'basicConstraints = CA:FALSE', 'keyUsage = digitalSignature,keyEncipherment', 'extendedKeyUsage = serverAuth', 'subjectAltName = DNS:localhost,IP:127.0.0.1',
    '[hoja_otro]', 'basicConstraints = CA:FALSE', 'keyUsage = digitalSignature,keyEncipherment', 'extendedKeyUsage = serverAuth', 'subjectAltName = DNS:otro.test',
    '',
  ].join('\n'));
  const o = (...args) => execFileSync('openssl', args, { cwd: dir, env, stdio: 'pipe' });
  const raiz = (nombre, cn) => o('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${nombre}.key`, '-out', `${nombre}.pem`, '-days', '2', '-subj', `/CN=${cn}`, '-extensions', 'ca');
  const firmada = (nombre, cn, emisor, extension) => {
    o('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${nombre}.key`, '-out', `${nombre}.csr`, '-subj', `/CN=${cn}`);
    o('x509', '-req', '-in', `${nombre}.csr`, '-CA', `${emisor}.pem`, '-CAkey', `${emisor}.key`, '-CAcreateserial', '-out', `${nombre}.pem`, '-days', '2', '-extfile', 'openssl.cnf', '-extensions', extension);
  };
  raiz('raiz', 'Raiz de prueba');
  firmada('inter', 'Intermedio de prueba', 'raiz', 'inter');
  firmada('hoja', 'localhost', 'inter', 'hoja');
  firmada('hoja-otro', 'otro.test', 'inter', 'hoja_otro');
  raiz('otra-raiz', 'Otra raiz de prueba (desconocida)');
  firmada('otro-inter', 'Otro intermedio de prueba', 'otra-raiz', 'inter');
  firmada('otra-hoja', 'localhost', 'otro-inter', 'hoja');
  writeFileSync(join(dir, 'extra.pem'), Buffer.concat([readFileSync(join(dir, 'raiz.pem')), readFileSync(join(dir, 'inter.pem'))]));
}

if (process.argv[2] !== '--hijo') {
  try { execFileSync('openssl', ['version'], { stdio: 'pipe' }); } catch {
    console.log('⚠️  Prueba omitida: hace falta openssl para crear los certificados de prueba.');
    process.exit(0);
  }
  const dir = mkdtempSync(join(tmpdir(), 'malibubot-ssl-'));
  let codigo = 1;
  try {
    crearCertificados(dir);
    const r = spawnSync(process.execPath, ['--no-warnings', ESTE, '--hijo', dir], {
      stdio: 'inherit',
      env: { ...process.env, NODE_EXTRA_CA_CERTS: join(dir, 'raiz.pem') },
    });
    codigo = r.status ?? 1;
  } catch (err) {
    console.error('❌ No pude crear los certificados de prueba:', String(err.stderr || err.message));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(codigo);
}

// ------------------------------------------------------------
//  Proceso hijo: servidores HTTPS falsos + la sincronizacion real
// ------------------------------------------------------------
const dir = process.argv[3];
const leer = (nombre) => readFileSync(join(dir, nombre));
const CHAIN = (...nombres) => Buffer.concat(nombres.map((n) => Buffer.concat([leer(n), Buffer.from('\n')])));

// Entorno ANTES de importar los modulos (config lee el entorno al cargar).
Object.assign(process.env, { VIK_SYNC_URL: 'https://127.0.0.1:1/malibubot-sync.php', VIK_SYNC_KEY: 'clave-de-prueba', VIK_SYNC_DESDE: '2026-01-01', RESEND_API_KEY: '', WHATSAPP_TOKEN: '' });
for (const k of ['DATABASE_URL', 'VIK_SYNC_CA_EXTRA', 'VIK_SYNC_TIMEOUT_MS']) delete process.env[k];

// La web falsa: devuelve 205 reservas (dos paginas) y, como el firewall del hotel, responde 465 si no hay User-Agent.
let modo = 'ok';
let peticiones = [];
const ordenes = Array.from({ length: 205 }, (_, i) => ({
  id: i + 1,
  checkin: '2026-12-20',
  checkout: '2026-12-22',
  status: 'confirmed',
  ts: 1700000000, // vieja: no dispara correos a recepcion
  name: `Cliente ${i + 1}`,
  phone: '',
  channel: i % 2 ? 'Booking.com' : '',
  total: 618000,
  rooms: [{ name: 'Habitación Estándar', adults: 2, children: 0 }],
}));
const web = (req, res) => {
  const url = new URL(req.url, 'https://x');
  peticiones.push({ ua: req.headers['user-agent'] || '', clave: req.headers['x-malibubot-key'] || '' });
  if (!req.headers['user-agent']) { res.statusCode = 465; res.setHeader('Content-Type', 'text/html'); return res.end('<html><title>Access Denied</title></html>'); }
  if (modo === 'lento') return; // nunca contesta
  if (modo === 'html') { res.setHeader('Content-Type', 'text/html'); return res.end('<html>hola</html>'); }
  if (modo === 'redirige') { res.statusCode = 301; res.setHeader('Location', 'https://otra.example/x'); return res.end(); }
  res.setHeader('Content-Type', 'application/json');
  if (req.headers['x-malibubot-key'] !== 'clave-de-prueba') { res.statusCode = 403; return res.end(JSON.stringify({ ok: false, error: 'Clave incorrecta.' })); }
  const desde = parseInt(url.searchParams.get('desde_id') || '0', 10);
  const limite = parseInt(url.searchParams.get('limite') || '200', 10);
  const pagina = ordenes.filter((o) => o.id > desde).slice(0, limite);
  res.end(JSON.stringify({ ok: true, ordenes: pagina, siguiente: pagina.length ? pagina[pagina.length - 1].id : desde }));
};
const servidores = [];
const levantar = (cert, key) => new Promise((ok) => {
  const s = https.createServer({ cert, key }, web);
  servidores.push(s);
  s.listen(0, '127.0.0.1', () => ok(`https://127.0.0.1:${s.address().port}/malibubot-sync.php`));
});
// Lo que manda el hosting hoy: la hoja + un intermedio que NO corresponde (como los de Sectigo del 13-oct-2026).
const INCOMPLETA = await levantar(CHAIN('hoja.pem', 'otro-inter.pem'), leer('hoja.key'));
const COMPLETA = await levantar(CHAIN('hoja.pem', 'inter.pem'), leer('hoja.key'));
const NOMBRE_EQUIVOCADO = await levantar(CHAIN('hoja-otro.pem', 'otro-inter.pem'), leer('hoja-otro.key'));
const AUTORIDAD_DESCONOCIDA = await levantar(CHAIN('otra-hoja.pem', 'otro-inter.pem'), leer('otra-hoja.key'));

const { config } = await import('../src/config.js');
const { sincronizarConVik, estadoSync, describirErrorDeRed, intermediosConocidos } = await import('../src/vikbooking/sincronizar.js');

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };
const EXTRA = join(dir, 'extra.pem');
const CODIGOS_DE_CADENA = ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'];

/** Corre la sincronizacion real (sin el ruido de los console.log) contra la web indicada. */
async function sincronizar(url, { caExtra = '', modoWeb = 'ok', timeoutMs = 30000 } = {}) {
  config.vik.syncUrl = url;
  config.vik.caExtra = caExtra;
  config.vik.syncTimeoutMs = timeoutMs;
  modo = modoWeb;
  peticiones = [];
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try { return { estado: await sincronizarConVik(), error: null, peticiones }; } catch (err) { return { estado: estadoSync(), error: err.message, peticiones }; } finally { console.log = log; console.warn = warn; }
}

// ============================================================
console.log('— El problema real —');
const e0 = await fetch(INCOMPLETA).then(() => null, (e) => e);
ok('con el certificado incompleto, fetch falla igual que en producción («fetch failed»)', e0?.message === 'fetch failed' && CODIGOS_DE_CADENA.includes(e0.cause?.code), `${e0?.message} / ${e0?.cause?.code}`);
const e1 = await fetch(COMPLETA).then((r) => r.status, (e) => e.message);
ok('con la cadena completa, fetch sí conecta', e1 === 403, String(e1));

// ============================================================
console.log('\n— Certificados intermedios guardados —');
const guardados = intermediosConocidos();
const rapid = guardados.map((pem) => { try { return new X509Certificate(pem); } catch { return null; } }).find((c) => c && c.subject.includes('RapidSSL TLS RSA CA G1'));
ok('el intermedio de RapidSSL está en src/vikbooking/certificados y se puede leer', !!rapid);
ok('ese intermedio no está vencido (vence el 2-nov-2027: al llegar la fecha hay que cambiarlo, ver LEEME.md)', !!rapid && new Date(rapid.validTo) > new Date(), rapid?.validTo);
ok('es un certificado de autoridad (CA:TRUE), no una clave', !!rapid && rapid.ca === true && guardados.every((pem) => !pem.includes('PRIVATE KEY')));

// ============================================================
console.log('\n— Sincronización con Vik —');
let r = await sincronizar(COMPLETA);
ok('cadena completa: lee las 205 reservas en 2 páginas, sin usar el plan B', !r.error && r.estado.leidas === 205 && r.estado.nuevas === 205 && r.estado.cadenaPropia === false && r.peticiones.length === 2, JSON.stringify([r.error, r.estado.leidas, r.estado.nuevas, r.estado.cadenaPropia, r.peticiones.length]));
ok('manda siempre User-Agent (el firewall de la web rechaza con 465 las peticiones sin él) y la clave', r.peticiones.length > 0 && r.peticiones.every((p) => p.ua === 'MALIBUBOT-sync/1.0' && p.clave === 'clave-de-prueba'), JSON.stringify(r.peticiones[0]));

r = await sincronizar(INCOMPLETA, { caExtra: EXTRA });
ok('certificado incompleto: se arregla solo con el intermedio guardado y lee las 205 reservas', !r.error && r.estado.leidas === 205 && r.estado.error === '', String(r.error));
ok('...avisa que usó el plan B (el panel muestra el aviso) y no repite lo ya importado (idempotente)', r.estado.cadenaPropia === true && r.estado.nuevas === 0, JSON.stringify([r.estado.cadenaPropia, r.estado.nuevas]));
ok('...y la segunda página va directa por el plan B (2 consultas, sin reintentar la normal)', r.peticiones.length === 2 && r.peticiones.every((p) => p.ua === 'MALIBUBOT-sync/1.0'), String(r.peticiones.length));

r = await sincronizar(INCOMPLETA);
ok('sin el intermedio disponible: falla con un mensaje claro sobre el certificado SSL', !!r.error && /certificado SSL/.test(r.error) && /intermedio/.test(r.error), String(r.error));
ok('...y no dice que usó el plan B', r.estado.cadenaPropia === false && r.estado.error === r.error);

r = await sincronizar(AUTORIDAD_DESCONOCIDA, { caExtra: EXTRA });
ok('una web con certificado de una autoridad DESCONOCIDA no se acepta (el plan B no desactiva la verificación)', !!r.error && /certificado SSL/.test(r.error) && r.estado.cadenaPropia === false, String(r.error));

r = await sincronizar(NOMBRE_EQUIVOCADO, { caExtra: EXTRA });
ok('con el plan B se sigue comprobando el nombre del dominio (certificado de otro nombre → error)', !!r.error && /no corresponde al dominio/.test(r.error), String(r.error));

const claveBuena = config.vik.syncKey;
config.vik.syncKey = 'clave-equivocada';
r = await sincronizar(INCOMPLETA, { caExtra: EXTRA });
config.vik.syncKey = claveBuena;
ok('clave equivocada (por el plan B): muestra el mensaje de la web', r.error === 'Clave incorrecta.', String(r.error));

r = await sincronizar(INCOMPLETA, { caExtra: EXTRA, modoWeb: 'html' });
ok('respuesta que no es JSON: lo dice', !!r.error && /no es JSON/.test(r.error), String(r.error));

r = await sincronizar(INCOMPLETA, { caExtra: EXTRA, modoWeb: 'redirige' });
ok('la web redirige a otra dirección: dice a cuál', !!r.error && /redirige a https:\/\/otra\.example\/x/.test(r.error), String(r.error));

r = await sincronizar(COMPLETA, { modoWeb: 'lento', timeoutMs: 700 });
ok('tiempo agotado (conexión normal): mensaje claro', !!r.error && /no respondió a tiempo/.test(r.error), String(r.error));
r = await sincronizar(INCOMPLETA, { caExtra: EXTRA, modoWeb: 'lento', timeoutMs: 700 });
ok('tiempo agotado (plan B): mensaje claro', !!r.error && /no respondió a tiempo/.test(r.error), String(r.error));

const puertoCerrado = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
r = await sincronizar(`https://127.0.0.1:${puertoCerrado}/malibubot-sync.php`, { caExtra: EXTRA });
ok('conexión rechazada: mensaje claro y sin plan B', !!r.error && /cortó la conexión/.test(r.error) && r.estado.cadenaPropia === false, String(r.error));

r = await sincronizar('https://no-existe.invalid/malibubot-sync.php', { caExtra: EXTRA });
ok('dominio que no existe: mensaje claro', !!r.error && /No se encontró el dominio/.test(r.error), String(r.error));

// ============================================================
console.log('\n— Textos de error —');
const err = (code, message = 'fetch failed', name = 'TypeError') => Object.assign(new Error(message), { name, cause: { code } });
ok('certificado vencido', /vencido/.test(describirErrorDeRed(err('CERT_HAS_EXPIRED'))));
ok('error desconocido conserva el código para poder investigarlo', describirErrorDeRed(err('UND_ERR_SOCKET')) === 'fetch failed (UND_ERR_SOCKET)', describirErrorDeRed(err('UND_ERR_SOCKET')));
ok('sin código, queda el mensaje tal cual', describirErrorDeRed(new Error('algo raro')) === 'algo raro');

for (const s of servidores) s.close();
console.log(fallos === 0 ? '\n🎉 Todas las verificaciones pasaron.' : `\n💥 ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
