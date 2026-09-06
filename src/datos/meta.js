// ============================================================
//  meta.js — Meta semanal de reservas y tasa de conversión (dashboard).
//
//  Semana = lunes a domingo en hora de Colombia. Cuentan las reservas
//  CONFIRMADAS (pagadas o con pago en el hotel) creadas esa semana, del bot
//  o manuales. La conversión = chats iniciados esa semana que terminaron
//  en reserva confirmada.
// ============================================================
import { config } from '../config.js';
import { store } from '../almacen/conversaciones.js';
import { reservasStore } from '../almacen/reservas.js';
import { ajustesStore } from '../almacen/ajustes.js';
import { diaColombia, sumarDias, inicioSemana } from '../util/fechas.js';

const CLAVE_META = 'meta_semanal';

export function metaSemanal() {
  const v = ajustesStore.numero(CLAVE_META, config.meta.semanal);
  return v > 0 ? Math.round(v) : config.meta.semanal;
}

export function fijarMetaSemanal(valor) {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n) || n < 1 || n > 1000) return null;
  ajustesStore.poner(CLAVE_META, n);
  return n;
}

function confirmada(r) {
  return r.estado === 'pagado' || r.estado === 'pendiente_hotel';
}

/** waIds con reserva confirmada (para el embudo y la conversión). */
export function waIdsConReserva() {
  const s = new Set();
  for (const r of reservasStore.listar()) if (confirmada(r) && r.waId) s.add(r.waId);
  return s;
}

function reservasEntre(desde, hasta) {
  return reservasStore.listar().filter((r) => {
    const dia = diaColombia(r.creado);
    return dia >= desde && dia <= hasta;
  });
}

function resumenSemana(lunes, meta, reservados) {
  const domingo = sumarDias(lunes, 6);
  const rs = reservasEntre(lunes, domingo);
  const conf = rs.filter(confirmada);
  const emb = store.embudo({ desde: lunes, hasta: domingo, reservados });
  return {
    desde: lunes,
    hasta: domingo,
    reservas: conf.length,
    bot: conf.filter((r) => r.fuente !== 'manual').length,
    manual: conf.filter((r) => r.fuente === 'manual').length,
    enProceso: rs.filter((r) => r.estado === 'en_proceso').length,
    chats: emb.etapas.total,
    chatsReservaron: emb.etapas.reservaron,
    conversionPct: emb.etapas.total ? Math.round((emb.etapas.reservaron / emb.etapas.total) * 100) : null,
    cumplida: conf.length >= meta,
  };
}

/** Todo lo que pinta la sección "Meta semanal" del dashboard. */
export function resumenMeta({ semanas = 8 } = {}) {
  const meta = metaSemanal();
  const hoy = diaColombia();
  const lunes = inicioSemana(hoy);
  const reservados = waIdsConReserva();

  const actual = resumenSemana(lunes, meta, reservados);
  const transcurridos = Math.round((new Date(hoy + 'T00:00:00Z') - new Date(lunes + 'T00:00:00Z')) / 864e5) + 1; // 1..7
  const restantes = 7 - transcurridos; // días completos que quedan después de hoy
  const proyeccion = Math.round((actual.reservas / transcurridos) * 7);

  const historial = [];
  for (let i = semanas - 1; i >= 0; i--) historial.push(resumenSemana(sumarDias(lunes, -7 * i), meta, reservados));
  const cerradas = historial.slice(0, -1); // sin la semana en curso
  const cumplidas = cerradas.filter((s) => s.cumplida).length;

  return {
    ok: true,
    meta,
    hoy,
    semana: {
      ...actual,
      faltan: Math.max(meta - actual.reservas, 0),
      pct: Math.min(100, Math.round((actual.reservas / meta) * 100)),
      diaDeSemana: transcurridos,
      diasRestantes: restantes,
      proyeccion,
    },
    historial,
    semanasCumplidas: cumplidas,
    semanasCerradas: cerradas.length,
  };
}
