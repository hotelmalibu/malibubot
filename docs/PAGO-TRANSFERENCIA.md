# Pago por transferencia (certificados de las cuentas + comprobante a recepción)

Tercera forma de pagar de Valentina, junto al pago en línea (RAPYD) y el pago en el hotel.

## Cómo funciona

1. **El cliente elige transferir** (dice «transferencia», «consignación», «a qué cuenta pago»…). Valentina usa la herramienta
   `reservar_pago_transferencia` con sus datos (tipo de habitación, fechas, nombre; el correo es opcional):
   - deja la reserva **EN PROCESO** (no confirmada) y la marca como transferencia (la referencia de pago dice
     «Transferencia bancaria · esperando comprobante»);
   - le manda por WhatsApp, en dos mensajes aparte, los **certificados de las cuentas del hotel** (Davivienda y Bancolombia, PDF);
   - le explica que puede transferir el **total o un abono** y que, apenas transfiera, envíe la **foto o el PDF del comprobante por el mismo chat**.
   - Si el cliente la pide otra vez, reenvía los certificados **sin duplicar la reserva**.
2. **El cliente manda el comprobante** (foto o PDF). El bot lo descarga de WhatsApp y lo **reenvía por correo a
   `reservas@hotelmalibu.co`**, adjunto, con los datos de la reserva (huésped, celular, habitación, fechas, valor total, estado) y lo que
   el cliente escribió. Al cliente le responde «Recibí tu comprobante, ya se lo pasé a recepción… apenas lo verifiquen te confirmo».
   - La reserva queda con «Transferencia bancaria · comprobante recibido (n)» (se ve en el panel).
   - Aplica a pagos **parciales o completos**: cada comprobante se reenvía; recepción decide.
   - Si recepción tiene el control del chat (modo humano), el comprobante igual se reenvía por correo, pero el bot no le escribe al cliente.
3. **Recepción verifica en el banco** y, en el panel (Dashboard → tabla de reservas), pulsa:
   - **Pago total verificado** → la reserva queda **Pagada**; el cliente recibe su confirmación por WhatsApp (y por correo si dio uno).
   - **Abono verificado** → la reserva queda **confirmada con el saldo pendiente** (estado «Pago en hotel»); el cliente recibe el aviso del abono.
     Si después manda el comprobante del saldo, se reenvía igual y recepción pulsa «Pago total verificado».
   - «Rechazar» / «Cancelar» funcionan como siempre.

El mismo seguimiento automático de siempre (una sola vez, a las 3 h) le recuerda al cliente que **falta su comprobante** (en vez del mensaje genérico).

## Los certificados NO están en el repositorio

El repositorio de GitHub es **público** y los certificados traen número de cuenta y NIT. Por eso los PDF se **suben desde el panel** y quedan
en la base de datos privada (PostgreSQL, tabla `documentos`):

- Panel → **Monitor conversaciones** → al final, **🏦 Pago por transferencia**.
- En cada banco: **Subir PDF** (o **Reemplazar PDF**), **Ver** (abre el PDF cargado) y **Quitar**.
- Solo se aceptan PDF de hasta 3 MB. Si cambian de cuenta o llega un certificado nuevo, se reemplaza ahí mismo; no hace falta tocar código ni Render.
- **Enviarme una prueba**: manda los dos certificados a tu celular (para que llegue, ese número tiene que haberle escrito al bot en las últimas 24 h; es regla de WhatsApp).
- Mientras falte alguno, si un cliente pide transferir Valentina **no promete nada**: le dice que recepción le enviará los datos y deja el chat
  marcado para atención. No se crea ninguna reserva fantasma.

Certificados entregados el 14-oct-2026: Davivienda (cuenta corriente, certificación del 15-sep-2026) y Bancolombia (cuenta corriente, certificado del 8-feb-2025),
ambos de HOTEL Y CENTRO DE EVENTOS MALIBU SAS. Los números de cuenta **no están en el código**: solo en los PDF.

## Variables opcionales (Render → Environment)

