# Retomar chats sin respuesta

Cuando Valentina no pudo contestar (sin saldo de Anthropic, clave mala, Claude caído…), el cliente solo recibe el mensaje de
espera y el chat queda marcado **SIN RESPUESTA** (ver `docs/VALENTINA-NO-RESPONDE.md`). Este módulo le escribe a esos clientes
**con disculpas** y respondiendo lo que preguntaron, **una sola vez a cada uno**.

## En el panel: pestaña «Retomar chats»

- Tarjetas: sin respuesta · se pueden retomar · no se les puede escribir · envío programado.
- Cada chat muestra canal, qué escribió, y **cuánto tiempo queda** para escribirle (24 h desde su último mensaje).
- **✨ Preparar mensaje** (uno) o **Preparar los mensajes de Valentina** (todos): Valentina redacta el borrador; **se puede editar**.
- **📤 Enviar** (uno) o **Enviar los N preparados** (con confirmación y una pausa entre mensajes): se manda el texto que se ve en el recuadro.
- **⏰ Programar el envío** a una hora (máx. dentro de las próximas 23 h): a esa hora Valentina redacta y envía sola, y llega un correo
  a recepción con el resumen. Se guarda en la base de datos (sobrevive a reinicios); si el servidor estuvo apagado más de 6 h a esa hora, no corre.
- Los que se retoman salen de «Sin respuesta» y quedan anotados en «Retomados en esta sesión». El contador rojo de la pestaña son los que se pueden retomar.

## Quién NO se retoma

Lo atiende una persona (modo humano) · ya tiene reserva confirmada · ya se le contestó · pasaron más de 24 h desde su último mensaje
(WhatsApp, Instagram y Messenger no dejan escribir después). Cada uno dice por qué.

## El mensaje nunca reserva solo

`redactarRetomada()` (`src/ia/agente.js`) solo permite consultar disponibilidad: si el modelo intenta reservar, la herramienta lo rechaza
y debe confirmar los datos y pedir que el cliente responda. El aviso al modelo le pide una disculpa breve y sin detalles técnicos.

## API (con la sesión del panel)

`GET /admin/api/ia/retomar` · `POST /admin/api/ia/retomar/vista-previa` (solo redacta) · `POST /admin/api/ia/retomar/chat`
(`{waId, accion:"borrador"|"enviar", texto?}`) · `POST /admin/api/ia/retomar/programar` (`{cuando: ISO}`) · `POST /admin/api/ia/retomar/cancelar` ·
`POST /admin/api/ia/retomar/ahora` (`{confirmar:true}`; escribe a todos). Código: `src/ia/retomar.js`.

## Probarlo sin riesgo

`node scripts/demo-retomar.js` abre el panel en `http://localhost:3006/admin` (usuario cualquiera, clave `prueba-local`) con clientes
de ejemplo y WhatsApp/Instagram/Messenger, correo e IA **simulados** (los borradores los escribe una plantilla, no Valentina).
Pruebas automáticas: `node scripts/probar-retomar.js` y `node scripts/probar-retomar-panel.js`.
