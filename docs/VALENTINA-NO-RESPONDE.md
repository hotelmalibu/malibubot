# Si Valentina deja de responder

Valentina piensa con la IA de Anthropic (Claude). Cuando esa conexión falla, el cliente recibe solo un mensaje de espera
(«Hola Ana 👋 Gracias por escribir al Hotel Malibú. En un momento te atendemos…») y nadie reserva. Esta guía explica cómo se
nota, qué hacer y qué protecciones tiene el bot.

## Cómo se nota

- **Franja roja arriba del panel** (en todas las pestañas): «⚠️ Valentina no está pudiendo responder desde las HH:MM» con la causa
  en español, los pasos para arreglarlo, cuántos clientes esperan y el botón **Probar conexión ahora**.
- **Correo a recepción** (`CORREO_RECEPCION` + `CORREO_COPIA` + `CORREO_ALERTAS`) con asunto «⚠️ Valentina no puede responder a los
  clientes». Sale al primer fallo si el motivo no se arregla solo (sin saldo, clave mala, modelo retirado) y, si es pasajero
  (Claude saturado, red), al tercer fallo seguido. Se repite como máximo cada 3 h (`IA_ALERTA_CADA_MIN`). Cuando la IA vuelve llega
  «✅ Valentina ya responde de nuevo». `IA_ALERTAS=false` apaga los correos (la franja roja sigue).
- **Conversaciones → «Necesitan atención»**: los chats cuyo último mensaje de la casa fue el de espera aparecen marcados
  **SIN RESPUESTA** (durante 72 h o hasta que conteste la IA o una persona), para contestarles a mano.

## Causas y qué hacer

| Lo que dice el panel / correo | Qué pasó | Qué hacer |
|---|---|---|
| «Se acabó el saldo de la cuenta de Anthropic» (`credit balance is too low`) | Se gastó el saldo prepagado | console.anthropic.com → Settings → Billing → **Buy credits**; activar **Auto reload**. Lo paga el dueño. |
| «Anthropic no reconoce la clave» (401) | `ANTHROPIC_API_KEY` mala o revocada | Crear clave nueva en console.anthropic.com → API Keys y ponerla en Render → Environment (nunca por chat ni correo). |
| «Falta la clave de la IA» | No hay `ANTHROPIC_API_KEY` en Render | Igual que arriba. |
| «El modelo … ya no existe» (404) | `ANTHROPIC_MODELO` apunta a un modelo retirado | Dejar la variable vacía (usa `claude-sonnet-5`) o poner un modelo vigente. |
| «Anthropic está saturado» (5xx/529) o «límite» (429) | Falla pasajera de Anthropic | Suele pasar sola en minutos; estado en status.claude.com. |
| «No hubo conexión con Anthropic» | Red o tiempo de espera (40 s) | Pasajero; si se repite, revisar Render. |

Después de arreglarlo, en la franja roja pulsar **Probar conexión ahora**: hace dos llamadas mínimas (una vacía y otra con las
instrucciones y herramientas reales de Valentina; no toca reservas ni escribe a clientes). Si salen bien, la franja se apaga sola
y llega el correo «ya responde de nuevo».

## Cuánto gasta

Las métricas del bot (pestaña «Monitor de tokens») muestran el costo estimado de la IA: en septiembre–octubre de 2026 fue de
≈ COP 1.800 al día (≈ US$0,45), unos US$13 al mes, con picos de ≈ COP 4.000 en días de campaña. Es una estimación del bot, no
la factura de Anthropic (esa está en console.anthropic.com → Usage / Billing).

## Qué hace el bot para no empeorarlo

- El mensaje de espera **lleva el primer nombre** del cliente y **no se repite** a un mismo chat antes de 30 min (antes salía igual
  en cada mensaje).
- La IA **no lee** ese mensaje de espera en el historial cuando vuelve (si no, lo imitaba).
- Los **seguimientos automáticos** («Quedé pendiente de tu reserva») se pausan mientras la IA está caída (solo se permite uno por
  chat y se gastaba en clientes que nunca recibieron una respuesta real).
- Claude espera como máximo **40 s por intento** y reintenta **1 vez** (`IA_TIMEOUT_MS`, `IA_REINTENTOS`); antes eran 10 minutos y 2 reintentos.

## Para quien programa

- Código: `src/ia/respaldo.js` (mensaje de espera y marca «sin respuesta»), `src/ia/alerta.js` (causa en español y correos),
  `src/ia/agente.js` (`saludIA()`, `probarIA()`, `iaCaida()`), `src/correo/enviar.js` (`enviarAlertaInterna`),
  franja en `src/admin/panel.html` (`cargarSaludIA`).
- API del panel (con sesión): `GET /admin/api/ia/estado` (fallos seguidos, últimos 10 errores con estado, tipo, mensaje e id de
  petición, causa y pasos, chats sin respuesta) y `POST /admin/api/ia/diag` (prueba de conexión).
- En el log de Render cada fallo sale como `[ia] No se pudo responder (400 · invalid_request_error): … · id req_…`.
- Pruebas (sin tocar Meta, Anthropic ni Resend): `node scripts/probar-salud-ia.js`, `node scripts/probar-respaldo.js` y, de punta a punta con el servidor real, `node scripts/probar-webhook-respaldo.js`.

## Incidente del 20-oct-2026

La última respuesta real de Valentina fue el 19-oct a las 11:09 p. m.; desde las 9:08 a. m. del 20-oct todo fue el mensaje
genérico (26 veces a 9 clientes) porque se acabó el saldo prepagado de Anthropic. Los fallos eran invisibles: no había franja,
correo ni marca en el panel, y el mensaje se repetía idéntico. De ahí salieron estas protecciones.
