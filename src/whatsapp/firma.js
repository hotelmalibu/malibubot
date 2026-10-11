// ============================================================
//  firma.js — Verifica que el webhook venga realmente de Meta.
//  Meta firma el cuerpo con tu App Secret (HMAC SHA-256) y lo
//  manda en la cabecera "X-Hub-Signature-256: sha256=<hash>".
// ============================================================
import crypto from 'crypto';
import { config } from '../config.js';

/**
 * @param {import('express').Request} req  Debe traer req.rawBody (Buffer).
 * @returns {boolean} true si la firma es valida.
 */
export function verificarFirma(req) {
  const firmaRecibida = req.get('X-Hub-Signature-256');
  if (!firmaRecibida || !req.rawBody) return false;

  // Puede venir de la app de WhatsApp o de la de Messenger/Instagram (a veces es la misma).
  const secretos = [config.whatsapp.appSecret, config.social.appSecret, config.social.igAppSecret].filter(Boolean);
  const a = Buffer.from(firmaRecibida);
  return secretos.some((secreto) => {
    const esperada = 'sha256=' + crypto.createHmac('sha256', secreto).update(req.rawBody).digest('hex');
    const b = Buffer.from(esperada);
    // Comparacion en tiempo constante para evitar ataques de temporizacion.
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}
