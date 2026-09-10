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
    habitaciones: parseInt(process.env.HOTEL_HABITACIONES || '85', 10),
    // Primer anio con Libro de Reservas en el Sheet (pestanas del seguimiento anual).
    anioInicio: parseInt(process.env.HISTORICO_DESDE || '2018', 10),
    // Numero (solo digitos, con indicativo) al que se remiten las LLAMADAS por
    // WhatsApp: el numero del bot es de la API y no atiende llamadas.
    telefonoLlamadas: (process.env.TELEFONO_LLAMADAS || '573145933714').replace(/\D/g, ''),
  },

  // Conexion con el Libro de Reservas (Google Sheet) via un Apps Script Web App
  // que cuenta la ocupacion por colores y la entrega como JSON.
  google: {
    ocupacionUrl: process.env.GOOGLE_OCUPACION_URL || '',
    ocupacionToken: process.env.GOOGLE_OCUPACION_TOKEN || '',
  },

  // Claude (IA del bot). Sonnet ejecuta las herramientas de forma CONFIABLE
  // (Haiku a veces "confirmaba" sin llamar la herramienta y no se creaba la
  // reserva). Se puede sobreescribir con ANTHROPIC_MODELO.
  ia: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    modelo: process.env.ANTHROPIC_MODELO || 'claude-sonnet-5',
    // Link/contacto de consulta para salones, restaurante u otros planes
    // (el bot SOLO vende habitaciones; lo demas lo deriva aqui).
    linkConsulta: process.env.LINK_CONSULTA || 'https://hotelmalibu.co',
    // Link con fotos, descripciones y datos de las habitaciones (para cuando
    // el cliente pide fotos o detalles).
    linkReserva: process.env.LINK_RESERVA || 'https://hotelmalibu.co/reserve',
    // Tasa de cambio para estimar el costo de tokens en pesos (aprox.).
    copPorUsd: parseFloat(process.env.COP_POR_USD || '4200'),
  },

  // Seguimiento automatico a conversaciones "calientes" que no cerraron:
  // Valentina escribe sola a las N horas de silencio (dentro de la ventana
  // de 24 h de WhatsApp), una sola vez por conversacion.
  seguimiento: {
    activo: (process.env.SEGUIMIENTO_ACTIVO || 'true') !== 'false',
    horas: parseFloat(process.env.SEGUIMIENTO_HORAS || '3'),
  },

  // Recordatorio pre-llegada (anti no-show): el dia antes del check-in,
  // Valentina confirma la llegada, UNA sola vez por reserva. Fuera de las
  // 24 h de WhatsApp necesita una plantilla aprobada por Meta (su nombre
  // exacto en RECORDATORIO_PLANTILLA; idioma de la plantilla en
  // RECORDATORIO_IDIOMA, p. ej. "es" o "es_CO").
  recordatorio: {
    activo: (process.env.RECORDATORIO_ACTIVO || 'true') !== 'false',
    plantilla: (process.env.RECORDATORIO_PLANTILLA || '').trim(),
    idioma: (process.env.RECORDATORIO_IDIOMA || 'es').trim(),
  },

  // Meta semanal de reservas (valor inicial; se puede cambiar desde el panel).
  meta: {
    semanal: Math.max(1, parseInt(process.env.META_SEMANAL || '10', 10) || 10),
  },

  // URL publica del servicio (para los retornos y el webhook de RAPYD).
  publicUrl: process.env.PUBLIC_URL || 'https://malibubot.onrender.com',

  // Base de datos PostgreSQL (Neon/Supabase/Render). Si no se define, el bot
  // funciona en memoria (las conversaciones y reservas se borran al reiniciar).
  db: {
    url: process.env.DATABASE_URL || '',
    // Cuantos dias de historial de mensajes cargar en memoria al arrancar.
    historialDias: parseInt(process.env.HISTORIAL_DIAS || '120', 10),
  },

  // Pasarela de pagos RAPYD.
  rapyd: {
    accessKey: process.env.RAPYD_ACCESS_KEY || '',
    secretKey: process.env.RAPYD_SECRET_KEY || '',
    // Sandbox por defecto (pruebas). Produccion: https://api.rapyd.net
    baseUrl: process.env.RAPYD_BASE_URL || 'https://sandboxapi.rapyd.net',
    pais: process.env.RAPYD_PAIS || 'CO',
    moneda: process.env.RAPYD_MONEDA || 'COP',
  },

  // Envio de correos (Resend).
  correo: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    // Remitente (el "De:"). Debe ser una direccion REAL del dominio verificado
    // hotelmalibu.co. OJO: usar una direccion que NO existe como buzon (p.ej.
    // reservasbot@) hace que el propio servidor del dominio RECHACE el correo a
    // recepcion (aunque a externos como Gmail sí llegue). Por eso se usa
    // reservas@ (buzon real y entregable).
    remitente: process.env.CORREO_REMITENTE || 'Reservas Hotel Malibú <reservas@hotelmalibu.co>',
    // A quien le llega el aviso de nueva reserva (recepcion).
    recepcion: process.env.CORREO_RECEPCION || 'reservas@hotelmalibu.co',
    // A donde van las RESPUESTAS del cliente (reply-to): el buzon real.
    responder: process.env.CORREO_RESPONDER || 'reservas@hotelmalibu.co',
  },

  admin: {
    // Usuario del panel. Si se deja vacio, se acepta cualquier usuario y solo
    // se valida la contrasena (compatibilidad con el comportamiento anterior).
    usuario: process.env.ADMIN_USUARIO || '',
    password: process.env.ADMIN_PASSWORD,
    // Secreto para firmar la cookie de sesion. Si no se define, se deriva de
    // la contrasena (suficiente para este panel interno).
    secretoSesion: process.env.ADMIN_SESSION_SECRET || '',
    // Segundo factor (2FA) opcional: secreto base32 de Google Authenticator.
    // Se genera desde el panel en /admin/seguridad y se pega aqui (Render).
    totpSecret: (process.env.ADMIN_TOTP_SECRET || '').replace(/[^A-Za-z2-7]/g, '').toUpperCase(),
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
