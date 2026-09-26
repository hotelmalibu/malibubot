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
ticket promedio, en proceso y canceladas, según la fecha en que se **hizo** la reserva. Sigue
el rango de fechas del Dashboard; las barras son los meses del año elegido.
