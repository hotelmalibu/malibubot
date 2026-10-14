// ============================================================
//  documentos.js — Documentos PRIVADOS del hotel que Valentina envia por
//  WhatsApp: hoy, los certificados de las cuentas bancarias (Davivienda y
//  Bancolombia) para los clientes que eligen pagar por transferencia.
//
//  Por que NO estan en el repositorio: el repositorio de GitHub es publico y
//  los certificados traen numeros de cuenta y NIT. Los PDF se suben desde el
//  panel (/admin -> Monitor conversaciones -> "Pago por transferencia") y
//  quedan en PostgreSQL (tabla documentos); en memoria se guardan para
//  enviarlos rapido. Sin base de datos viven solo en memoria (se pierden al
//  reiniciar, igual que las conversaciones).
// ============================================================
import { dbActivo, dbGuardarDocumento, dbEliminarDocumento } from '../almacen/db.js';

/** Documentos que el panel permite cargar (la clave es la unica que se acepta). */
export const DOCUMENTOS = [
  {
    clave: 'cert-davivienda',
    etiqueta: 'Davivienda',
    archivo: 'Certificado cuenta Davivienda - Hotel Malibu.pdf',
    leyenda: 'Certificado de nuestra cuenta Davivienda 🏦',
  },
  {
    clave: 'cert-bancolombia',
    etiqueta: 'Bancolombia',
    archivo: 'Certificado cuenta Bancolombia - Hotel Malibu.pdf',
    leyenda: 'Certificado de nuestra cuenta Bancolombia 🏦',
  },
];

/** Peso maximo de cada PDF (un certificado pesa ~150 KB; esto es de sobra). */
export const MAX_BYTES_DOCUMENTO = 3 * 1024 * 1024;

/** @type {Map<string, {clave:string, nombre:string, mime:string, datos:Buffer, actualizado:number}>} */
const memoria = new Map();

function definicion(clave) {
  return DOCUMENTOS.find((d) => d.clave === clave) || null;
}

/** Error con mensaje listo para mostrar en el panel. */
function errorDeUso(mensaje) {
  const e = new Error(mensaje);
  e.deUso = true;
  return e;
}

/** Nombre de archivo seguro (sin rutas ni caracteres raros) y siempre terminado en .pdf. */
function nombreSeguro(nombre, respaldo) {
  const base = String(nombre || '').split(/[\\/]/).pop().replace(/[^\p{L}\p{N} ._()\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const limpio = base || respaldo;
  return /\.pdf$/i.test(limpio) ? limpio : `${limpio}.pdf`;
}

export const documentosStore = {
  /** Reconstruye la memoria con las filas de la base (al arrancar). */
  hidratar(filas = []) {
    for (const f of filas) {
      if (!definicion(f.clave) || !f.datos) continue;
      memoria.set(f.clave, {
        clave: f.clave,
        nombre: f.nombre || '',
        mime: f.mime || 'application/pdf',
        datos: Buffer.from(f.datos),
        actualizado: Number(f.actualizado) || 0,
      });
    }
    return memoria.size;
  },

  /** Documento completo (con los bytes) o null. */
  obtener(clave) {
    return memoria.get(clave) || null;
  },

  /** Estado de cada documento SIN los bytes (para el panel). */
  listar() {
    return DOCUMENTOS.map((d) => {
      const x = memoria.get(d.clave);
      return { clave: d.clave, etiqueta: d.etiqueta, cargado: !!x, nombre: x?.nombre || '', bytes: x?.datos.length || 0, actualizado: x?.actualizado || 0 };
    });
  },

  /** Los documentos que SI estan cargados, en orden, listos para enviar. */
  cargados() {
    return DOCUMENTOS.filter((d) => memoria.has(d.clave)).map((d) => {
      const x = memoria.get(d.clave);
      return { ...d, nombreEnvio: nombreSeguro(x.nombre, d.archivo), mime: x.mime, datos: x.datos };
    });
  },

  /**
   * Guarda (o reemplaza) un PDF. Valida clave, tipo y peso. Si hay base de datos
   * se espera a que quede guardado: si falla, lanza el error (el panel lo muestra).
   */
  async guardar(clave, { nombre, datos }) {
    const def = definicion(clave);
    if (!def) throw errorDeUso('Documento desconocido.');
    if (!Buffer.isBuffer(datos) || !datos.length) throw errorDeUso('El archivo llegó vacío.');
    if (datos.length > MAX_BYTES_DOCUMENTO) throw errorDeUso(`El PDF pesa demasiado (máximo ${Math.round(MAX_BYTES_DOCUMENTO / 1048576)} MB).`);
    if (datos.subarray(0, 5).toString('latin1') !== '%PDF-') throw errorDeUso('El archivo no es un PDF.');
    const doc = { clave, nombre: nombreSeguro(nombre, def.archivo), mime: 'application/pdf', datos, actualizado: Date.now() };
    if (dbActivo()) await dbGuardarDocumento(doc);
    memoria.set(clave, doc);
    return { clave, nombre: doc.nombre, bytes: datos.length, actualizado: doc.actualizado };
  },

  /** Quita un documento (memoria y base). */
  async eliminar(clave) {
    if (!definicion(clave)) throw errorDeUso('Documento desconocido.');
    if (dbActivo()) await dbEliminarDocumento(clave);
    return memoria.delete(clave);
  },
};
