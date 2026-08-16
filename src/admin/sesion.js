// ============================================================
//  sesion.js — Autenticacion del panel por FORMULARIO (cookie firmada).
//  Reemplaza el popup de Basic Auth por una pagina de login con look&feel.
//
//  La sesion es "stateless": la cookie lleva un token firmado (HMAC) con el
//  usuario y su vencimiento. No se guarda nada en memoria, asi sigue valida
//  aunque el servicio se redespliegue.
// ============================================================
import crypto from 'crypto';
import { config } from '../config.js';

const COOKIE = 'malibu_ses';
const DURACION_MS = 12 * 60 * 60 * 1000; // 12 horas

function secreto() {
  // Secreto para firmar. Si no se configuro uno propio, se deriva de la clave.
  return config.admin.secretoSesion || config.admin.password || 'malibubot-sin-secreto';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function firmar(dato) {
  return b64url(crypto.createHmac('sha256', secreto()).update(dato).digest());
}

/** Valida usuario+clave contra la configuracion. */
export function validarCredenciales(usuario, clave) {
  const clave_ok = !!config.admin.password && clave === config.admin.password;
  // Si se definio ADMIN_USUARIO, debe coincidir; si no, se acepta cualquiera.
  const usuario_ok = !config.admin.usuario || usuario === config.admin.usuario;
  return clave_ok && usuario_ok && !!usuario;
}

/** Crea el token firmado para la cookie. */
export function crearToken(usuario) {
  const payload = b64url(JSON.stringify({ u: usuario, exp: Date.now() + DURACION_MS }));
  return `${payload}.${firmar(payload)}`;
}

function verificarToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const esperada = firmar(payload);
  const a = Buffer.from(sig || '');
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
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

/** Escribe la cookie de sesion en la respuesta. */
export function ponerCookieSesion(req, res, token) {
  const seguro = (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
  const attrs = [
    `${COOKIE}=${token}`,
    'Path=/admin',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(DURACION_MS / 1000)}`,
  ];
  if (seguro) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

/** Borra la cookie (logout). */
export function borrarCookieSesion(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/admin; HttpOnly; Max-Age=0`);
}

export function haySesion(req) {
  return !!verificarToken(leerCookies(req)[COOKIE]);
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
