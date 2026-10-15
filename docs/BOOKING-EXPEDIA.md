# Booking.com y Expedia en el panel de MALIBUBOT

## Cómo llega la información

Booking.com y Expedia **no entregan sus datos directamente a un hotel por API**: solo a
proveedores de conectividad certificados. El hotel ya tiene uno: **Vik Booking + Vik
Channel Manager (e4jConnect)**.

```
Booking.com ─┐
Expedia ─────┼─► Vik Channel Manager ─► Vik Booking ─► MALIBUBOT (panel)
Página web ──┘                          (malibubot.php)
```

Cada vez que una reserva se confirma (o se cancela) en Vik Booking, el archivo
`malibubot.php` avisa a MALIBUBOT con el canal de origen. MALIBUBOT la registra como:

| Origen en el panel | Cómo se detecta |
|---|---|
| Web directa | Sin canal externo |
| Booking.com | Canal `booking...` o correo `@guest.booking.com` |
| Expedia | Canal `expedia...` / `hotels.com` / `vrbo` o correo de Expedia |
| Otros | Canal externo sin identificar (Airbnb, etc.) y reservas manuales |
| MALIBUBOT · WhatsApp | Reservas cerradas por Valentina o desde el chat |

## Conectar Booking.com (una sola vez)

1. **Booking Extranet** → *Cuenta* → *Proveedor de conectividad* → elegir **E4J CONNECT** y
   confirmar. (Booking pide confirmación por correo; e4jConnect revisa la solicitud.)
2. **Joomla** → *Vik Channel Manager* → *Booking.com* → *Settings*: escribir el **Hotel ID** de
   Booking y guardar.
3. *Hotel → Synchronize Rooms*: enlazar cada tipo de habitación de Booking con **una** de la web.
4. *Import* (opcional): descarga a Vik las reservas activas de Booking. Solo si no las habías
   escrito a mano, para no duplicar.
5. *Bulk Actions*: subir disponibilidad y tarifas. **Ojo:** al conectar un channel manager,
   Booking reinicia tarifas y disponibilidad de la propiedad.

## Conectar Expedia (una sola vez)

1. **Expedia Partner Central** → *Expedia Connectivity Settings*: en *Provider for updating
   rates and availability* y en *Provider for receiving reservations* elegir **e4jConnect**.
2. Copiar el **Hotel ID** de Expedia.
3. **Joomla** → *Vik Channel Manager* → *Expedia*: pegar el Hotel ID, sincronizar habitaciones
   y subir tarifas/disponibilidad.

## Que las estadísticas salgan bien

- En Joomla debe estar instalado el **último** `malibubot.php`
  (`/administrator/components/com_vikbooking/smsapi/malibubot.php`), el que manda el campo
  `channel`. Si la versión instalada es vieja, las reservas de Booking/Expedia caen en «Otros».
- Para que Vik avise de las reservas de Booking y Expedia, la pasarela «MALIBUBOT» debe estar
  seleccionada en el envío automático de Vik Booking (el mismo aviso que ya usa la web).
- MALIBUBOT **no** le escribe por WhatsApp a los huéspedes de Booking/Expedia (Booking y
  Expedia ocultan el celular); solo los registra para la estadística
  (`VIK_INCLUIR_OTA=true` cambiaría eso, no se recomienda).
- Una notificación repetida no duplica la reserva (se identifica por `vik:<id>`).

## Qué mide el Dashboard

*Reservas por canal de venta*: por cada origen, reservas confirmadas, noches, ingresos,
ticket promedio, en proceso y canceladas, según la fecha en que se **hizo** la reserva. Tiene
su propio selector de periodo (por defecto, todos los tiempos); las barras son los meses del año elegido.

## Si las reservas de Booking o Expedia no aparecen en el panel

La pasarela `malibubot.php` solo avisa cuando Vik Booking la llama, y Vik no siempre lo
hace con las reservas que llegan de Booking.com o Expedia. Para no depender de ese aviso,
MALIBUBOT puede **leer las reservas directamente de Vik Booking** cada 15 minutos.

Instalación (una sola vez):

1. Sube `vikbooking/malibubot-sync.php` a la **raíz de la web** (la misma carpeta donde está
   `configuration.php` de Joomla), por el administrador de archivos del hosting o FTP.
