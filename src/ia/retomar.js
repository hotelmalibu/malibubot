// ============================================================
//  retomar.js — Retomar los chats que se quedaron SIN RESPUESTA por una falla de la IA: Valentina les escribe pidiendo
//  disculpas y contestando lo que preguntaron, UNA vez a cada uno. Se puede ver una vista previa (sin enviar), correr ahora,
//  o dejar programado a una hora (se guarda en la base de datos y sobrevive a los reinicios). Al terminar llega un correo
//  con el resumen a recepcion.
//
//  Solo se le escribe a quien el canal lo permite: dentro de las 24 h desde su ultimo mensaje (WhatsApp, Instagram y Messenger).
//  No se le escribe a quien ya atiende una persona, ya tiene reserva confirmada o ya recibio una respuesta de verdad.
//  El mensaje nunca crea una reserva por si solo (ver redactarRetomada en agente.js).
// ============================================================
import { store } from '../almacen/conversaciones.js';
import { ajustesStore } from '../almacen/ajustes.js';
import { enviarTexto } from '../whatsapp/enviar.js';
import { enviarAlertaInterna } from '../correo/enviar.js';
import { sinRespuestaIA } from './respaldo.js';
import { redactarRetomada, iaCaida } from './agente.js';
import { waIdsCerrados } from './seguimiento.js';

const VENTANA_MS = 24 * 60 * 60 * 1000;
const MARGEN_MS = 15 * 60 * 1000;   // no se intenta en los ultimos 15 min de la ventana de 24 h
const TARDE_MS = 6 * 60 * 60 * 1000; // una retomada programada que se pierde por mas de 6 h ya no corre sola
const CLAVE = 'retomada_programada';
const MAX_TEXTO = 1500; // largo maximo de un mensaje escrito/editado en el panel
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** null si se le puede escribir; si no, el motivo en español. */
function motivoParaOmitir(conv, ahora, cerrados) {
  if (conv.modo === 'humano') return 'lo atiende una persona';
  if (!sinRespuestaIA(conv, ahora)) return 'ya se le contestó';
  if (cerrados.has(conv.waId)) return 'ya tiene una reserva confirmada';
  const ult = store.ultimoEntrante(conv.waId);
  if (!ult || ahora - ult > VENTANA_MS - MARGEN_MS) return 'pasaron más de 24 h desde su último mensaje: el canal ya no permite escribirle';
  return null;
}

function ultimoTextoDelCliente(conv) {
  for (let i = conv.mensajes.length - 1; i >= 0; i--) {
    const m = conv.mensajes[i];
    if (m.autor === 'cliente' && String(m.texto || '').trim()) return String(m.texto).replace(/\s+/g, ' ').slice(0, 90);
  }
  return '';
}

/** Chats «sin respuesta», el que antes pierde su ventana de 24 h primero. */
export function listarPendientes(ahora = Date.now()) {
  const cerrados = waIdsCerrados();
  return store.listar()
    .filter((c) => c.sinRespuestaIA)
    .map((c) => {
      const conv = store.obtener(c.waId);
      const ult = store.ultimoEntrante(c.waId);
      const motivo = motivoParaOmitir(conv, ahora, cerrados);
      return { waId: c.waId, nombre: c.nombre || '', ultimoDelCliente: ult, ventanaHasta: ult + VENTANA_MS, ultimoTexto: ultimoTextoDelCliente(conv), elegible: !motivo, motivo: motivo || '' };
    })
    .sort((a, b) => a.ultimoDelCliente - b.ultimoDelCliente);
}

/**
 * Retoma UN chat: redacta el mensaje con disculpas y, si `enviar`, lo manda y lo anota (con eso el chat deja de estar «sin respuesta»).
 * @returns {Promise<{waId:string, nombre:string, estado:'enviado'|'borrador'|'omitido'|'fallo', motivo?:string, texto?:string}>}
 */
export async function retomarChat(waId, { enviar = true, ahora = Date.now(), texto = '' } = {}) {
  const conv = store.obtener(waId);
  const base = { waId, nombre: conv?.nombre || '' };
  if (!conv) return { ...base, estado: 'omitido', motivo: 'no existe la conversación' };
  const motivo = motivoParaOmitir(conv, ahora, waIdsCerrados());
  if (motivo) return { ...base, estado: 'omitido', motivo };

  // `texto`: un mensaje ya escrito (el borrador que una persona revisó o editó en el panel): se manda tal cual, sin pedirle otro a la IA.
  let cuerpo = String(texto || '').replace(/\r\n/g, '\n').trim();
  if (cuerpo.length > MAX_TEXTO) return { ...base, estado: 'fallo', motivo: `el mensaje es demasiado largo (máximo ${MAX_TEXTO} caracteres)` };
  if (!cuerpo) {
    const r = await redactarRetomada(waId);
    if (!r.ok) return { ...base, estado: 'fallo', motivo: r.motivo };
    cuerpo = r.texto;
  }
  if (!enviar) return { ...base, estado: 'borrador', texto: cuerpo };

  // Mientras la IA redactaba pudo cambiar algo (el cliente escribio y ya le contestaron, lo tomo una persona...): se vuelve a mirar.
  const motivo2 = motivoParaOmitir(conv, Date.now(), waIdsCerrados());
  if (motivo2) return { ...base, estado: 'omitido', motivo: motivo2 };
  try {
    await enviarTexto(waId, cuerpo);
  } catch (err) {
    return { ...base, estado: 'fallo', motivo: `no se pudo enviar: ${err.message}`, texto: cuerpo };
  }
  store.registrarSaliente({ waId, autor: 'bot', texto: cuerpo });
  return { ...base, estado: 'enviado', texto: cuerpo };
}

