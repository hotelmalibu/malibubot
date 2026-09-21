// ============================================================
//  crear-plantillas-vik.js — Pide a Meta que apruebe la plantilla del aviso
//  "Reserva confirmada" de Vik Booking.
//
//  Uso (desde la carpeta del proyecto, con el .env completo):
//    node scripts/crear-plantillas-vik.js            -> solo MUESTRA lo que enviaria
//    node scripts/crear-plantillas-vik.js --enviar   -> la crea en Meta
//
//  Necesita en el .env: WHATSAPP_TOKEN (con permiso whatsapp_business_management)
//  y WHATSAPP_WABA_ID (ID de la cuenta de WhatsApp Business).
//  Meta tarda de minutos a horas en aprobarla; el estado se ve en
//  business.facebook.com > WhatsApp Manager > Plantillas de mensajes.
// ============================================================
import { config } from '../src/config.js';
import { PLANTILLA_CONFIRMADA as p } from '../src/vikbooking/plantillas.js';

const enviar = process.argv.includes('--enviar');
const { token, wabaId, graphBase, graphVersion } = config.whatsapp;

const body = {
  name: p.nombre,
  language: config.vik.idioma,
  category: 'UTILITY',
  components: [{ type: 'BODY', text: p.cuerpo, example: { body_text: [p.ejemplos] } }],
};

console.log(`\n--- ${p.nombre} (${body.language}, ${body.category}) ---`);
console.log(p.cuerpo);

if (!enviar) {
  console.log('\n(Modo vista previa: no se envió nada. Usa --enviar para crearla en Meta.)');
  process.exit(0);
}
if (!token || !wabaId) {
  console.error('\nFaltan WHATSAPP_TOKEN o WHATSAPP_WABA_ID en el .env. No se envió nada.');
  process.exit(1);
}

const resp = await fetch(`${graphBase}/${graphVersion}/${wabaId}/message_templates`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const datos = await resp.json().catch(() => ({}));
if (resp.ok) console.log(`\n✅ Creada. id=${datos.id} estado=${datos.status}`);
else console.log(`\n⚠️ Meta respondió ${resp.status}: ${datos?.error?.message || JSON.stringify(datos)}`);