2. Inventa una clave propia para la sincronización (una frase larga, sin espacios) y escríbela en el archivo, en la línea `$CLAVE = '...';`.
3. En Render → Environment agrega `VIK_SYNC_KEY` = esa misma clave (si no existe, se usa `VIK_WEBHOOK_KEY`) y `VIK_SYNC_URL` = `https://www.hotelmalibu.co/malibubot-sync.php`
   (opcional: `VIK_SYNC_MIN` = minutos entre lecturas, 15 por defecto).
4. En el Dashboard → *Reservas por canal de venta*, pulsa **Sincronizar con Vik ahora**.

Cómo funciona:

- Trae TODAS las reservas de Vik (web, Booking, Expedia), con su fecha original, y las
  canceladas también. Una reserva repetida no se duplica.
- No manda WhatsApp. Solo avisa por correo a recepción de las reservas NUEVAS de las últimas
  36 horas; lo anterior se registra en silencio.
- El archivo es de solo lectura, no devuelve datos de pago y solo responde con la clave.
  Quien tenga la clave puede leer nombres, correos y celulares de los huéspedes: trátala como
  una contraseña.

### Si el panel dice «Vik Booking: Falló: …»

El mensaje dice la causa. No tiene nada que ver con la suscripción de Vik Channel Manager: la lectura va directo a la web, sin pasar por el Channel Manager.

| El panel dice | Qué pasa | Qué hacer |
|---|---|---|
| «No se pudo verificar el certificado SSL de la web (UNABLE_TO_VERIFY_LEAF_SIGNATURE)… sin su certificado intermedio» | El hosting instaló el certificado SSL sin su intermedio (o con el de otra autoridad). Los navegadores lo completan solos; el bot no. Ver abajo. | Pedir al hosting que instale la cadena completa. Mientras tanto el bot lo compensa solo (ver abajo). |
| «El certificado SSL de la web está vencido» | El certificado de `www.hotelmalibu.co` venció. | Renovarlo en el hosting. |
| «El certificado SSL no corresponde al dominio de VIK_SYNC_URL» | `VIK_SYNC_URL` apunta a un nombre que el certificado no cubre. | Usar `https://www.hotelmalibu.co/malibubot-sync.php`. |
| «Clave incorrecta (el archivo tiene N caracteres y Render envió M)» | La clave del archivo PHP y `VIK_SYNC_KEY` en Render no son iguales. | Dejar las dos idénticas. |
| «respuesta 465 (no es JSON…)» o «respuesta 466» | El firewall de la web bloqueó la petición (rechaza las que no traen User-Agent o parecen un robot). | El bot manda `User-Agent: MALIBUBOT-sync/1.0`; si vuelve a pasar, permitirlo en el firewall del hosting. |
| «respuesta 404/500 (no es JSON…)» | El archivo `malibubot-sync.php` no está en la raíz de la web, o PHP falló. | Revisar que esté junto a `configuration.php`. |
| «No se encontró el dominio…», «La web cortó la conexión», «La web no respondió a tiempo» | Problema de red o la web está caída. | Abrir `https://www.hotelmalibu.co` y reintentar con el botón. |

**Cadena de certificados incompleta (13-oct-2026).** El certificado de la web se renovó ese día (RapidSSL, vigente hasta el 29-abr-2027) pero el servidor siguió enviando
los intermedios de Sectigo del certificado anterior. Desde entonces la lectura fallaba con `fetch failed`. Dos arreglos:

1. **De fondo (hosting):** instalar como CA bundle el intermedio *RapidSSL TLS RSA CA G1* (`http://cacerts.rapidssl.com/RapidSSLTLSRSACAG1.crt`). Se comprueba con
   `openssl s_client -connect www.hotelmalibu.co:443 -servername www.hotelmalibu.co -showcerts` (deben llegar la hoja y el intermedio de RapidSSL) o en
   <https://www.ssllabs.com/ssltest/>. Instalar certificados es un ajuste del hosting, no del bot.
2. **En el bot (ya hecho):** si la conexión normal falla por cadena incompleta, `src/vikbooking/sincronizar.js` reintenta confiando en las raíces de Node **más** los intermedios
   de `src/vikbooking/certificados/` (ver su `LEEME.md`). Se sigue verificando la cadena hasta una raíz de confianza y el nombre del dominio. El panel muestra «⚠️ Certificado SSL de
   la web incompleto (el bot lo compensa; avisa al hosting)» mientras el hosting no lo arregle. Ese intermedio vence el **2-nov-2027**.

Prueba automática (sin tocar producción; necesita `openssl`): `node scripts/probar-sync-ssl.js`.
