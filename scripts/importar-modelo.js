// ============================================================
//  importar-modelo.js — Convierte el Excel del modelo financiero maestro al
//  JSON que trae el código (src/datos/modelo-financiero.json).
//
//  Uso:  node scripts/importar-modelo.js "C:\ruta\Malibu_ModeloMaestro_2026-2037.xlsx"
//
//  (Desde el panel también se puede subir el Excel sin tocar el código:
//   Monitor financiero -> "Actualizar modelo (.xlsx)".)
// ============================================================
import { readFileSync, writeFileSync } from 'fs';
import { basename, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parsearModelo } from '../src/datos/modelo.js';

const ruta = process.argv[2];
if (!ruta) {
  console.error('Uso: node scripts/importar-modelo.js <archivo.xlsx>');
  process.exit(1);
}
const modelo = await parsearModelo(readFileSync(ruta), { nombreArchivo: basename(ruta) });
const destino = resolve(dirname(fileURLToPath(import.meta.url)), '../src/datos/modelo-financiero.json');
writeFileSync(destino, JSON.stringify(modelo, null, 2));
console.log(`Modelo importado -> ${destino}`);
console.log(`  Histórico: ${modelo.historico?.anios?.length || 0} años · Proyección: ${modelo.proyeccion?.anios?.length || 0} años · Escenarios: ${modelo.escenarios.length} · Tablas de sensibilidad: ${modelo.sensibilidad.length} · Tarifas: ${modelo.tarifas.length}`);
if (modelo.errores.length) console.warn('  Avisos:', modelo.errores.join(' | '));
