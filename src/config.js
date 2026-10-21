// ============================================================
//  config.js — Carga y valida las variables de entorno.
// ============================================================
import dotenv from 'dotenv';
import { PLANTILLA_CONFIRMADA } from './vikbooking/plantillas.js';

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

  // Messenger e Instagram Direct (mismo bot, otro canal). El token es el de la
  // PAGINA de Facebook del hotel, con permiso pages_messaging e instagram_manage_messages.
  social: {
    pageToken: (process.env.META_PAGE_TOKEN || '').trim(),
    pageId: (process.env.META_PAGE_ID || '').trim(),
    // Secreto de la app de Meta de Messenger/Instagram, si es distinta a la de WhatsApp.
    appSecret: (process.env.META_APP_SECRET || '').trim(),
    // Token de verificacion del webhook de Messenger/Instagram. No es un secreto: solo deja que Meta
    // confirme la direccion; lo que protege los mensajes es la firma (X-Hub-Signature-256).
    verifyToken: (process.env.META_VERIFY_TOKEN || 'malibubot-meta-2026').trim(),
    // Instagram con "inicio de sesion de Instagram": no necesita pagina de Facebook vinculada.
    // Si hay token de Instagram, los chats de Instagram se atienden con el (y Messenger sigue con el de la pagina).
    igToken: (process.env.META_IG_TOKEN || '').trim(),
    igAppSecret: (process.env.META_IG_APP_SECRET || '').trim(),
    igBase: (process.env.INSTAGRAM_API_BASE || 'https://graph.instagram.com').trim(),
  },

  hotel: {
    nombre: process.env.HOTEL_NOMBRE || 'Hotel y Centro de Eventos Malibu',
    // Total de habitaciones del hotel (para el calculo de ocupadas/disponibles).
    habitaciones: parseInt(process.env.HOTEL_HABITACIONES || '85', 10),
    // Primer anio con Libro de Reservas en el Sheet (pestanas del seguimiento anual).
    anioInicio: parseInt(process.env.HISTORICO_DESDE || '2018', 10),
    // Numero (solo digitos, con indicativo) al que se remiten las LLAMADAS por
    // WhatsApp: el numero del bot es de la API y no atiende llamadas.
    // Horarios del hotel (se dicen en las confirmaciones y los recordatorios).
    horaCheckIn: (process.env.HORA_CHECKIN || '3:00 p. m.').trim(),
    horaCheckOut: (process.env.HORA_CHECKOUT || '1:00 p. m.').trim(),
    horaPiscina: (process.env.HORARIO_PISCINA || '11:00 a. m. a 8:00 p. m.').trim(),
    get horarioTexto() {
      const fin = this.horaCheckOut;
      return `Check-in desde las ${this.horaCheckIn} y check-out hasta la ${fin}${fin.endsWith('.') ? '' : '.'}`;
    },
    telefonoLlamadas: (process.env.TELEFONO_LLAMADAS || '573145933714').replace(/\D/g, ''),
    // Numero (solo digitos) del CHAT de Valentina en WhatsApp: a el se remite a quien escribe
    // por Messenger/Instagram y quiere pagar por transferencia (eso solo se atiende por WhatsApp).
    whatsappChat: (process.env.WHATSAPP_CHAT || '573002299991').replace(/\D/g, ''),
  },

  // Pago por TRANSFERENCIA bancaria: Valentina envia los certificados de las cuentas (PDF guardados
  // en la base de datos desde el panel, NO en el repositorio) y reenvia a recepcion por correo el
  // comprobante que mande el cliente. Ver docs/PAGO-TRANSFERENCIA.md.
  transferencia: {
    activa: (process.env.TRANSFERENCIA_ACTIVA || 'true') !== 'false',
    // Peso maximo del comprobante (foto o PDF) que se descarga y se reenvia por correo.
    maxMb: Math.max(1, parseFloat(process.env.COMPROBANTE_MAX_MB || '10') || 10),
    // Tope de comprobantes que se reenvian por reserva (evita llenar el buzon de recepcion).
    maxPorReserva: Math.max(1, parseInt(process.env.COMPROBANTE_MAX_RESERVA || '8', 10) || 8),
    // Texto OPCIONAL que se envia despues de los certificados (p. ej. los numeros de cuenta, para copiarlos).
    // Se define en Render (no en el codigo); "\n" se convierte en salto de linea.
    datosExtra: (process.env.TRANSFERENCIA_DATOS || '').replace(/\\n/g, '\n').trim(),
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
    // Espera maxima a Claude por intento (ms) y reintentos: el cliente no puede esperar minutos una respuesta.
    timeoutMs: Math.max(5000, Number(process.env.IA_TIMEOUT_MS) || 40000),
    reintentos: process.env.IA_REINTENTOS && Number.isFinite(Number(process.env.IA_REINTENTOS)) ? Math.max(0, Number(process.env.IA_REINTENTOS)) : 1,
    // Avisos por correo a recepcion cuando la IA no puede contestar (sin saldo, clave mala, Claude caido...).
    // IA_ALERTAS=false los apaga; el aviso se repite cada IA_ALERTA_CADA_MIN minutos (180 = 3 h) mientras siga caida.
    alertas: process.env.IA_ALERTAS !== 'false',
    alertaCadaMin: Math.max(5, Number(process.env.IA_ALERTA_CADA_MIN) || 180),
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

  // Aviso de "Reserva confirmada" por WhatsApp para las reservas hechas en la
  // PAGINA WEB (Vik Booking). Vik Booking llama a POST /api/vik/confirmada en el
  // instante en que una reserva pasa a CONFIRMADA (pago recibido). Seguro por
  // defecto: apagado (VIK_ACTIVO) y, aun encendido, en MODO PRUEBA (solo anota lo
  // que enviaria) hasta poner VIK_MODO_PRUEBA=false. Ver docs/AVISO-RESERVA-CONFIRMADA.md.
  vik: {
    activo: (process.env.VIK_ACTIVO || 'false') === 'true',
    prueba: (process.env.VIK_MODO_PRUEBA || 'true') !== 'false',
    // Clave compartida con Vik Booking (cabecera X-Malibubot-Key). Sin ella el endpoint queda cerrado.
    key: (process.env.VIK_WEBHOOK_KEY || '').trim(),
    plantilla: (process.env.VIK_PLANTILLA || PLANTILLA_CONFIRMADA.nombre).trim(),
    idioma: (process.env.VIK_PLANTILLA_IDIOMA || 'es').trim(),
    // Reservas que llegan por Booking/Expedia/etc. no tienen celular del huesped: por defecto no se avisan.
    incluirOTA: (process.env.VIK_INCLUIR_OTA || 'false') === 'true',
    // Sincronizacion directa: MALIBUBOT LEE las reservas de Vik Booking (incluidas
    // las de Booking y Expedia que Vik no avisa) llamando al archivo
    // malibubot-sync.php instalado en la web. Vacio = apagado.
    syncUrl: (process.env.VIK_SYNC_URL || '').trim(),
    // Clave propia de la sincronizacion (VIK_SYNC_KEY); si no existe, usa VIK_WEBHOOK_KEY.
    syncKey: (process.env.VIK_SYNC_KEY || process.env.VIK_WEBHOOK_KEY || '').trim(),
    // Solo se cargan reservas con llegada desde esta fecha (YYYY-MM-DD); por defecto, 2026.
    syncDesde: /^\d{4}-\d{2}-\d{2}$/.test((process.env.VIK_SYNC_DESDE || '').trim()) ? process.env.VIK_SYNC_DESDE.trim() : '2026-01-01',
    syncMinutos: Math.max(5, parseInt(process.env.VIK_SYNC_MIN || '15', 10) || 15),
    // Tiempo maximo de cada consulta a malibubot-sync.php (milisegundos).
    syncTimeoutMs: Math.max(1000, parseInt(process.env.VIK_SYNC_TIMEOUT_MS || '30000', 10) || 30000),
    // Archivo .pem opcional con certificados intermedios EXTRA (ademas de los de src/vikbooking/certificados/)
    // para cuando el hosting manda el certificado SSL de la web sin su intermedio.
    caExtra: (process.env.VIK_SYNC_CA_EXTRA || '').trim(),
    // «Despertador» de la IA de Vik (contestador de mensajes de Booking): llama cada pocos minutos a la tarea
    // programada de VikBooking (index.php?option=com_vikbooking&task=crontab); en Joomla 3 nadie la llama sola.
    // Vacio VIK_CRON_URL = la misma web de VIK_SYNC_URL. VIK_CRON_ACTIVO=false lo apaga.
    cronActivo: (process.env.VIK_CRON_ACTIVO || 'true') !== 'false',
    cronUrl: (process.env.VIK_CRON_URL || '').trim(),
    cronMinutos: Math.max(1, parseInt(process.env.VIK_CRON_MIN || '5', 10) || 5),
    cronTimeoutMs: Math.max(5000, parseInt(process.env.VIK_CRON_TIMEOUT_MS || '60000', 10) || 60000),
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
    // Base de la API de Resend. Solo se cambia en pruebas locales con un servidor simulado.
    resendBase: (process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, ''),
    // Remitente (el "De:"). Debe ser una direccion REAL del dominio verificado
    // hotelmalibu.co. OJO: usar una direccion que NO existe como buzon (p.ej.
    // reservasbot@) hace que el propio servidor del dominio RECHACE el correo a
    // recepcion (aunque a externos como Gmail sí llegue). Por eso se usa
    // reservas@ (buzon real y entregable).
    remitente: process.env.CORREO_REMITENTE || 'Reservas Hotel Malibú <reservas@hotelmalibu.co>',
    // A quien le llega el aviso de nueva reserva (recepcion).
    recepcion: process.env.CORREO_RECEPCION || 'reservas@hotelmalibu.co',
    // Copias adicionales de los avisos a recepcion (separadas por coma), p. ej.
    // el correo personal del gerente, por si el buzon del hotel filtra.
    copia: (process.env.CORREO_COPIA || '').split(',').map((s) => s.trim()).filter(Boolean),
    // Destinatarios EXTRA solo para los avisos internos del bot (p. ej. «Valentina no puede responder»), separados por coma.
    alertas: (process.env.CORREO_ALERTAS || '').split(',').map((s) => s.trim()).filter(Boolean),
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
