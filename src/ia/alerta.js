// ============================================================
//  alerta.js — Cuando Valentina (la IA) no puede contestar: explica el motivo en español sencillo y avisa por correo
//  a recepcion (y el panel muestra una franja roja) para que alguien lo arregle antes de perder mas clientes.
//
//  Se avisa al PRIMER fallo si el motivo no se arregla solo (sin saldo, clave mala, modelo retirado) y, si es
//  pasajero (Claude saturado, red), cuando van 3 fallos seguidos. El aviso se repite como maximo cada
//  IA_ALERTA_CADA_MIN minutos (180 por defecto) y, cuando la IA vuelve, llega un segundo correo «ya responde».
//  IA_ALERTAS=false apaga los correos. Los destinatarios son los de recepcion (CORREO_RECEPCION / CORREO_COPIA)
//  mas CORREO_ALERTAS.
// ============================================================
import { config } from '../config.js';
import { enviarAlertaInterna } from '../correo/enviar.js';

/**
 * Traduce el error de Claude a una explicacion para el dueño.
 * @param {{estado?:number|null, tipo?:string, mensaje?:string}|null} d  detalle del ultimo fallo (ver agente.js)
 * @returns {{clave:string, permanente:boolean, causa:string, pasos:string[]}|null}
 *   permanente = no se arregla solo (hay que hacer algo); false = suele pasar en minutos.
 */
export function explicarFalloIA(d) {
  if (!d) return null;
  const msg = String(d.mensaje || '');
  const tipo = String(d.tipo || '');
  const est = Number(d.estado) || 0;

  if (tipo === 'sin_clave') {
    return {
      clave: 'sin_clave', permanente: true,
      causa: 'Falta la clave de la IA (ANTHROPIC_API_KEY) en Render, así que Valentina no puede responder.',
      pasos: ['Entra a console.anthropic.com → API Keys y crea una clave.', 'Pégala en Render → tu servicio → Environment → ANTHROPIC_API_KEY (nunca por chat ni correo).'],
    };
  }
  if (/credit balance|purchase credits|plans\s*&\s*billing/i.test(msg)) {
    return {
      clave: 'saldo', permanente: true,
      causa: 'Se acabó el saldo de la cuenta de Anthropic (la empresa de la IA de Valentina), por eso no puede responder.',
      pasos: [
        'Entra a console.anthropic.com con la cuenta donde se creó la clave de Valentina.',
        'Ve a Settings → Billing y pulsa «Buy credits» para comprar saldo.',
        'Activa «Auto reload» (recarga automática) si aparece, para que no vuelva a pasar.',
      ],
    };
  }
  if (est === 401 || tipo === 'authentication_error') {
    return {
      clave: 'clave', permanente: true,
      causa: 'Anthropic no reconoce la clave de la IA (ANTHROPIC_API_KEY): es incorrecta o fue revocada.',
      pasos: ['Crea una clave nueva en console.anthropic.com → API Keys.', 'Reemplázala en Render → tu servicio → Environment → ANTHROPIC_API_KEY (nunca por chat ni correo).'],
    };
  }
  if (est === 403 || tipo === 'permission_error') {
    return {
      clave: 'permiso', permanente: true,
      causa: 'Anthropic no deja usar esta clave (falta de permiso o cuenta bloqueada).',
      pasos: ['Revisa la cuenta en console.anthropic.com y los correos que haya enviado Anthropic.'],
    };
  }
  if (est === 404 || tipo === 'not_found_error') {
    return {
      clave: 'modelo', permanente: true,
      causa: 'El modelo de IA configurado ya no existe o no está disponible para esta cuenta.',
      pasos: ['En Render → Environment revisa ANTHROPIC_MODELO (déjala vacía para usar el modelo por defecto).'],
    };
  }
  if (est === 429 || tipo === 'rate_limit_error') {
    return {
      clave: 'limite', permanente: false,
      causa: 'Anthropic limitó temporalmente las peticiones (llegaron demasiadas seguidas).',
      pasos: ['Suele pasar en minutos. Si se repite, revisa los límites en console.anthropic.com → Settings → Limits.'],
    };
  }
  if (est >= 500 || tipo === 'overloaded_error' || tipo === 'api_error') {
    return {
      clave: 'caida', permanente: false,
      causa: 'Anthropic está saturado o con una falla temporal.',
      pasos: ['Normalmente se arregla solo en minutos. Puedes ver su estado en status.claude.com.'],
    };
  }
  if (/timed? ?out|timeout|connection|econn|enotfound|fetch failed|network/i.test(`${tipo} ${msg}`)) {
    return {
      clave: 'red', permanente: false,
      causa: 'No hubo conexión con Anthropic (red o tiempo de espera agotado).',
      pasos: ['Suele pasar en minutos. Si se repite, revisa status.claude.com y el estado del servicio en Render.'],
    };
  }
  if (tipo === 'sin_texto' || tipo === 'sin_respuesta_final') {
    return {
      clave: 'sin_texto', permanente: false,
      causa: 'La IA respondió pero sin un texto utilizable para el cliente.',
      pasos: ['Si se repite, hay que revisar el chat afectado en Conversaciones.'],
    };
  }
  return {
    clave: 'otro', permanente: false,
    causa: `Error de la IA${est ? ` (${est})` : ''}: ${msg || tipo || 'desconocido'}`.slice(0, 300),
    pasos: ['Si se repite, pide ayuda con el detalle técnico del panel (franja roja → Probar conexión).'],
  };
}

