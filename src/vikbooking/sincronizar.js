// ============================================================
//  sincronizar.js — Lee las reservas directamente de Vik Booking.
//
//  La pasarela malibubot.php solo avisa cuando Vik la llama, y Vik no siempre
//  lo hace con las reservas de Booking.com / Expedia. Aqui MALIBUBOT consulta
//  cada pocos minutos el archivo malibubot-sync.php (instalado en la web del
//  hotel, ver vikbooking/malibubot-sync.php) y deja en el panel TODA reserva
//  que Vik tenga, incluidas las canceladas.
//
//  - Es idempotente: cada reserva se identifica por "vik:<id>".
//  - Conserva la fecha en que se hizo la reserva en Vik.
//  - No manda WhatsApp. Solo avisa por correo a recepcion de las NUEVAS de las
//    ultimas 36 h (lo anterior es historia, no se inunda la bandeja).
//  - Si el hosting manda el certificado SSL de la web sin su intermedio (paso el
//    13-oct-2026), reintenta con los intermedios de ./certificados/ (ver LEEME.md).
// ============================================================
import { readFileSync, readdirSync } from 'fs';
import https from 'https';
import { rootCertificates } from 'tls';
import { config } from '../config.js';
import { registrarDesdeSync } from './confirmada.js';
import { reservasStore } from '../almacen/reservas.js';

const ultimo = {
  activo: false,
  corriendo: false,
  ts: 0,
  duracionMs: 0,
  leidas: 0,
  omitidas: 0,
  quitadas: 0,
  nuevas: 0,
  actualizadas: 0,
  canceladas: 0,
  invalidas: 0,
  error: '',
  cadenaPropia: false, // la ultima lectura necesitó los intermedios guardados (la web manda su certificado incompleto)
  porCanal: {},
};

export function estadoSync() {
  return { ...ultimo, activo: !!config.vik.syncUrl, urlConfigurada: !!config.vik.syncUrl, claveConfigurada: !!config.vik.syncKey };
}

// ---- Conexion segura con la web del hotel ----
// Si el hosting instala el certificado SSL SIN su certificado intermedio, los navegadores lo completan solos pero
// Node no: la consulta falla con "fetch failed" (UNABLE_TO_VERIFY_LEAF_SIGNATURE). En ese caso se reintenta
// confiando en las raices de Node MAS los intermedios de ./certificados/: la verificacion sigue completa
// (cadena hasta una raiz de confianza y nombre del dominio); no se desactiva nada.
const ERRORES_DE_CADENA = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT']);
const DIR_INTERMEDIOS = new URL('./certificados/', import.meta.url);
const MAX_BYTES_RESPUESTA = 25 * 1024 * 1024;
let intermediosDelRepo = null;

const codigoDe = (err) => String(err?.cause?.code || err?.code || '');

/** Certificados intermedios conocidos: los .pem de ./certificados/ y, si existe, el archivo de VIK_SYNC_CA_EXTRA. */
export function intermediosConocidos() {
  if (!intermediosDelRepo) {
    intermediosDelRepo = [];
    try {
      for (const f of readdirSync(DIR_INTERMEDIOS).filter((n) => n.endsWith('.pem')).sort()) {
        intermediosDelRepo.push(readFileSync(new URL(f, DIR_INTERMEDIOS), 'utf8'));
      }
    } catch (err) {
      console.warn('[vik-sync] No pude leer los certificados intermedios:', err.message);
    }
  }
  const lista = [...intermediosDelRepo];
  if (config.vik.caExtra) {
    try { lista.push(readFileSync(config.vik.caExtra, 'utf8')); } catch (err) { console.warn('[vik-sync] No pude leer VIK_SYNC_CA_EXTRA:', err.message); }
  }
  return lista;
}

/**
 * Texto para el panel: que fallo, en palabras del dueño (fetch solo dice "fetch failed").
 * @param opts  { variable: nombre de la variable de Render con la direccion, timeoutMs: tiempo maximo usado }
 */
