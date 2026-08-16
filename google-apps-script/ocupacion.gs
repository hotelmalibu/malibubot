/*  ============================================================
 *  MALIBUBOT — Contador de ocupación del "Libro de Reservas".
 *
 *  Pégalo en tu hoja: Extensiones → Apps Script → borra lo que haya,
 *  pega esto, Guarda. Luego: Implementar → Nueva implementación →
 *  Aplicación web → Ejecutar como "Yo" · Acceso "Cualquier persona" →
 *  Implementar → Autorizar. Copia la URL de la app web y pásasela a tu
 *  asistente (con el token de abajo).
 *
 *  Lee la pestaña del mes actual (p. ej. "AGOSTO 2026"), encuentra la
 *  columna del día de hoy (por el número en las primeras filas) y cuenta,
 *  por color de fondo, cuántas habitaciones están:
 *    - amarillo / verde / naranja -> reservadas (ocupadas)
 *    - morado (magenta)  -> mantenimiento (no vendible)
 *    - rojo              -> ya salió (queda libre)
 *  Vendibles = 85 - (reservadas + mantenimiento).
 *  ============================================================ */

var TOKEN = 'malibu-ocup-2026';   // debe coincidir con GOOGLE_OCUPACION_TOKEN en Render
var TOTAL_HABITACIONES = 85;

var MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO',
             'AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

function doGet(e) {
  try {
    if (!e || e.parameter.token !== TOKEN) return json({ ok: false, error: 'token invalido' });
    var fecha = e.parameter.fecha ? new Date(e.parameter.fecha + 'T12:00:00') : new Date();
    return json(contarOcupacion(fecha));
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function contarOcupacion(fecha) {
  var dia = fecha.getDate();
  var nombreMes = MESES[fecha.getMonth()] + ' ' + fecha.getFullYear(); // "AGOSTO 2026"
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var hoja = ss.getSheetByName(nombreMes);
  if (!hoja) {
    var hojas = ss.getSheets();
    for (var i = 0; i < hojas.length; i++) {
      var n = hojas[i].getName().toUpperCase();
      if (n.indexOf(MESES[fecha.getMonth()]) === 0 && n.indexOf(String(fecha.getFullYear())) > -1) {
        hoja = hojas[i]; break;
      }
    }
  }
  if (!hoja) return { ok: false, error: 'no encontre la pestana ' + nombreMes };

  var rango = hoja.getDataRange();
  var valores = rango.getValues();
  var fondos = rango.getBackgrounds();
  var nFilas = valores.length, nCols = valores[0].length;

  // Columna del dia: busca en las primeras 4 filas una celda == dia.
  var colDia = -1;
  for (var f = 0; f < Math.min(4, nFilas) && colDia < 0; f++) {
    for (var c = 1; c < nCols; c++) {
      if (Number(valores[f][c]) === dia) { colDia = c; break; }
    }
  }
  if (colDia < 0) return { ok: false, error: 'no encontre la columna del dia ' + dia, mes: nombreMes };

  var reservadas = 0, mantenimiento = 0, salidas = 0, libre = 0, habitaciones = 0;
  var histo = {}; // diagnostico: cuenta los colores encontrados en la columna del dia
  for (var fila = 0; fila < nFilas; fila++) {
    var etiqueta = String(valores[fila][0] || '').trim();
    // habitaciones: empiezan por 3 digitos (201..515) o por "TB" (Torre B: TB-101..)
    if (!/^(\d{3}|TB)/i.test(etiqueta)) continue;
    habitaciones++;
    var hex = String(fondos[fila][colDia] || '').toLowerCase();
    histo[hex] = (histo[hex] || 0) + 1;
    var cat = clasificar(hex);
    if (cat === 'reserva') reservadas++;
    else if (cat === 'mantenimiento') mantenimiento++;
    else if (cat === 'salida') salidas++;
    else libre++;
  }

  // Reglas del hotel:
  //   ocupadas    = reservadas (amarillo/verde/naranja, con huesped).
  //   mantenimiento = morado (no vendible).
  //   disponibles = total - ocupadas - mantenimiento  (las ROJAS/salidas y las
  //                 blancas SI son vendibles ese dia).
  var ocupadas = reservadas;
  var disponibles = Math.max(TOTAL_HABITACIONES - reservadas - mantenimiento, 0);
  return {
    ok: true,
    fecha: Utilities.formatDate(fecha, 'GMT-5', 'yyyy-MM-dd'),
    mes: nombreMes,
    totalHabitaciones: TOTAL_HABITACIONES,
    habitacionesEnHoja: habitaciones,
    reservadas: reservadas,
    mantenimiento: mantenimiento,
    salidas: salidas,
    libre: libre,
    ocupadas: ocupadas,
    disponibles: disponibles,
    colores: histo
  };
}

// A prueba de tonos: SOLO blanco = libre, rojo = salida, morado/magenta =
// mantenimiento; CUALQUIER otro color de relleno = reserva.
function clasificar(hex) {
  hex = (hex || '').toLowerCase();
  if (hex.length < 7) return 'libre';
  var r = parseInt(hex.substr(1, 2), 16);
  var g = parseInt(hex.substr(3, 2), 16);
  var b = parseInt(hex.substr(5, 2), 16);
  if (r > 235 && g > 235 && b > 235) return 'libre';         // blanco / casi blanco
  if (r < 40 && g < 40 && b < 40) return 'libre';            // negro (borde)
  if (b > 140 && r > 120 && g < 130) return 'mantenimiento'; // morado / magenta
  if (r > 150 && g < 95 && b < 95) return 'salida';          // rojo -> ya salio
  return 'reserva';                                          // cualquier otro color
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
