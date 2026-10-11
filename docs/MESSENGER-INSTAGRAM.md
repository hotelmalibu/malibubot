# Valentina en Messenger (Facebook) e Instagram

Valentina atiende por **WhatsApp, Messenger e Instagram Direct** con el mismo cerebro: mismas
tarifas, la misma promo, las mismas reservas, el mismo panel. Cada cliente aparece en la lista de
conversaciones con su canal (Messenger / Instagram).

El código ya está listo y funcionando. Falta **conectarlo en Meta** (una sola vez) y poner un
token en Render.

## Cómo funciona por dentro

| | WhatsApp | Messenger | Instagram |
|---|---|---|---|
| Identificador del cliente | su número | `fb:<id>` | `ig:<id>` |
| Dónde llegan los mensajes | `/webhook/whatsapp` | `/webhook/meta` | `/webhook/meta` |
| Con qué se responde | token de WhatsApp | token de la **página** | token de la **página** |
| Plantillas fuera de 24 h | sí | no | no |

- Por Messenger/Instagram **no se conoce el celular** del cliente. Valentina se lo pide antes de
  cerrar una reserva (es obligatorio para que recepción lo contacte). La reserva queda a su nombre
  y celular, con el canal en el correo a recepción: «Messenger (bot)» o «Instagram (bot)».
- Los mensajes de pago, confirmación, cancelación y el recordatorio llegan por el mismo chat donde
  se hizo la reserva.
- Meta solo deja escribirle a un cliente **dentro de las 24 h** de su último mensaje. Pasado ese
  tiempo, el recordatorio de llegada usa el celular por WhatsApp si el cliente lo dio.

## Paso a paso en Meta (una sola vez)

Se usa la **misma app de Meta** que ya tiene el WhatsApp de MALIBUBOT.

1. **developers.facebook.com → tu app → Agregar productos:** añade **Messenger** y **Instagram**
   (la API de mensajería de Instagram).
2. **Webhooks.** Para los objetos **Page** (Messenger) e **Instagram**:
   - URL de devolución de llamada: `https://bot.hotelmalibu.co/webhook/meta`
   - Token de verificación: el mismo de WhatsApp (`WHATSAPP_VERIFY_TOKEN` en Render).
   - Suscríbete a los campos **messages** y **messaging_postbacks**.
3. **Suscribe la página:** Messenger → Configuración → *Agregar páginas* → elige la página de
   Hotel Malibú y suscríbela a la app.
4. **Token de la página.** Mejor que sea **permanente** (usuario del sistema en Business Manager con
   la página asignada). Permisos: `pages_messaging`, `pages_manage_metadata`,
   `pages_read_engagement`, `instagram_basic`, `instagram_manage_messages`.
5. **Render → Environment → agrega** (tú escribes el valor, nunca se lo pegues a nadie):
   - `META_PAGE_TOKEN` = el token de la página.
   - Opcional: `META_PAGE_ID` (id de la página) y `META_APP_SECRET` (solo si Messenger/Instagram
     usan una app distinta a la de WhatsApp; si es la misma, no hace falta).
6. **Instagram:** la cuenta del hotel debe ser **profesional** y estar **conectada a la página de
   Facebook**. En la app de Instagram: *Configuración → Mensajes y respuestas a historias →
   Controles de mensajes → Herramientas conectadas → Permitir acceso a los mensajes*.

## Importante: publicar la app

Mientras la app esté en modo **desarrollo**, Valentina solo responde a personas con rol en la app
(administradores, probadores). Para que responda a **cualquier cliente**:

- La app debe estar en modo **Live**.
- Los permisos `pages_messaging` e `instagram_manage_messages` necesitan **acceso avanzado**:
  se solicita con *Revisión de la app* (y verificación del negocio). Meta pide un video corto
  mostrando cómo se responde al cliente. Suele tardar de unos días a 2 semanas.

## Probar

1. Con una cuenta con rol de probador, escribe «Hola» a la página de Facebook y a la cuenta de Instagram.
2. Valentina debe responder y el chat debe aparecer en el panel, con la etiqueta del canal.
3. Si no responde: Render → Logs; busca `[social]` o `Firma invalida`.

## Anuncios

Los anuncios de Facebook e Instagram pueden dirigir a **Messenger** o a **Instagram Direct** además
de WhatsApp. Todas las conversaciones caen en el mismo panel.
