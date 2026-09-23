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

// ---------- Ajuste "a lo real" de la proyección ----------
// El Excel proyecta con una ocupación fija (56 % = 17.374 noches/año). El
// hotel prefiere partir de las noches que de verdad espera vender y de un
// crecimiento por tramos. Se recalcula la proyección con la MISMA lógica del
// Excel (tarifa promedio, gastos, deuda, depreciación y CAPEX se conservan).
// Tramos de crecimiento: cada uno aplica desde el año siguiente al tramo
// anterior hasta su "hasta" (inclusive). "tope" = máximo de noches por año.
const CLAVE_AJUSTE = 'modelo_ajuste';
const AJUSTE_POR_DEFECTO = {
  activo: true,
  noches2026: 13000,
  tramos: [
    { hasta: 2027, crecimiento: 0.10 },
    { hasta: 2030, crecimiento: 0.05 },
    { hasta: 2037, crecimiento: 0.08 },
  ],
  tope: 20502,
};

/** Normaliza (acepta el formato viejo crecimiento1/hastaAnio/crecimiento2). */
function normalizarAjuste(a) {
  if (!a || typeof a !== 'object') return { ...AJUSTE_POR_DEFECTO };
  let tramos = Array.isArray(a.tramos) && a.tramos.length ? a.tramos : null;
  if (!tramos && a.crecimiento1 != null) {
    tramos = [{ hasta: a.hastaAnio || 2030, crecimiento: a.crecimiento1 }, { hasta: 2037, crecimiento: a.crecimiento2 ?? a.crecimiento1 }];
  }
  return {
    activo: a.activo !== false,
    noches2026: Number(a.noches2026) || AJUSTE_POR_DEFECTO.noches2026,
    tramos: (tramos || AJUSTE_POR_DEFECTO.tramos).map((t) => ({ hasta: Number(t.hasta), crecimiento: Number(t.crecimiento) })),
    tope: a.tope == null || a.tope === '' ? null : Number(a.tope),
  };
}

export function ajusteActual() {
  try {
    const g = ajustesStore.obtener(CLAVE_AJUSTE, '');
    if (g) return normalizarAjuste(JSON.parse(g));
  } catch { /* usa el de fabrica */ }
  return normalizarAjuste(AJUSTE_POR_DEFECTO);
}

/** Guarda el ajuste (valida rangos). Devuelve null si algo no es válido. */
export function fijarAjuste(a = {}) {
  const n = Math.round(Number(a.noches2026));
  if (!Number.isFinite(n) || n < 1000 || n > 40000) return null;
  const tramos = (Array.isArray(a.tramos) ? a.tramos : [])
    .map((t) => ({ hasta: Math.round(Number(t.hasta)), crecimiento: Number(t.crecimiento) }))
    .filter((t) => Number.isInteger(t.hasta) && Number.isFinite(t.crecimiento));
  if (!tramos.length) return null;
  if (!tramos.every((t) => t.hasta >= 2027 && t.hasta <= 2037 && t.crecimiento >= -0.5 && t.crecimiento <= 1)) return null;
  tramos.sort((x, y) => x.hasta - y.hasta);
  const tope = a.tope == null || a.tope === '' ? null : Math.round(Number(a.tope));
  if (tope != null && (!Number.isFinite(tope) || tope < n || tope > 40000)) return null;
  const nuevo = { activo: a.activo !== false, noches2026: n, tramos, tope };
  ajustesStore.poner(CLAVE_AJUSTE, JSON.stringify(nuevo));
  return nuevo;
}

/** Crecimiento que aplica a un año según los tramos (el último tramo se extiende si hace falta). */
function crecimientoDe(ajuste, anio) {
  const t = ajuste.tramos.find((x) => anio <= x.hasta) || ajuste.tramos[ajuste.tramos.length - 1];
  return t ? t.crecimiento : 0;
}

/** TIR anual de una serie de flujos (el primero suele ser negativo). */
export function tir(flujos) {
  const f = (flujos || []).filter((x) => x != null);
  if (f.length < 2 || !f.some((x) => x < 0) || !f.some((x) => x > 0)) return null;
  const van = (r) => f.reduce((s, x, i) => s + x / Math.pow(1 + r, i), 0);
  let lo = -0.99, hi = 10;
  if (van(lo) * van(hi) > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (van(lo) * van(mid) <= 0) hi = mid; else lo = mid;
  }
  return Math.round(((lo + hi) / 2) * 10000) / 10000;
}

