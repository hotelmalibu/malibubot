// ============================================================
//  db.js — Persistencia en PostgreSQL (Neon / Supabase / Render).
//
//  Guarda las CONVERSACIONES (con su historial de mensajes) y las
//  RESERVAS para que NO se borren al reiniciar/redesplegar el servicio.
//
//  Diseno "write-through": los almacenes en memoria siguen siendo la
//  capa en vivo (rapida, sincrona); cada escritura se replica aqui en
//  segundo plano (fire-and-forget). Al arrancar, se hidrata la memoria
//  desde la base de datos.
//
//  Si no hay DATABASE_URL, todo esto queda inactivo y el bot funciona
//  en memoria como antes (sin persistencia).
// ============================================================
import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

/** @type {import('pg').Pool | null} */
let pool = null;

export function dbActivo() {
  return !!pool;
}

/** Conecta y crea las tablas si no existen. Devuelve true si quedo activa. */
export async function iniciarDB() {
  if (!config.db.url) {
    console.warn('[db] Sin DATABASE_URL: los datos viven en memoria y se borran al reiniciar.');
    return false;
  }
  try {
    pool = new Pool({
      connectionString: config.db.url,
      // Los proveedores gestionados (Neon/Supabase/Render) exigen SSL.
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversaciones (
        wa_id            TEXT PRIMARY KEY,
        nombre           TEXT,
        modo             TEXT DEFAULT 'bot',
        escalado         BOOLEAN DEFAULT false,
        creado           BIGINT,
        ultima_actividad BIGINT
      );
      CREATE TABLE IF NOT EXISTS mensajes (
        id        BIGSERIAL PRIMARY KEY,
        wa_id     TEXT,
        direccion TEXT,
        autor     TEXT,
        tipo      TEXT,
        texto     TEXT,
        ts        BIGINT
      );
      CREATE INDEX IF NOT EXISTS idx_mensajes_wa_ts ON mensajes (wa_id, ts);
      CREATE INDEX IF NOT EXISTS idx_mensajes_ts ON mensajes (ts);
      CREATE TABLE IF NOT EXISTS reservas (
        id              INTEGER PRIMARY KEY,
        wa_id           TEXT,
        celular         TEXT,
        nombre          TEXT,
        email           TEXT,
        habitacion      TEXT,
        personas        INTEGER,
        check_in        TEXT,
        check_out       TEXT,
        monto           BIGINT,
        estado          TEXT,
        fuente          TEXT,
        referencia_pago TEXT,
        checkout_id     TEXT,
        creado          BIGINT
      );
    `);
    console.log('[db] Conectada a PostgreSQL y tablas listas. ✅');
    return true;
  } catch (err) {
    console.error('[db] No se pudo conectar a PostgreSQL:', err.message);
    pool = null;
    return false;
  }
}

// ---------- Escrituras (fire-and-forget desde los almacenes) ----------

/** Inserta/actualiza los metadatos de una conversacion. */
export async function dbGuardarConversacion(conv) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO conversaciones (wa_id, nombre, modo, escalado, creado, ultima_actividad)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (wa_id) DO UPDATE SET
       nombre = EXCLUDED.nombre,
       modo = EXCLUDED.modo,
       escalado = EXCLUDED.escalado,
       ultima_actividad = EXCLUDED.ultima_actividad`,
    [conv.waId, conv.nombre || '', conv.modo || 'bot', !!conv.escalado, conv.creado, conv.ultimaActividad]
  );
}

/** Inserta un mensaje del historial. */
export async function dbGuardarMensaje(waId, m) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO mensajes (wa_id, direccion, autor, tipo, texto, ts)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [waId, m.direccion, m.autor, m.tipo || 'text', m.texto || '', m.ts]
  );
}

/** Inserta/actualiza una reserva completa. */
export async function dbGuardarReserva(r) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO reservas
       (id, wa_id, celular, nombre, email, habitacion, personas, check_in, check_out,
        monto, estado, fuente, referencia_pago, checkout_id, creado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
       wa_id = EXCLUDED.wa_id,
       celular = EXCLUDED.celular,
       nombre = EXCLUDED.nombre,
       email = EXCLUDED.email,
       habitacion = EXCLUDED.habitacion,
       personas = EXCLUDED.personas,
       check_in = EXCLUDED.check_in,
       check_out = EXCLUDED.check_out,
       monto = EXCLUDED.monto,
       estado = EXCLUDED.estado,
       fuente = EXCLUDED.fuente,
       referencia_pago = EXCLUDED.referencia_pago,
       checkout_id = EXCLUDED.checkout_id`,
    [
      r.id, r.waId || '', r.celular || '', r.nombre || '', r.email || '', r.habitacion || '',
      r.personas ?? null, r.checkIn || '', r.checkOut || '', r.monto ?? null, r.estado,
      r.fuente || 'manual', r.referenciaPago || '', r.checkoutId || '', r.creado,
    ]
  );
}

// ---------- Lectura para hidratar la memoria al arrancar ----------

/**
 * Carga las filas necesarias para reconstruir la memoria.
 * @returns {Promise<{convRows:object[], msgRows:object[], reservaRows:object[]}|null>}
 */
export async function dbCargar() {
  if (!pool) return null;
  const desdeTs = Date.now() - config.db.historialDias * 24 * 60 * 60 * 1000;
  const [conv, msg, res] = await Promise.all([
    pool.query('SELECT * FROM conversaciones'),
    pool.query('SELECT wa_id, direccion, autor, tipo, texto, ts FROM mensajes WHERE ts >= $1 ORDER BY ts ASC', [desdeTs]),
    pool.query('SELECT * FROM reservas ORDER BY id ASC'),
  ]);
  return { convRows: conv.rows, msgRows: msg.rows, reservaRows: res.rows };
}

/** Diagnostico rapido: cuenta filas por tabla. */
export async function dbDiagnostico() {
  if (!pool) return { activo: false };
  try {
    const [c, m, r] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM conversaciones'),
      pool.query('SELECT COUNT(*)::int AS n FROM mensajes'),
      pool.query('SELECT COUNT(*)::int AS n FROM reservas'),
    ]);
    return {
      activo: true,
      conversaciones: c.rows[0].n,
      mensajes: m.rows[0].n,
      reservas: r.rows[0].n,
    };
  } catch (err) {
    return { activo: true, error: err.message };
  }
}
