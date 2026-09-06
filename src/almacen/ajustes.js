// ============================================================
//  ajustes.js — Preferencias editables desde el panel (p. ej. la meta
//  semanal de reservas). En memoria + replicadas en PostgreSQL.
// ============================================================
import { dbActivo, dbGuardarAjuste } from './db.js';

/** @type {Map<string, string>} */
const ajustes = new Map();

export const ajustesStore = {
  obtener(clave, porDefecto = '') {
    return ajustes.has(clave) ? ajustes.get(clave) : porDefecto;
  },

  numero(clave, porDefecto = 0) {
    const v = parseFloat(this.obtener(clave, ''));
    return Number.isFinite(v) ? v : porDefecto;
  },

  poner(clave, valor) {
    ajustes.set(clave, String(valor));
    if (dbActivo()) dbGuardarAjuste(clave, String(valor)).catch((e) => console.error('[db] ajuste:', e.message));
    return valor;
  },
};

/** Carga los ajustes guardados (al arrancar). */
export function hidratarAjustes(filas = []) {
  for (const f of filas) ajustes.set(f.clave, f.valor ?? '');
  return filas.length;
}
