// ============================================================
//  auth.js — Protege el panel con autenticacion basica.
//  Usuario: cualquiera. Contrasena: la de ADMIN_PASSWORD.
//  Si no hay contrasena configurada, el panel queda cerrado.
// ============================================================
import crypto from 'crypto';
import { config } from '../config.js';

function comparar(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function auth(req, res, next) {
  const clave = config.admin.password;

  // Cerrado por defecto: sin contrasena, no se entra.
  if (!clave) {
    return res
      .status(503)
      .send('Panel deshabilitado. Configura ADMIN_PASSWORD en el entorno.');
  }

  const header = req.get('Authorization') || '';
  const [tipo, credenciales] = header.split(' ');

  if (tipo === 'Basic' && credenciales) {
    const texto = Buffer.from(credenciales, 'base64').toString('utf8');
    const idx = texto.indexOf(':');
    const pwd = idx >= 0 ? texto.slice(idx + 1) : '';
    if (pwd && comparar(pwd, clave)) return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="MALIBUBOT Consola"');
  return res.status(401).send('Autenticacion requerida.');
}
