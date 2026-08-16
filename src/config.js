// ============================================================
//  config.js — Carga y valida las variables de entorno.
// ============================================================
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  puerto: process.env.PORT || 3000,

  whatsapp: {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    graphVersion: process.env.GRAPH_API_VERSION || 'v21.0',
    // Base de la Graph API. En produccion se deja el valor por defecto (Meta);
    // solo se sobreescribe para pruebas locales con un servidor simulado.
    graphBase: process.env.GRAPH_API_BASE || 'https://graph.facebook.com',
    // ID de la cuenta de WhatsApp Business (opcional; tambien se puede pasar
    // por ?waba=... en la ruta de reparacion).
    wabaId: process.env.WHATSAPP_WABA_ID,
  },

  hotel: {
    nombre: process.env.HOTEL_NOMBRE || 'Hotel y Centro de Eventos Malibu',
    // Total de habitaciones del hotel (para el calculo de ocupadas/disponibles).
    habitaciones: parseInt(process.env.HOTEL_HABITACIONES || '20', 10),
  },

  admin: {
    // Usuario del panel. Si se deja vacio, se acepta cualquier usuario y solo
    // se valida la contrasena (compatibilidad con el comportamiento anterior).
    usuario: process.env.ADMIN_USUARIO || '',
    password: process.env.ADMIN_PASSWORD,
    // Secreto para firmar la cookie de sesion. Si no se define, se deriva de
    // la contrasena (suficiente para este panel interno).
    secretoSesion: process.env.ADMIN_SESSION_SECRET || '',
  },
};

// Avisa (sin frenar el arranque) si falta algo. Asi el /health y la
// verificacion del webhook siguen funcionando y puedes ver el problema en logs.
export function revisarConfig() {
  const requeridas = {
    WHATSAPP_TOKEN: config.whatsapp.token,
    WHATSAPP_PHONE_NUMBER_ID: config.whatsapp.phoneNumberId,
    WHATSAPP_VERIFY_TOKEN: config.whatsapp.verifyToken,
    WHATSAPP_APP_SECRET: config.whatsapp.appSecret,
  };

  const faltantes = Object.entries(requeridas)
    .filter(([, valor]) => !valor)
    .map(([nombre]) => nombre);

  if (faltantes.length > 0) {
    console.warn(
      '[config] Faltan variables de entorno: ' + faltantes.join(', ') +
      '. El eco no funcionara hasta cargarlas (en Render: Settings -> Environment).'
    );
  } else {
    console.log('[config] Todas las variables requeridas estan presentes.');
  }

  if (!config.admin.password) {
    console.warn('[config] Sin ADMIN_PASSWORD: el panel /admin estara cerrado hasta configurarla.');
  }
}
