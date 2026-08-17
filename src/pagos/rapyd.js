// ============================================================
//  rapyd.js — Integracion con RAPYD (pagos).
//
//  - crearCheckout(): crea una pagina de pago hospedada y devuelve su URL.
//  - verificarWebhook(): valida la firma de los webhooks entrantes de RAPYD.
//
//  Firma de RAPYD (HMAC-SHA256):
//    to_sign = metodo + urlPath + salt + timestamp + accessKey + secretKey + body
//    firma   = base64( hex( hmac_sha256(to_sign, secretKey) ) )
//  Doc: https://docs.rapyd.net (Message Signing).
// ============================================================
import crypto from 'crypto';
import { config } from '../config.js';

function activo() {
  return !!(config.rapyd.accessKey && config.rapyd.secretKey);
}

function salt() {
  return crypto.randomBytes(8).toString('hex');
}

function firmar(metodo, urlPath, s, ts, body) {
  const { accessKey, secretKey } = config.rapyd;
  const toSign = metodo.toLowerCase() + urlPath + s + ts + accessKey + secretKey + body;
  const hash = crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
  return Buffer.from(hash).toString('base64');
}

async function pedir(metodo, urlPath, cuerpo) {
  const body = cuerpo ? JSON.stringify(cuerpo) : '';
  const s = salt();
  const ts = Math.round(Date.now() / 1000).toString();
  const firma = firmar(metodo, urlPath, s, ts, body);

  const resp = await fetch(config.rapyd.baseUrl + urlPath, {
    method: metodo.toUpperCase(),
    headers: {
      'Content-Type': 'application/json',
      access_key: config.rapyd.accessKey,
      salt: s,
      timestamp: ts,
      signature: firma,
    },
    body: metodo.toLowerCase() === 'get' ? undefined : body,
  });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok || datos?.status?.status !== 'SUCCESS') {
    const msg = datos?.status?.message || `HTTP ${resp.status}`;
    console.error('[rapyd] Error:', metodo, urlPath, msg, JSON.stringify(datos?.status || {}));
    throw new Error('RAPYD: ' + msg);
  }
  return datos.data;
}

/**
 * Crea una pagina de pago (checkout) hospedada por RAPYD.
 * @param {object} p { monto, referencia, descripcion, metadata }
 * @returns {Promise<{redirectUrl:string, checkoutId:string}|null>}
 */
export async function crearCheckout({ monto, referencia, descripcion, metadata }) {
  if (!activo()) return null;
  const data = await pedir('post', '/v1/checkout', {
    amount: Number(monto),
    currency: config.rapyd.moneda,
    country: config.rapyd.pais,
    merchant_reference_id: String(referencia),
    complete_payment_url: `${config.publicUrl}/pago/gracias`,
    cancel_payment_url: `${config.publicUrl}/pago/cancelado`,
    description: descripcion || 'Reserva Hotel Malibú',
    metadata: metadata || {},
  });
  return { redirectUrl: data.redirect_url, checkoutId: data.id };
}

/**
 * Consulta el estado de un checkout que creamos (para saber si ya se pagó,
 * sin depender del webhook de la cuenta — que puede estar usado por la web).
 * @returns {Promise<{pagado:boolean, estado:string, datos:object}|null>}
 */
export async function consultarCheckout(checkoutId) {
  if (!activo() || !checkoutId) return null;
  try {
    const data = await pedir('get', `/v1/checkout/${encodeURIComponent(checkoutId)}`, null);
    const pago = data.payment || {};
    const pagado = pago.paid === true || pago.status === 'CLO';
    const rechazado = pago.status === 'ERR' || pago.status === 'EXP' || data.status === 'CAN';
    return { pagado, rechazado, estado: pago.status || data.status || '', datos: data };
  } catch (err) {
    console.warn('[rapyd] No se pudo consultar el checkout', checkoutId, ':', err.message);
    return null;
  }
}

/**
 * Verifica la firma de un webhook entrante de RAPYD.
 * @param {import('express').Request} req  con req.rawBody (Buffer) y cabeceras.
 * @returns {boolean}
 */
export function verificarWebhook(req) {
  if (!activo()) return false;
  const s = req.get('salt');
  const ts = req.get('timestamp');
  const firmaRecibida = req.get('signature');
  if (!s || !ts || !firmaRecibida || !req.rawBody) return false;

  const url = config.publicUrl + req.originalUrl;
  const body = req.rawBody.toString('utf8');
  const toSign = url + s + ts + config.rapyd.accessKey + config.rapyd.secretKey + body;
  const hash = crypto.createHmac('sha256', config.rapyd.secretKey).update(toSign).digest('hex');
  const esperada = Buffer.from(hash).toString('base64');

  const a = Buffer.from(firmaRecibida);
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const rapydActivo = activo;

/**
 * Prueba rapida de autenticacion con RAPYD (GET autenticado a datos de paises).
 * Sirve para verificar que las llaves y la base URL estan bien.
 */
export async function probarAuth() {
  if (!activo()) return { ok: false, error: 'Faltan RAPYD_ACCESS_KEY / RAPYD_SECRET_KEY.' };
  try {
    const data = await pedir('get', '/v1/data/countries', null);
    return { ok: true, mensaje: 'Autenticación OK con RAPYD ✅', paises: Array.isArray(data) ? data.length : undefined };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
