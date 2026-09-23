// ============================================================
//  modelo.js — Modelo financiero maestro del hotel (Monitor financiero).
//
//  Lee el Excel "Malibu_ModeloMaestro_AAAA-AAAA.xlsx" (hojas: Panel de
//  Entrada, Supuestos, Sensibilidad, Comparativo, Histórico, Modelo
//  Financiero, Dashboard) y lo convierte a un JSON simple que el panel pinta.
//
//  - Al arrancar se usa el modelo guardado en la base (tabla ajustes, clave
//    "modelo_financiero", subido desde el panel) o, si no hay, el JSON que
//    viene con el código (src/datos/modelo-financiero.json).
//  - Las cifras del Excel están en COP MILLONES (MM), salvo las tarifas rack.
//  - Todo se busca por ETIQUETA (sin tildes, minúsculas) y no por celda fija,
//    para que sobreviva a que muevan filas en el Excel.
// ============================================================
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ajustesStore } from '../almacen/ajustes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLAVE = 'modelo_financiero';

// ---------- utilidades ----------
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
// Los años pueden venir como número (2026) o como texto ("2026").
const anioDe = (v) => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\s*\d{4}\s*$/.test(v) ? Number(v) : NaN);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
};

/** Hoja -> matriz de filas con columnas ABSOLUTAS (A = 0), sin importar dónde empiece el rango. */
function matriz(X, ws) {
  if (!ws || !ws['!ref']) return [];
  const r = X.utils.decode_range(ws['!ref']);
  r.s.c = 0; r.s.r = 0;
  return X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', range: X.utils.encode_range(r) });
}

function hoja(X, wb, fragmento) {
  const n = wb.SheetNames.find((s) => norm(s).includes(norm(fragmento)));
  return n ? matriz(X, wb.Sheets[n]) : [];
}

/** Primera fila cuya celda (en cualquier columna) empieza por la etiqueta. Devuelve {fila, col}. */
function buscar(filas, etiqueta, desde = 0) {
  const e = norm(etiqueta);
  for (let i = desde; i < filas.length; i++) {
    const f = filas[i];
    for (let c = 0; c < f.length; c++) {
      if (typeof f[c] === 'string' && norm(f[c]).startsWith(e)) return { fila: i, col: c };
    }
  }
  return null;
}

/** Valor numérico a la derecha de una etiqueta (primera celda numérica después de la etiqueta). */
function valorDe(filas, etiqueta) {
  const p = buscar(filas, etiqueta);
  if (!p) return null;
  const f = filas[p.fila];
  for (let c = p.col + 1; c < f.length; c++) if (typeof f[c] === 'number') return num(f[c]);
  return null;
}

/** Serie por años: la fila de la etiqueta, alineada con la fila de años (col -> año). */
function serie(filas, etiqueta, colsAnio, desde = 0) {
  const p = buscar(filas, etiqueta, desde);
  if (!p) return null;
  const f = filas[p.fila];
  return colsAnio.map((c) => num(f[c]));
}

/** Columnas donde hay años en una fila (col -> año). */
function columnasAnio(fila) {
  const out = [];
  fila.forEach((v, c) => { const a = anioDe(v); if (a) out.push({ c, anio: a }); });
  return out;
}

// ---------- parser principal ----------

/**
 * Convierte el libro Excel (buffer) al JSON del monitor financiero.
 * @param {Buffer|ArrayBuffer} buffer
 * @param {{nombreArchivo?:string}} [meta]
 */