export function describirErrorDeRed(err, { variable = 'VIK_SYNC_URL', timeoutMs = config.vik.syncTimeoutMs } = {}) {
  const codigo = codigoDe(err);
  const nombre = err?.name || '';
  if (ERRORES_DE_CADENA.has(codigo)) return `No se pudo verificar el certificado SSL de la web (${codigo}): el hosting lo instaló sin su certificado intermedio.`;
  if (codigo === 'CERT_HAS_EXPIRED') return 'El certificado SSL de la web está vencido (CERT_HAS_EXPIRED).';
  if (codigo === 'ERR_TLS_CERT_ALTNAME_INVALID') return `El certificado SSL no corresponde al dominio de ${variable} (ERR_TLS_CERT_ALTNAME_INVALID).`;
  if (codigo === 'DEPTH_ZERO_SELF_SIGNED_CERT' || codigo === 'SELF_SIGNED_CERT_IN_CHAIN') return `La web usa un certificado SSL no confiable (${codigo}).`;
  if (codigo === 'ENOTFOUND' || codigo === 'EAI_AGAIN') return `No se encontró el dominio de ${variable} (${codigo}): revisa la dirección.`;
  if (codigo === 'ECONNREFUSED' || codigo === 'ECONNRESET') return `La web cortó la conexión (${codigo}).`;
  if (nombre === 'TimeoutError' || nombre === 'AbortError' || codigo === 'ETIMEDOUT' || codigo === 'UND_ERR_CONNECT_TIMEOUT') {
    return `La web no respondió a tiempo (más de ${Math.round(timeoutMs / 1000)} s).`;
  }
  const mensaje = String(err?.message || 'error desconocido');
  return codigo && !mensaje.includes(codigo) ? `${mensaje} (${codigo})` : mensaje;
}

async function pedirNormal(url, headers, timeoutMs) {
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  return { status: resp.status, ok: resp.ok, texto: await resp.text(), redirige: '' };
}

