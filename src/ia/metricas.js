// ============================================================
//  metricas.js — Contador de uso de tokens de la IA y su costo.
//
//  Registra el `usage` de cada llamada a Claude, calcula el costo en USD y
//  en pesos (COP) y lo cruza con las reservas del bot para saber cuánto
//  cuesta cada reserva. Se persiste en Postgres para sobrevivir reinicios.
// ============================================================
import { config } from '../config.js';
import { dbActivo, dbGuardarMetricas } from '../almacen/db.js';

// Precios oficiales de Anthropic (USD por 1M de tokens).
const PRECIOS = {
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};
function precioDe(modelo) {
  return PRECIOS[modelo] || PRECIOS['claude-sonnet-5'];
}

const vacio = () => ({ llamadas: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const totales = vacio();
const porDia = new Map(); // 'YYYY-MM-DD' -> conteo

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

let guardarPendiente = false;
function programarGuardado() {
  if (!dbActivo() || guardarPendiente) return;
  guardarPendiente = true;
  setTimeout(() => {
    guardarPendiente = false;
    dbGuardarMetricas(serializar()).catch((e) => console.error('[metricas] db:', e.message));
  }, 20 * 1000); // guarda a lo sumo cada 20 s
}

function serializar() {
  return { totales, porDia: Object.fromEntries(porDia) };
}

/** Reconstruye los contadores desde lo guardado en la base (al arrancar). */
export function hidratarMetricas(datos) {
  if (!datos) return;
  try {
    const d = typeof datos === 'string' ? JSON.parse(datos) : datos;
    if (d.totales) Object.assign(totales, d.totales);
    if (d.porDia) for (const [k, v] of Object.entries(d.porDia)) porDia.set(k, v);
  } catch (e) {
    console.error('[metricas] Error hidratando:', e.message);
  }
}

/** Registra el uso de una llamada a Claude. */
export function registrarUso(modelo, usage) {
  if (!usage) return;
  const inp = usage.input_tokens || 0;
  const out = usage.output_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;

  for (const acc of [totales, obtenerDia(hoyISO())]) {
    acc.llamadas += 1;
    acc.input += inp;
    acc.output += out;
    acc.cacheRead += cr;
    acc.cacheWrite += cw;
  }
  programarGuardado();
}

function obtenerDia(dia) {
  if (!porDia.has(dia)) porDia.set(dia, vacio());
  return porDia.get(dia);
}

function costoUSD(t, modelo) {
  const p = precioDe(modelo || config.ia.modelo);
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1e6;
}

/**
 * Resumen para el panel. Recibe el # de reservas del bot para cruzar costo.
 */
export function resumenMetricas(reservasBot = 0) {
  const usd = costoUSD(totales);
  const cop = usd * config.ia.copPorUsd;
  const tokensTotales = totales.input + totales.output + totales.cacheRead + totales.cacheWrite;
  const dias = [...porDia.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 30)
    .map(([dia, t]) => ({
      dia,
      llamadas: t.llamadas,
      tokens: t.input + t.output + t.cacheRead + t.cacheWrite,
      costoCOP: Math.round(costoUSD(t) * config.ia.copPorUsd),
    }));

  return {
    modelo: config.ia.modelo,
    copPorUsd: config.ia.copPorUsd,
    llamadas: totales.llamadas,
    tokens: { ...totales, total: tokensTotales },
    costoUSD: Number(usd.toFixed(4)),
    costoCOP: Math.round(cop),
    reservasBot,
    costoPorReservaCOP: reservasBot > 0 ? Math.round(cop / reservasBot) : null,
    ahorroCacheTokens: totales.cacheRead, // tokens servidos desde caché (10% del costo)
    porDia: dias,
  };
}