export async function parsearModelo(buffer, meta = {}) {
  const X = (await import('xlsx')).default;
  const wb = X.read(buffer, { type: 'buffer' });
  const errores = [];

  // ---- Panel de Entrada / Supuestos ----
  const pe = hoja(X, wb, 'panel de entrada');
  const su = hoja(X, wb, 'supuestos');
  const v = (etq) => valorDe(pe, etq) ?? valorDe(su, etq);
  const supuestos = {
    habitacionesExistentes: v('habitaciones existentes'),
    habitacionesNuevas: v('habitaciones nuevas'),
    totalHabitaciones: v('total habitaciones'),
    ocupacionHistorica: v('ocupacion historica'),
    ocupacionProyectada: v('ocupacion proyectada'),
    ocupacionRackReal: v('ocupacion rack real'),
    anioInicioNuevas: v('ano inicio operacion'),
    precioRackBase: v('precio rack base'),
    ipc: v('ipc anual'),
    prima: v('prima sobre ipc'),
    crecimientoTarifa: v('crecimiento tarifa'),
    gastosBase2025: v('gastos base 2025'),
    apalancamiento: v('apalancamiento infraestructura') ?? v('factor apalancamiento'),
    crecimientoGastos: v('crecimiento gastos'),
    gastos2026: v('gastos 2026'),
    deudaInicial: v('saldo deuda inicial'),
    ibr: v('tasa ibr'),
    spread: v('spread credito'),
    tasaEfectiva: v('tasa efectiva'),
    plazoMeses: v('plazo credito'),
    amortizacionAnual: v('amortizacion anual'),
    capex: v('capex expansion'),
    depreciacionAnual: v('depreciacion anual'),
    nochesAlta: v('noches alta temporada'),
    nochesBaja: v('noches baja'),
    nochesRegulares: v('noches regulares'),
    ocupacionAlta: v('ocupacion en noches alta'),
    ocupacionRegular: v('ocupacion en noches regulares'),
    ocupacionBaja: v('ocupacion en noches baja'),
  };

  // Tarifas rack por tipo (tabla "Tipo Habitación | Cant. | Rack Alta | Rack Regular | Rack Baja").
  const tarifas = [];
  const pt = buscar(pe, 'tipo habitacion');
  if (pt) {
    for (let i = pt.fila + 1; i < pe.length; i++) {
      const f = pe[i];
      const tipo = f[pt.col];
      if (typeof tipo !== 'string' || !tipo.trim() || typeof f[pt.col + 1] !== 'number') break;
      tarifas.push({ tipo: tipo.trim(), cantidad: num(f[pt.col + 1]), alta: num(f[pt.col + 2]), regular: num(f[pt.col + 3]), baja: num(f[pt.col + 4]) });
    }
  } else errores.push('No encontré la tabla de tarifas rack en "Panel de Entrada".');

  // Encabezado de empresa (NIT, habitaciones...).
  let empresa = { nombre: 'Hotel Malibú S.A.S.', nit: '', habitaciones: supuestos.totalHabitaciones };
  for (const f of pe.slice(0, 8)) for (const c of f) {
    if (typeof c === 'string' && /nit/i.test(c)) { const m = c.match(/NIT\s*([\d.\-]+)/i); if (m) empresa.nit = m[1]; }
    if (typeof c === 'string' && /HOTEL MALIB/i.test(c)) empresa.nombre = c.split('—')[0].trim();
  }

  // ---- Histórico ----
  const hi = hoja(X, wb, 'historico');
  const ph = buscar(hi, 'concepto');
  let historico = null;
  if (ph) {
    const cols = columnasAnio(hi[ph.fila]);
    const ca = cols.map((x) => x.c);
    historico = {
      anios: cols.map((x) => x.anio),
      series: {
        ingresos: serie(hi, 'ingresos totales', ca),
        gastos: serie(hi, 'gastos operacionales', ca),
        ebitda: serie(hi, 'ebitda (mm)', ca) ?? serie(hi, 'ebitda', ca),
        margenEbitda: serie(hi, 'margen ebitda', ca),
        depreciacion: serie(hi, 'depreciacion', ca),
        utOperacional: serie(hi, 'utilidad operacional', ca),
        gFinancieros: serie(hi, 'gastos financieros', ca),
        utNeta: serie(hi, 'utilidad neta', ca),
        deuda: serie(hi, 'saldo deuda', ca),
        fcf: serie(hi, 'fcf', ca),
      },
    };
  } else errores.push('No encontré la hoja "Histórico".');

  // ---- Modelo Financiero (histórico + proyección) ----
  const mf = hoja(X, wb, 'modelo financiero');
  const pm = buscar(mf, 'concepto');
  let proyeccion = null;
  if (pm) {
    const cols = columnasAnio(mf[pm.fila]);
    const ca = cols.map((x) => x.c);
    const anios = cols.map((x) => x.anio);
    const s = (etq, desde) => serie(mf, etq, ca, desde);
    const todas = {
      ocupacion: s('ocupacion proyectada'),
      noches: s('noches vendidas'),
      tarifaPromedio: s('tarifa promedio'),
      ingresos: s('ingresos totales'),
      gastos: s('gastos operacionales'),
      ebitda: s('ebitda (cop'),
      depreciacion: s('depreciacion (cop'),
      utOperacional: s('utilidad operacional'),
      deuda: s('saldo deuda'),
      gFinancieros: s('gastos financieros'),
      amortizacion: s('amortizacion capital'),
      servicioDeuda: s('servicio total deuda'),
      utNeta: s('utilidad neta (cop'),
      fcf: s('flujo de caja libre'),
      fcfAcumulado: s('fcf acumulado'),
      margenEbitda: s('margen ebitda'),
      margenOperacional: s('margen ut. operacional'),
      margenNeto: s('margen ut. neta'),
    };
    // Ingresos por tipo de habitación (filas indentadas entre "II." y "III.").
    const porTipo = [];
    const p2 = buscar(mf, 'ii. ingresos por tipo');
    const p3 = buscar(mf, 'iii. gastos');
    if (p2 && p3) {
      for (let i = p2.fila + 1; i < p3.fila; i++) {
        const f = mf[i];
        const etq = String(f[pm.col] || '').trim();
        if (!etq) continue;
        const m = etq.match(/^(.*?)\s*\((\d+)\s*hab/i);
        porTipo.push({ tipo: m ? m[1].trim() : etq, cantidad: m ? Number(m[2]) : null, valores: ca.map((c) => num(f[c])) });
      }
    }
    const tirP = buscar(mf, 'tir del proyecto');
    const tir = tirP ? num(mf[tirP.fila].slice(tirP.col + 1).find((x) => typeof x === 'number')) : null;
    proyeccion = { anios, series: todas, porTipo, tir };
  } else errores.push('No encontré la hoja "Modelo Financiero".');

  // ---- Comparativo de escenarios ----
  const co = hoja(X, wb, 'comparativo');
  const escenarios = [];
  const pc = buscar(co, 'escenario');
  if (pc) {
    const cols = columnasAnio(co[pc.fila]);
    const ca = cols.map((x) => x.c);
    const aniosE = cols.map((x) => x.anio);
    let actual = null;
    for (let i = pc.fila + 1; i < co.length; i++) {
      const f = co[i];
      const etq = String(f[pc.col] || '').trim();
      if (!etq) continue;
      if (etq.startsWith('►') || etq.startsWith('>')) {
        const limpio = etq.replace(/^[►>]\s*/, '');
        const [nombre, ...resto] = limpio.split('—');
        actual = { nombre: nombre.trim(), descripcion: resto.join('—').trim(), anios: aniosE, series: {} };
        escenarios.push(actual);
        continue;
      }
      if (!actual) continue;
      const clave = {
        'ingresos': 'ingresos', 'gastos op.': 'gastos', 'ebitda': 'ebitda', 'ut. operacional': 'utOperacional',
        'g. financieros': 'gFinancieros', 'ut. neta': 'utNeta', 'fcf': 'fcf', 'margen ebitda': 'margenEbitda', 'margen ut. neta': 'margenNeto',
      }[norm(etq)];
      if (clave) actual.series[clave] = ca.map((c) => num(f[c]));
    }
  } else errores.push('No encontré la hoja "Comparativo".');

  // ---- Sensibilidad (varias tablas "TABLA n: ...") ----
  const se = hoja(X, wb, 'sensibilidad');
  const sensibilidad = [];
  for (let i = 0; i < se.length; i++) {
    const f = se[i];
    const c0 = f.findIndex((x) => typeof x === 'string' && /^tabla\s*\d+/i.test(x));
    if (c0 < 0) continue;
    const titulo = String(f[c0]).replace(/^tabla\s*\d+\s*:\s*/i, '').trim();
    const cab = se[i + 1] || [];
    const ejes = String(cab[c0] || '').split('/').map((x) => x.replace(/[↓→]/g, '').trim());
    const columnas = cab.slice(c0 + 1).filter((x) => x !== '').map((x) => (typeof x === 'number' ? x : String(x)));
    const filasT = [];
    for (let j = i + 2; j < se.length; j++) {
      const g = se[j];
      const etq = g[c0];
      if (etq === '' || etq == null || (typeof etq === 'string' && /^tabla/i.test(etq))) break;
      const valores = g.slice(c0 + 1, c0 + 1 + columnas.length).map((x) => num(x));
      if (valores.every((x) => x == null)) break;
      filasT.push({ etiqueta: typeof etq === 'number' ? etq : String(etq), valores });
    }
    sensibilidad.push({ titulo, ejeFilas: ejes[0] || '', ejeColumnas: ejes[1] || '', columnas, filas: filasT });
    i += filasT.length + 1;
  }

  return {
    archivo: meta.nombreArchivo || '',
    actualizado: Date.now(),
    unidad: 'COP millones',
    empresa,
    supuestos,
    tarifas,
    historico,
    proyeccion,
    escenarios,
    sensibilidad,
    errores,
  };
}

// ---------- modelo vigente ----------
let porDefecto = null;
function modeloPorDefecto() {
  if (porDefecto) return porDefecto;
  try {
    porDefecto = JSON.parse(readFileSync(join(__dirname, 'modelo-financiero.json'), 'utf8'));
  } catch {
    porDefecto = null;
  }
  return porDefecto;
}

/** Modelo vigente: el subido desde el panel (guardado en la base) o el que viene con el código. */
export function modeloActual() {
  const guardado = ajustesStore.obtener(CLAVE, '');
  if (guardado) {
    try { return { ...JSON.parse(guardado), origen: 'panel' }; } catch { /* sigue al de fábrica */ }
  }
  const base = modeloPorDefecto();
  return base ? { ...base, origen: 'archivo' } : null;
}

/** Guarda un modelo ya parseado como el vigente (persiste en la base). */
export function guardarModelo(modelo) {
  ajustesStore.poner(CLAVE, JSON.stringify(modelo));
  return modelo;
}

/** Vuelve al modelo que viene con el código. */
export function restablecerModelo() {
  ajustesStore.poner(CLAVE, '');
  return modeloActual();
}

/**
 * Seguimiento del año en curso: noches reales del Libro (caché) mes a mes
 * frente a las noches proyectadas (noches/año prorrateadas por días del mes),
 * y el ingreso estimado (noches reales × tarifa promedio proyectada).
 * @param {(fecha:string, desde:string, hasta:string)=>object|null} ocupacionEnCache
 */
export function seguimientoAnio(modelo, ocupacionEnCache, anio = new Date().getUTCFullYear()) {
  if (!modelo?.proyeccion) return null;
  const p = modelo.proyeccion;
  const idx = p.anios.indexOf(anio);
  if (idx < 0) return null;
  const nochesAnio = p.series.noches?.[idx] ?? null;
  const ingresosAnio = p.series.ingresos?.[idx] ?? null;
  const tarifaMM = nochesAnio && ingresosAnio ? ingresosAnio / nochesAnio : (p.series.tarifaPromedio?.[idx] ?? null);
  const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
  const diasAnio = bisiesto ? 366 : 365;
  const hoy = new Date();
  const mesActual = anio === hoy.getUTCFullYear() ? hoy.getUTCMonth() : anio < hoy.getUTCFullYear() ? 11 : -1;
  const meses = [];
  let realAcum = 0, proyAcum = 0, conDato = 0;
  for (let m = 0; m < 12; m++) {
    const dias = new Date(Date.UTC(anio, m + 1, 0)).getUTCDate();
    const mm = String(m + 1).padStart(2, '0');
    const desde = `${anio}-${mm}-01`, hasta = `${anio}-${mm}-${String(dias).padStart(2, '0')}`;
    const proy = nochesAnio != null ? Math.round((nochesAnio * dias) / diasAnio) : null;
    let real = null;
    if (m <= mesActual) {
      const d = ocupacionEnCache(desde, desde, hasta);
      real = d ? (d.nochesReservadasRango ?? d.nochesReservadasMes ?? null) : null;
    }
    if (real != null && m < mesActual) { realAcum += real; proyAcum += proy || 0; conDato++; }
    meses.push({
      mes: m + 1,
      nochesReales: real,
      nochesProyectadas: proy,
      ingresoEstimadoMM: real != null && tarifaMM ? Math.round(real * tarifaMM * 10) / 10 : null,
      ingresoProyectadoMM: proy != null && tarifaMM ? Math.round(proy * tarifaMM * 10) / 10 : null,
      enCurso: m === mesActual,
      cumplimientoPct: real != null && proy ? Math.round((real / proy) * 100) : null,
    });
  }
  const totalHab = modelo.supuestos?.totalHabitaciones || 85;
  const diasCerrados = meses.slice(0, Math.max(mesActual, 0)).reduce((s, x, i) => s + (x.nochesReales != null ? new Date(Date.UTC(anio, i + 1, 0)).getUTCDate() : 0), 0);
  return {
    anio,
    mesActual: mesActual + 1,
    tarifaPromedioCOP: tarifaMM ? Math.round(tarifaMM * 1e6) : null,
    nochesAnioProyectadas: nochesAnio,
    ingresosAnioProyectadosMM: ingresosAnio,
    ocupacionProyectada: p.series.ocupacion?.[idx] ?? modelo.supuestos?.ocupacionProyectada ?? null,
    acumulado: {
      mesesCerradosConDato: conDato,
      nochesReales: realAcum,
      nochesProyectadas: proyAcum,
      cumplimientoPct: proyAcum ? Math.round((realAcum / proyAcum) * 100) : null,
      ocupacionReal: diasCerrados ? Math.round((realAcum / (diasCerrados * totalHab)) * 1000) / 10 : null,
      ingresoEstimadoMM: tarifaMM ? Math.round(realAcum * tarifaMM * 10) / 10 : null,
      ingresoProyectadoMM: tarifaMM ? Math.round(proyAcum * tarifaMM * 10) / 10 : null,
    },
    meses,
  };
}
