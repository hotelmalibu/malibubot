// ============================================================
//  sesion.js — Autenticacion del panel por FORMULARIO (cookie firmada).
//
//  La sesion es "stateless": la cookie lleva un token firmado (HMAC) con el
//  usuario y su vencimiento. No se guarda nada en memoria, asi sigue valida
//  aunque el servicio se redespliegue.
//
//  Seguridad:
//   - La firma depende tambien de la contrasena: si cambias ADMIN_PASSWORD,
//     TODAS las sesiones abiertas se cierran solas.
//   - Comparaciones en tiempo constante (no se puede "medir" la clave).
//   - Cookie HttpOnly + SameSite=Strict + Secure (en https).
//   - Freno a fuerza bruta y 2FA opcional: ver seguridad.js.
// ============================================================
import crypto from 'crypto';
import { config } from '../config.js';
import { igualSeguro } from './seguridad.js';

const COOKIE = 'malibu_ses';
const DURACION_MS = 12 * 60 * 60 * 1000; // 12 horas

function secreto() {
  // Secreto propio (ADMIN_SESSION_SECRET) o derivado de la clave; en ambos
  // casos se mezcla la clave para que cambiarla invalide las sesiones.
  const base = config.admin.secretoSesion || 'malibubot';
  return crypto.createHash('sha256').update(base + '|' + (config.admin.password || '')).digest();
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function firmar(dato) {
  return b64url(crypto.createHmac('sha256', secreto()).update(dato).digest());
}

/** Valida usuario+clave contra la configuracion (en tiempo constante). */
export function validarCredenciales(usuario, clave) {
  if (!config.admin.password || !usuario) return false;
  const clave_ok = igualSeguro(clave, config.admin.password);
  // Si se definio ADMIN_USUARIO, debe coincidir; si no, se acepta cualquiera.
  const usuario_ok = !config.admin.usuario || igualSeguro(usuario, config.admin.usuario);
  return clave_ok && usuario_ok;
}

/** Crea el token firmado para la cookie. */
export function crearToken(usuario) {
  const payload = b64url(JSON.stringify({ u: usuario, iat: Date.now(), exp: Date.now() + DURACION_MS, n: b64url(crypto.randomBytes(8)) }));
  return `${payload}.${firmar(payload)}`;
}

function verificarToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!igualSeguro(sig, firmar(payload))) return null;
  try {
    const datos = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!datos.exp || datos.exp < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

function leerCookies(req) {
  const bruto = req.headers.cookie || '';
  const out = {};
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i > -1) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

function esHttps(req) {
  return (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
}

/** Escribe la cookie de sesion en la respuesta. */
export function ponerCookieSesion(req, res, token) {
  const attrs = [
    `${COOKIE}=${token}`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(DURACION_MS / 1000)}`,
  ];
  // En local (http) no se puede marcar Secure o el navegador la descarta.
  if (esHttps(req)) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

/** Borra la cookie (logout). */
export function borrarCookieSesion(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`);
}

export function haySesion(req) {
  return !!verificarToken(leerCookies(req)[COOKIE]);
}

/** Datos de la sesion actual (usuario, vencimiento) o null. */
export function sesionActual(req) {
  return verificarToken(leerCookies(req)[COOKIE]);
}

/**
 * Middleware: exige sesion valida.
 * - Para rutas de API (/api/...) responde 401 JSON.
 * - Para paginas, redirige a /admin/login.
 */
export function requiereSesion(req, res, next) {
  if (!config.admin.password) {
    return res.status(503).send('Panel deshabilitado. Configura ADMIN_PASSWORD en el entorno.');
  }
  if (haySesion(req)) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: 'Sesion requerida.' });
  }
  return res.redirect('/admin/login');
}

/** Cabeceras de seguridad para todo /admin (sin cache, sin iframes, sin sniffing). */
export function cabecerasSeguridad(_req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}
