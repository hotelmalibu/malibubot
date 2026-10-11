# Acceso avanzado en Meta (App Review) para Messenger e Instagram

**Situación (11-oct-2026):** la app MalibuBot (id `1538724627995927`) ya está en modo **Live**, con la política de
privacidad, las condiciones del servicio y la eliminación de datos publicadas:

- Privacidad: https://bot.hotelmalibu.co/privacidad
- Condiciones: https://bot.hotelmalibu.co/condiciones
- Eliminación de datos: https://bot.hotelmalibu.co/eliminar-datos

Pero los permisos de mensajes están en **Acceso estándar**: Valentina solo contesta a personas con rol en la app
(administradores, desarrolladores, probadores). Para que conteste a **cualquier cliente** hay que pedir **acceso avanzado**.

## Qué permisos pedir (Revisión de la app → Permisos y funciones)

| Permiso | Para qué |
|---|---|
| `pages_messaging` | Responder en Messenger |
| `instagram_business_manage_messages` | Responder en Instagram Direct (inicio de sesión de Instagram) |
| `pages_manage_metadata` | Suscribir la página a los webhooks |

(`instagram_manage_messages` es el equivalente con inicio de sesión de Facebook; no hace falta si Instagram va por el
inicio de sesión de Instagram.)

## Requisitos de Meta

1. **Verificación del negocio** completada (WhatsApp ya la tiene; confirmar en Configuración del negocio → Seguridad).
2. **Política de privacidad, condiciones y eliminación de datos** en la configuración básica (ya hechas).
3. **Ícono de la app** (1024×1024, JPG/PNG): subirlo en Configuración de la app → Básica. *Pendiente.*
4. **Un video corto** (1–3 min) por permiso, grabando la pantalla, que muestre el flujo real.
5. **Instrucciones para el revisor** y cuentas de prueba (Meta puede pedir un usuario de prueba).

## Texto sugerido para «Cómo usa tu app este permiso»

> MalibuBot es el asistente de reservas del Hotel y Centro de Eventos Malibú (Sincelejo, Colombia). Cuando un cliente escribe
> a la página de Facebook o a la cuenta de Instagram del hotel, el asistente le responde con disponibilidad y tarifas de
> habitaciones, toma los datos de la reserva (nombre, celular, fechas) y la confirma. Solo responde mensajes que el cliente
> inició y siempre dentro de las 24 horas posteriores a su último mensaje. El cliente puede pedir hablar con una persona de
> recepción en cualquier momento y el equipo puede tomar el control desde nuestro panel.

## Guion del video (≈2 min, sin editar)

1. Muestra la página de Facebook (o la cuenta de Instagram) del hotel desde **otro** dispositivo o cuenta de cliente.
2. Escribe «Hola, quiero reservar» y muestra la respuesta de Valentina.
3. Sigue la conversación: fechas, personas, tarifa, nombre y celular, hasta la confirmación.
4. Muestra el panel de MALIBUBOT (`/admin` → Conversaciones) con ese chat y los botones Messenger / Instagram.
5. Muestra «Tomar control» para que recepción responda a mano.
6. Cierra mostrando la política de privacidad y la página de eliminación de datos.

## Instrucciones para el revisor

> 1. Escribe «Hola» a la página «Hotel Malibú» en Messenger (o a @hotelmalibu_sincelejo en Instagram).
> 2. El asistente responde en segundos. Pide fechas y número de personas, ofrece una habitación y confirma la reserva.
> 3. La conversación aparece en https://bot.hotelmalibu.co/admin (se entregan credenciales de revisor aparte).

## Tiempos

Meta suele responder entre unos días y dos semanas. Mientras tanto Valentina sigue funcionando para roles de la app y
WhatsApp no se ve afectado.