| Variable | Para qué | Por defecto |
|---|---|---|
| `TRANSFERENCIA_ACTIVA` | `false` apaga la opción (Valentina deja de ofrecerla y no se reenvían comprobantes) | encendida |
| `TRANSFERENCIA_DATOS` | Texto extra que se envía después de los certificados (p. ej. los números de cuenta para copiarlos). `\n` = salto de línea | vacío |
| `COMPROBANTE_MAX_MB` | Peso máximo del comprobante que se descarga y se reenvía | 10 |
| `COMPROBANTE_MAX_RESERVA` | Tope de comprobantes reenviados por reserva (evita llenar el buzón) | 8 |
| `WHATSAPP_CHAT` | Número del chat de Valentina (a quien escribe por Messenger/Instagram y quiere transferir se le remite ahí) | 573002299991 |
| `RESEND_API_BASE` | Solo para pruebas con un Resend simulado | `https://api.resend.com` |

El destino del correo es el de siempre: `CORREO_RECEPCION` (por defecto `reservas@hotelmalibu.co`) más las copias de `CORREO_COPIA`.

## Límites y casos especiales

- **Solo WhatsApp.** Por Messenger e Instagram no se envían documentos; si alguien pide transferir ahí, Valentina le da el enlace al WhatsApp del hotel.
- Solo se reenvían **fotos (JPG/PNG/WebP) y PDF**. Un Excel, un video o un archivo muy pesado → Valentina pide una foto o PDF más liviano.
- Una foto o PDF de un cliente que **no** tiene una transferencia pendiente sigue el flujo de siempre (el aviso con el número de llamadas).
- Si el archivo no se puede descargar o el **correo falla**, Valentina **no** dice que ya se lo pasó a recepción: pide disculpas, sugiere enviarlo a
  `reservas@hotelmalibu.co` y deja el chat **marcado para atención** (pasa a modo recepción).
- Un mismo archivo repetido por Meta (reintento del webhook) no se reenvía dos veces.
- Todo lo que escribe el cliente va **escapado** en el correo (nombre y mensajes), por seguridad.

## Dónde está el código

| Pieza | Archivo |
|---|---|
| Herramienta y reglas de Valentina | `src/ia/agente.js` (`reservar_pago_transferencia`, sección de formas de pago del prompt) |
| Envío de certificados, recepción del comprobante, verificación | `src/pagos/transferencia.js`, `src/pagos/confirmar.js` (`confirmarAbonoTransferencia`) |
| Subir/descargar archivos de WhatsApp | `src/whatsapp/enviar.js` (`subirMedia`, `enviarDocumento`, `descargarMedia`), `src/whatsapp/recibir.js` |
| Correo con adjunto | `src/correo/enviar.js` (`enviarComprobanteTransferencia`) |
| Certificados en la base | `src/datos/documentos.js`, `src/almacen/db.js` (tabla `documentos`) |
| Panel (sección, botones, API) | `src/admin/panel.html`, `src/admin/rutas.js` (`/api/transferencia…`, `/api/reservas/:id/estado` con `verificacion`) |
| Prueba automática | `scripts/probar-transferencia.js` |

## Probar

```bash
node scripts/probar-transferencia.js
```

Levanta un WhatsApp y un Resend **falsos**, arranca el servidor y recorre todo: certificados, comprobante (foto y PDF), correo con adjunto,
fallos, modo recepción, panel y verificación. No toca producción.

## Primer uso en producción

1. Desplegar (Render hace el despliegue al subir a `main`).
2. Entrar al panel → Monitor conversaciones → **Pago por transferencia** y subir los dos PDF.
3. Pulsar **Enviarme una prueba** con tu celular (tras escribirle al bot) y revisar que lleguen los dos certificados.
4. Hacer una reserva de prueba por WhatsApp eligiendo transferencia y mandar una foto cualquiera como «comprobante»: debe llegar a `reservas@hotelmalibu.co`
   con la foto adjunta. Después cancelar esa reserva de prueba desde el panel.