function contar(resultados) {
  const n = (e) => resultados.filter((x) => x.estado === e).length;
  return { enviados: n('enviado'), borradores: n('borrador'), omitidos: n('omitido'), fallos: n('fallo') };
}

/**
 * Retoma todos los chats pendientes, uno tras otro (con una pausa entre envios para no mandarlos en rafaga).
 * Con `enviar:false` solo redacta los borradores (en paralelo) y no toca nada.
 */
export async function retomarPendientes({ enviar = true, pausaMs = 3000 } = {}) {
  const inicio = Date.now();
  if (enviar && iaCaida()) return { inicio, fin: Date.now(), enviar, abortado: 'La IA no está respondiendo ahora: no se envió nada.', resultados: [], ...contar([]) };
  const lista = listarPendientes(inicio);
  const salto = (p) => ({ waId: p.waId, nombre: p.nombre, estado: 'omitido', motivo: p.motivo });
  let resultados;
  if (!enviar) {
    resultados = await Promise.all(lista.map((p) => (p.elegible ? retomarChat(p.waId, { enviar: false }) : salto(p))));
  } else {
    resultados = [];
    let primero = true;
    for (const p of lista) {
      if (!p.elegible) { resultados.push(salto(p)); continue; }
      if (!primero && pausaMs) await espera(pausaMs);
      primero = false;
      resultados.push(await retomarChat(p.waId, { enviar: true }));
    }
  }
  return { inicio, fin: Date.now(), enviar, resultados, ...contar(resultados) };
}

// ---------------- Programacion (una sola vez, guardada en la base de datos) ----------------

/** @returns {{cuando:number, hecho:boolean, programada?:number, inicio?:number, fin?:number, vencida?:boolean, resumen?:object}|null} */
export function estadoRetomada() {
  try {
    const v = JSON.parse(ajustesStore.obtener(CLAVE, '') || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}
export function programarRetomada(cuandoMs) {
  const v = { cuando: cuandoMs, hecho: false, programada: Date.now() };
  ajustesStore.poner(CLAVE, JSON.stringify(v));
  return v;
}
export function cancelarRetomada() { ajustesStore.poner(CLAVE, ''); }

const hora = (ts) => new Date(ts).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

async function avisarResumen(r) {
  const c = contar(r.resultados || []);
  const mal = r.abortado || c.fallos > 0;
  const filas = (r.resultados || []).slice(0, 25).map((x) => [x.nombre || x.waId.replace(/\d(?=\d{4})/g, '•'), x.estado === 'enviado' ? 'Mensaje enviado ✓' : `${x.estado === 'omitido' ? 'No se le escribió' : 'No se pudo'}: ${x.motivo || ''}`]);
  return enviarAlertaInterna({
    asunto: `${mal ? '⚠️' : '✅'} Valentina retomó ${c.enviados} chat${c.enviados === 1 ? '' : 's'} que quedaron sin respuesta`,
    titulo: 'Valentina retomó los chats sin respuesta',
    intro: r.abortado || `Escribió con disculpas a ${c.enviados} cliente${c.enviados === 1 ? '' : 's'}${c.omitidos ? `; ${c.omitidos} no se retomaron` : ''}${c.fallos ? `; ${c.fallos} fallaron` : ''}.`,
    filas,
    pasos: ['En Conversaciones puedes ver cada mensaje. Los que no se retomaron (si hay) siguen en «Necesitan atención» para contestarles a mano.'],
    tono: mal ? 'alerta' : 'ok',
  });
}

/**
 * Corre la retomada programada si ya es la hora. Se marca «hecha» ANTES de empezar, asi nunca se corre dos veces
 * (si el servidor se reinicia a la mitad, cada chat ya retomado no vuelve a salir como pendiente).
 */
export async function revisarRetomada(ahora = Date.now()) {
  const p = estadoRetomada();
  if (!p || p.hecho || ahora < p.cuando) return null;
  if (ahora - p.cuando > TARDE_MS) { ajustesStore.poner(CLAVE, JSON.stringify({ ...p, hecho: true, vencida: true })); return null; }
  ajustesStore.poner(CLAVE, JSON.stringify({ ...p, hecho: true, inicio: ahora }));
  console.log('[retomar] Es la hora: Valentina retoma los chats sin respuesta…');
  let r;
  try { r = await retomarPendientes({ enviar: true }); } catch (err) { r = { abortado: `Error inesperado: ${err.message}`, resultados: [] }; }
  ajustesStore.poner(CLAVE, JSON.stringify({ ...p, hecho: true, inicio: ahora, fin: Date.now(), resumen: { ...contar(r.resultados || []), ...(r.abortado ? { abortado: r.abortado } : {}) } }));
  console.log(`[retomar] Listo: ${contar(r.resultados || []).enviados} enviados (${hora(Date.now())}).`);
  await avisarResumen(r).catch((e) => console.error('[retomar] correo de resumen:', e.message));
  return r;
}

/** Revisa cada minuto si toca (y una vez al arrancar, por si el servidor volvio justo a la hora). */
export function iniciarRetomadas() {
  const mirar = () => revisarRetomada().catch((e) => console.error('[retomar]', e.message));
  setTimeout(mirar, 20_000).unref?.();
  setInterval(mirar, 60_000).unref?.();
}