// Estado del aviso (en memoria): cuando se envio el ultimo y si hay uno «abierto» (falta avisar que ya volvio).
const aviso = { ultimo: 0, enviados: 0, abierta: false };

export function estadoAvisoIA() {
  return { activo: config.ia.alertas, enviados: aviso.enviados, ultimo: aviso.ultimo, abierta: aviso.abierta, cadaMin: config.ia.alertaCadaMin };
}

const hora = (ts) => new Date(ts).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const pegar = (...partes) => partes.filter(Boolean).join(' · ');

/**
 * Llamar tras cada fallo de la IA. Manda el correo si corresponde (ver la cabecera).
 * @param {object} d  detalle del fallo (ts, estado, tipo, mensaje, idPeticion)
 * @param {{seguidos?:number, desde?:number, afectados?:number}} racha
 * @returns {Promise<boolean>} true si se envio un correo
 */
export async function avisarFalloIA(d, { seguidos = 1, desde = 0, afectados = 1 } = {}, ahora = Date.now()) {
  if (!config.ia.alertas) return false;
  const ex = explicarFalloIA(d);
  if (!ex || (!ex.permanente && seguidos < 3)) return false;
  const cadaMs = config.ia.alertaCadaMin * 60 * 1000;
  if (aviso.ultimo && ahora - aviso.ultimo < cadaMs) return false;
  aviso.ultimo = ahora; // se reserva el turno ya, para que dos fallos a la vez no manden dos correos
  const ok = await enviarAlertaInterna({
    asunto: '⚠️ Valentina no puede responder a los clientes',
    titulo: 'Valentina no está respondiendo',
    intro: ex.causa,
    filas: [
      ['Desde', desde ? hora(desde) : hora(d.ts)],
      ['Intentos fallidos seguidos', seguidos],
      ['Clientes afectados', afectados],
      ['Detalle técnico', pegar(d.estado ? `HTTP ${d.estado}` : '', d.tipo, String(d.mensaje || '').slice(0, 160))],
      ['Id de la petición', d.idPeticion],
    ],
    pasos: [
      ...ex.pasos,
      'Mientras tanto, los clientes reciben solo un mensaje de espera: en el panel, pestaña Conversaciones, los chats sin respuesta aparecen en «Necesitan atención» para contestarles a mano.',
    ],
  }).catch(() => false);
  if (ok) { aviso.enviados++; aviso.abierta = true; }
  else aviso.ultimo = ahora - cadaMs + 10 * 60 * 1000; // no se pudo enviar: se reintenta en 10 min
  return ok;
}

/**
 * Llamar tras cada respuesta correcta de la IA: si habia un aviso abierto, manda el correo «ya responde de nuevo».
 * @returns {Promise<boolean>}
 */
export async function avisarRecuperadaIA({ desde = 0, afectados = 0 } = {}, ahora = Date.now()) {
  if (!aviso.abierta) return false;
  aviso.abierta = false;
  aviso.ultimo = 0;
  if (!config.ia.alertas) return false;
  return enviarAlertaInterna({
    asunto: '✅ Valentina ya responde de nuevo',
    titulo: 'Valentina volvió a responder',
    intro: 'La IA ya contesta con normalidad.',
    filas: [
      ['Caída', desde ? `${hora(desde)} → ${hora(ahora)}` : ''],
      ['Clientes que recibieron el mensaje de espera', afectados],
    ],
    pasos: ['Revisa en Conversaciones los chats que quedaron «Sin respuesta» para retomarlos.'],
    tono: 'ok',
  }).catch(() => false);
}
