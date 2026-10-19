// ============================================================
//  probar-datos-hotel.js — Prueba OFFLINE de los datos del hotel que Valentina debe saber
//  (las instrucciones que recibe en WhatsApp y en Messenger/Instagram).
//    node scripts/probar-datos-hotel.js
//  Datos confirmados por el dueño el 18-oct-2026: parqueadero, mascotas, WiFi, cancelación,
//  factura electrónica, check-in anticipado / salida tardía. Sin red ni base de datos.
// ============================================================
delete process.env.DATABASE_URL;

const { sistema } = await import('../src/ia/agente.js');
const { telefonoBonito } = await import('../src/whatsapp/llamadas.js');

let fallos = 0;
const ok = (n, c, extra = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : (extra ? `  → ${extra}` : ''))); if (!c) fallos++; };
const veces = (texto, patron) => (texto.match(patron) || []).length;

const variantes = { WhatsApp: sistema(''), 'Messenger/Instagram': sistema('Messenger') };

for (const [canal, p] of Object.entries(variantes)) {
  console.log(`— Prompt de ${canal} —`);
  ok('parqueadero: sí hay y es gratis', /PARQUEADERO: SÍ hay parqueadero y es GRATIS para los huéspedes/.test(p));
  ok('mascotas: no se permiten, solo con certificado médico (y lo consulta con recepción)', /NO se permiten mascotas en el hotel; solo se aceptan con certificado médico/.test(p) && /lo consulte con recepción/.test(p));
  ok('WiFi: en todo el hotel y en las zonas de co-working', /WiFi en TODO el hotel y también en las zonas de co-working/.test(p));
  ok('ubicación: Calle 32A #32-04, Sincelejo', /Calle 32A #32-04, Sincelejo, Sucre, Colombia/.test(p));
  ok('factura electrónica: se pide a reservas@hotelmalibu.co y ella no la genera', /FACTURA ELECTRÓNICA: se solicita por correo a reservas@hotelmalibu\.co/.test(p) && /Tú no la generas ni la envías/.test(p));
  ok('cancelación: sin cobro hasta 24 horas antes; después se cobra el valor de la reserva; sin prometer devoluciones', /sin cobro hasta 24 horas antes de la llegada|SIN COBRO hasta 24 horas antes de la llegada/.test(p) && /se cobra el valor de la reserva/.test(p) && /no prometas devoluciones ni excepciones/.test(p));
  ok('...y no precisa montos (no se sabe si es toda la estadía o una noche)', /No precises montos/.test(p));
  ok('check-in anticipado / salida tardía: sí se puede pedir, se confirma con recepción, sin prometer hora ni costo', /CHECK-IN ANTICIPADO o SALIDA TARDÍA: SÍ se pueden solicitar/.test(p) && p.includes(telefonoBonito()) && /sin prometer una hora ni un costo/.test(p));
  ok('ya no le prohíbe hablar del parqueadero ni dice que no se puede pedir check-in anticipado', !/jacuzzi, spa, parqueadero/.test(p) && !/No prometas check-in anticipado ni salida tardía/.test(p));
  ok('cada dato aparece una sola vez (sin duplicados)', veces(p, /PARQUEADERO:/g) === 1 && veces(p, /MASCOTAS:/g) === 1 && veces(p, /POLÍTICA DE CANCELACIÓN:/g) === 1 && veces(p, /FACTURA ELECTRÓNICA:/g) === 1);
  ok('conserva lo anterior: piscina, horarios, desayuno, niños y la regla de las herramientas', /PISCINA/.test(p) && /CHECK-IN es a las/.test(p) && /INCLUYEN DESAYUNO/.test(p) && /NIÑOS MENORES DE 12 AÑOS/.test(p) && /LA RESERVA SOLO EXISTE SI USAS UNA HERRAMIENTA/.test(p));
  ok('no quedaron huecos ("undefined") en el prompt', !/undefined|\[object/.test(p));
}

console.log(fallos === 0 ? '\n🎉 Todas las verificaciones pasaron.' : `\n💥 ${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
