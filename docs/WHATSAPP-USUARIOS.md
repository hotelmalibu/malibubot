# Clientes de WhatsApp con «nombre de usuario» (BSUID)

## Qué pasaba (hallado el 30-oct-2026)

Desde 2026 un cliente de WhatsApp puede activar un **nombre de usuario** y ocultar su número. Cuando escribe al hotel,
Meta **no manda su número** (`messages[].from` y `contacts[].wa_id` vienen vacíos o no vienen): solo manda su identificador
interno, el **BSUID** (`messages[].from_user_id` y `contacts[].user_id`, p. ej. `US.13491208655302741918`).

El bot solo conocía el número. Con esos mensajes:
- se guardaban **sin id de chat** (todos juntos, en un «chat fantasma» sin nombre ni número en el panel);
- Valentina intentaba contestar «a nadie» y **nunca le llegaba nada al cliente**;
- nadie se enteraba (ni el panel ni el correo avisaban).

Al revisar el historial (desde el 21-ago-2026, lo más antiguo que guarda la base) había mensajes de clientes sin contestar en
**51 de los 71 días**. Son mensajes que nadie pudo contestar y **no se pueden recuperar** (no se guardó ni su número ni su BSUID).

Referencia de Meta: <https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids>
(webhook: `from_user_id`, `contacts[].user_id`; envío: `recipient` con el BSUID en vez de `to`).

## Qué hace ahora

| Situación | Qué pasa |
|---|---|
| Llega con número (lo normal) | Igual que siempre: el chat es el número y se le contesta con `to`. Si Meta también manda su BSUID, se anota. |
| Llega **solo con BSUID** | El chat es **`bs:<BSUID>`**, con su nombre de perfil. Valentina le contesta con `recipient` (el BSUID). |
| Escribe solo con BSUID pero ya había hablado con su número | Se reconoce por el BSUID anotado y es el **mismo chat** (se le contesta a su número). |
| No trae **ni número ni BSUID** | No se mete en ningún chat, no se llama a Claude, queda en la bitácora (`/admin/api/whatsapp/sin-numero` → `recientes`, con los *nombres* de los campos que mandó Meta) y **recepción recibe un correo** (máximo uno cada 15 min). |

Para reservar, a quien tiene usuario **se le pide el celular** (como a Instagram/Messenger): la herramienta de reserva lo exige
(`celular`) y no deja ninguna reserva a medias si falta. El pago en línea, en el hotel y la **transferencia** funcionan igual
(los certificados PDF salen al BSUID). Seguimientos, recordatorios, avisos de llamada y «Retomar chats» le escriben por su BSUID.

En el panel se ve **«WhatsApp (sin número)»** (en la lista y en el encabezado del chat), no un «+bs:…». Confirmar reserva desde el
chat deja el celular en blanco para que recepción lo escriba.

## Mensajes viejos sin dueño

Al arrancar, los mensajes que la base tiene **sin id de chat** ya no se juntan en un chat fantasma: quedan aparte
(`/admin/api/whatsapp/sin-numero` → `antiguos`, para ver qué preguntaban). No se pueden contestar.

## Detalles técnicos

- `src/whatsapp/bsuid.js` — `esBsuid`, `bsuidDe`, `idDeBsuid`, `bsuidValido`, `sinCelularConocido`, `destinatario` (`{to}` o `{recipient}`).
- `src/whatsapp/recibir.js` — `parsearMensajes` empareja cada mensaje con **su** contacto (por BSUID o número) y devuelve `from`
  (número o `bs:<BSUID>` o `''`), `bsuid`, `usuario`; `parsearLlamadas` también.
- `src/whatsapp/enviar.js` — `enviarTexto / enviarPlantilla / enviarDocumento` usan `destinatario()`.
- `src/whatsapp/sindestino.js` — bitácora + correo cuando no hay a quién contestar.
- `src/almacen/conversaciones.js` — `obtenerOCrear` **ya no acepta un id vacío**; guarda `bsuid`; `waIdDeBsuid()`;
  `hidratarConversaciones` aparta los mensajes sin dueño (`mensajesSinDuenio()`).
- `src/almacen/db.js` — columna nueva `conversaciones.bsuid` (se crea sola al arrancar; nunca se borra).
- `src/ia/agente.js` — `sistema(canal, { sinCelular })`, `contextoCliente`, `celularDe`; el simulador acepta `canal: "whatsapp_usuario"`.
- Prueba: `node scripts/probar-whatsapp-usuario.js` (WhatsApp, Claude y correo falsos).

## Lo que falta saber

Meta puede mandar el número aunque haya BSUID (si hubo contacto en los últimos 30 días o el cliente está en la agenda). Las plantillas
de **autenticación** no admiten BSUID (el hotel no las usa). Si el correo «un cliente de WhatsApp escribió y no se le pudo contestar»
llega, es que Meta mandó un mensaje sin ninguno de los dos datos: el panel guarda qué campos trajo para revisarlo.