/**
 * Devuelve una copia del modelo con la proyección recalculada según el
 * ajuste. Guarda la versión del Excel en proyeccion.excel para comparar.
 */
export function aplicarAjuste(modelo, ajuste = ajusteActual()) {
  if (!modelo?.proyeccion || !ajuste?.activo) return modelo;
  const p = modelo.proyeccion, s = p.series;
  const anioBase = modelo.supuestos?.anioInicioNuevas || 2026;
  const i0 = p.anios.indexOf(anioBase);
  if (i0 < 0 || !s.noches || !s.ingresos) return modelo;
  const r = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const totalHab = modelo.supuestos?.totalHabitaciones || 85;
  const n = p.anios.length;
  const copia = (arr) => (arr || []).slice();
  const nuevo = {
    noches: copia(s.noches), ocupacion: copia(s.ocupacion), tarifaPromedio: copia(s.tarifaPromedio), ingresos: copia(s.ingresos),
    gastos: copia(s.gastos), ebitda: copia(s.ebitda), depreciacion: copia(s.depreciacion), utOperacional: copia(s.utOperacional),
    deuda: copia(s.deuda), gFinancieros: copia(s.gFinancieros), amortizacion: copia(s.amortizacion), servicioDeuda: copia(s.servicioDeuda),
    utNeta: copia(s.utNeta), fcf: copia(s.fcf), fcfAcumulado: copia(s.fcfAcumulado),
    margenEbitda: copia(s.margenEbitda), margenOperacional: copia(s.margenOperacional), margenNeto: copia(s.margenNeto),
  };
  let acum = 0, noches = ajuste.noches2026;
  for (let i = i0; i < n; i++) {
    const anio = p.anios[i];
    if (i > i0) noches = noches * (1 + crecimientoDe(ajuste, anio));
    if (ajuste.tope != null && noches > ajuste.tope) noches = ajuste.tope; // tope máximo de noches/año
    const nochesR = Math.round(noches);
    const tarifa = s.noches[i] ? s.ingresos[i] / s.noches[i] : (s.tarifaPromedio?.[i] ?? 0); // COP MM por noche (del Excel)
    const dias = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0 ? 366 : 365;
    const ingresos = nochesR * tarifa;
    const gastos = s.gastos?.[i] ?? 0, dep = s.depreciacion?.[i] ?? 0, gFin = s.gFinancieros?.[i] ?? 0, amort = s.amortizacion?.[i] ?? 0;
    const ebitda = ingresos - gastos, utOper = ebitda - dep, utNeta = utOper - gFin;
    // CAPEX implícito en el Excel de ese año: utNeta + dep - amort - fcf.
    const capex = (s.utNeta?.[i] ?? 0) + dep - amort - (s.fcf?.[i] ?? 0);
    const fcf = utNeta + dep - amort - capex;
    acum += fcf;
    nuevo.noches[i] = nochesR;
    nuevo.ocupacion[i] = r(nochesR / (dias * totalHab));
    nuevo.tarifaPromedio[i] = r(tarifa);
    nuevo.ingresos[i] = r(ingresos);
    nuevo.ebitda[i] = r(ebitda);
    nuevo.utOperacional[i] = r(utOper);
    nuevo.utNeta[i] = r(utNeta);
    nuevo.fcf[i] = r(fcf);
    nuevo.fcfAcumulado[i] = r(acum);
    nuevo.margenEbitda[i] = ingresos ? r(ebitda / ingresos) : null;
    nuevo.margenOperacional[i] = ingresos ? r(utOper / ingresos) : null;
    nuevo.margenNeto[i] = ingresos ? r(utNeta / ingresos) : null;
  }
  const porTipo = (p.porTipo || []).map((t) => ({
    ...t,
    valores: t.valores.map((v, i) => (v == null || i < i0 || !s.noches[i] ? v : r((v * nuevo.noches[i]) / s.noches[i]))),
  }));
  return {
    ...modelo,
    proyeccion: {
      ...p,
      series: nuevo,
      porTipo,
      tir: tir(nuevo.fcf.slice(i0)),
      ajuste: { ...ajuste, anioBase },
      excel: { noches: s.noches, ocupacion: s.ocupacion, ingresos: s.ingresos, utNeta: s.utNeta, fcf: s.fcf, fcfAcumulado: s.fcfAcumulado, tir: p.tir },
    },
  };
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