function pedirConIntermedios(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers,
      ca: [...rootCertificates, ...intermediosConocidos()],
      signal: AbortSignal.timeout(timeoutMs),
    }, (res) => {
      const partes = [];
      let bytes = 0;
      res.on('data', (trozo) => {
        bytes += trozo.length;
        if (bytes > MAX_BYTES_RESPUESTA) { req.destroy(new Error('La respuesta de la web es demasiado grande.')); return; }
        partes.push(trozo);
      });
      res.on('end', () => resolve({
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        texto: Buffer.concat(partes).toString('utf8'),
        redirige: res.headers.location || '',
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * GET a la web del hotel: primero la conexion normal; si el certificado SSL de la web llega incompleto,
 * reintenta con los intermedios guardados (ver arriba). `ctx.cadenaPropia` recuerda que ya hizo falta
 * (las siguientes peticiones van directo al plan B). Lanza un Error con un mensaje en español si no hay respuesta.
 * @returns {Promise<{status:number, ok:boolean, texto:string, redirige:string}>}
 */
export async function pedirWeb(url, headers, ctx = {}, { timeoutMs = config.vik.syncTimeoutMs, variable = 'VIK_SYNC_URL' } = {}) {
  let resp = null;
  if (!ctx.cadenaPropia) {
    try {
      resp = await pedirNormal(url, headers, timeoutMs);
    } catch (err) {
      if (!ERRORES_DE_CADENA.has(codigoDe(err)) || url.protocol !== 'https:') throw new Error(describirErrorDeRed(err, { variable, timeoutMs }));
    }
  }
  if (!resp) { // cadena incompleta (o ya se vio en esta lectura): se usan los intermedios guardados
    try {
      resp = await pedirConIntermedios(url, headers, timeoutMs);
      ctx.cadenaPropia = true;
    } catch (err) {
      const cadena = ERRORES_DE_CADENA.has(codigoDe(err));
      throw new Error(describirErrorDeRed(err, { variable, timeoutMs }) + (cadena ? ' El bot también lo intentó con sus certificados intermedios guardados (src/vikbooking/certificados).' : ''));
    }
  }
  return resp;
}

async function pedirPagina(desdeId, ctx) {
  const url = new URL(config.vik.syncUrl);
  url.searchParams.set('desde_id', String(desdeId));
  url.searchParams.set('limite', '200');
  // El firewall de la web responde 465 «Access Denied» a las peticiones SIN User-Agent (https.request no manda ninguno).
  const headers = { 'X-Malibubot-Key': config.vik.syncKey, Accept: 'application/json', 'User-Agent': 'MALIBUBOT-sync/1.0' };
  const resp = await pedirWeb(url, headers, ctx);

  let d;
  try { d = JSON.parse(resp.texto); } catch { d = null; }
  if (!resp.ok || !d || !d.ok) {
    const motivo = d?.error || `respuesta ${resp.status}${d ? '' : ' (no es JSON: ¿el archivo está en la ruta correcta?)'}${resp.redirige ? `; la web redirige a ${resp.redirige}` : ''}`;
    throw new Error(motivo);
  }
  return d;
}

/**
 * Trae las reservas de Vik Booking y las registra en el panel.
 * @returns {Promise<typeof ultimo>}
 */
export async function sincronizarConVik() {
  if (!config.vik.syncUrl) throw new Error('Falta VIK_SYNC_URL (la dirección de malibubot-sync.php).');
  if (!config.vik.syncKey) throw new Error('Falta VIK_SYNC_KEY (la clave de la sincronización).');
  if (ultimo.corriendo) throw new Error('Ya hay una sincronización en curso.');

  ultimo.corriendo = true;
  const inicio = Date.now();
  const cuenta = { leidas: 0, omitidas: 0, quitadas: 0, nuevas: 0, actualizadas: 0, canceladas: 0, invalidas: 0, porCanal: {} };
  const ctx = { cadenaPropia: false };
  try {
    let desdeId = 0;
    for (let pagina = 0; pagina < 60; pagina++) { // tope de seguridad: 12.000 reservas
      const d = await pedirPagina(desdeId, ctx);
      for (const o of d.ordenes || []) {
        cuenta.leidas++;
        if (String(o.checkin || '') && String(o.checkin) < config.vik.syncDesde) { cuenta.omitidas = (cuenta.omitidas || 0) + 1; continue; }
        const r = registrarDesdeSync(o);
        if (!r.ok) { cuenta.invalidas++; continue; }
        if (r.nuevo) cuenta.nuevas++;
        else if (r.estadoPrevio !== r.estado) cuenta.actualizadas++;
        if (r.estado === 'cancelado' && (r.nuevo || r.estadoPrevio !== 'cancelado')) cuenta.canceladas++;
        const canal = String(o.channel || '').trim() || 'web';
        cuenta.porCanal[canal] = (cuenta.porCanal[canal] || 0) + 1;
      }
      if (!d.ordenes || d.ordenes.length < 200 || d.siguiente <= desdeId) break;
      desdeId = d.siguiente;
    }
    cuenta.quitadas = reservasStore.purgarVikAnterioresA(config.vik.syncDesde);
    Object.assign(ultimo, cuenta, { error: '', cadenaPropia: ctx.cadenaPropia });
    if (cuenta.nuevas || cuenta.actualizadas) {
      console.log(`[vik-sync] ${cuenta.leidas} leídas · ${cuenta.nuevas} nuevas · ${cuenta.actualizadas} con cambio de estado`);
    }
  } catch (err) {
    ultimo.error = err.message;
    ultimo.cadenaPropia = ctx.cadenaPropia;
    console.warn('[vik-sync] No se pudo sincronizar:', err.message);
    throw err;
  } finally {
    ultimo.corriendo = false;
    ultimo.ts = Date.now();
    ultimo.duracionMs = ultimo.ts - inicio;
  }
  return estadoSync();
}

/** Programa la sincronizacion automatica (si hay VIK_SYNC_URL). */
export function programarSync() {
  if (!config.vik.syncUrl) return false;
  const correr = () => sincronizarConVik().catch(() => {});
  setTimeout(correr, 60 * 1000);
  setInterval(correr, config.vik.syncMinutos * 60 * 1000);
  console.log(`[vik-sync] Activa: cada ${config.vik.syncMinutos} min desde ${new URL(config.vik.syncUrl).host}`);
  return true;
}
