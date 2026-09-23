# Aviso "Reserva confirmada" por WhatsApp (Vik Booking → MALIBUBOT)

Cuando una reserva de la **página web** pasa a **confirmada** (el pago quedó hecho), MALIBUBOT le
escribe al huésped por WhatsApp:

> Hola Carlos, tu reserva N.° 1234 en el Hotel Malibú quedó confirmada y tu pago fue recibido.
> Ingreso: viernes 2 de octubre. Salida: sábado 3 de octubre. Puedes ver los detalles aquí: <enlace>
> Te esperamos en la Calle 32A No. 32-04, Sincelejo.

## Cómo funciona

```
Vik Booking (reserva pasa a CONFIRMADA) ──pasarela "malibubot"──▶ POST /api/vik/confirmada ──▶ MALIBUBOT ──plantilla──▶ WhatsApp
   vikbooking/malibubot.php  (en el sitio)                         (Render, cabecera X-Malibubot-Key)
```

- Vik Booking ya trae el disparador ("envío automático cuando la reserva se confirma"); solo se le agrega una
  pasarela nueva que, en vez de un SMS, llama a MALIBUBOT.
- El archivo del sitio **no toca la base de datos**: solo hace una llamada HTTPS a MALIBUBOT.
- **Panel:** cada reserva que Vik Booking confirma queda **registrada en el panel de MALIBUBOT**
  (canal *Página web*, o *OTA* si viene de Booking/Expedia), con huésped, celular, habitación, personas,
  ingreso, salida y valor. Se identifica con la referencia `vik:<número de Vik>` y no se duplica. Si Vik
  llama con la reserva cancelada, pasa a *cancelada*; si está en espera, queda *en proceso*.
  Esas reservas **se gestionan en Vik Booking** (en el panel no tienen botones de pagar/cancelar) y cuentan
  en la meta semanal como "de la web".
- **Un solo aviso por reserva**, aunque Vik llame dos veces. Si WhatsApp rechaza el envío, no se marca y se puede
  reintentar desde Vik ("reenviar SMS" en el detalle de la reserva).
- Las reservas de Booking/Expedia (sin celular del huésped) y las que no tienen celular válido se omiten.
- **Seguro por defecto:** apagado (`VIK_ACTIVO`) y, encendido, en **modo prueba** (`VIK_MODO_PRUEBA=true`:
  solo anota lo que enviaría; se ve en `/admin/api/vik/estado`).

## Puesta en marcha

1. **Plantilla en Meta:** `node scripts/crear-plantillas-vik.js --enviar` (sin `--enviar` solo muestra el texto).
   Meta la aprueba en minutos u horas (WhatsApp Manager > Plantillas).
2. **Render > Environment:** `VIK_ACTIVO=true`, `VIK_MODO_PRUEBA=true`, `VIK_WEBHOOK_KEY=<clave>` y desplegar.
3. **Sitio web:** subir `vikbooking/malibubot.php` a `/administrator/components/com_vikbooking/smsapi/`
   (Administrador de archivos de Network Solutions).
4. **Vik Booking > Configuración > SMS:** pasarela `malibubot.php`; URL
   `https://malibubot.onrender.com/api/vik/confirmada`; Clave = la misma `VIK_WEBHOOK_KEY`;
   "Enviar SMS cuando" = *La reserva está confirmada*; enviar solo al *cliente*.
5. **Prueba en modo prueba:** hacer una reserva de prueba, pagarla y revisar `/admin/api/vik/estado`.
6. Con la plantilla aprobada: `VIK_MODO_PRUEBA=false`.

## Pruebas

`node scripts/probar-vik.js` (offline, Graph API simulada).
