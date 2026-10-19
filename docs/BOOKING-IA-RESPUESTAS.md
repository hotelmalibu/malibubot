# Respuestas modelo para la IA de e4jConnect (mensajes de Booking.com)

Borrador para revisión del dueño (18-oct-2026). Son los «training sets» que se cargan en Vik Booking cuando esté activo el canal **AI** de e4jConnect
(ver `docs/BOOKING-EXPEDIA.md` y la guía de e4jConnect: <https://e4jconnect.com/support-e4jconnect/ai-documentation/guest-messaging>).
Cada respuesta va en **español y en inglés** (la IA solo responde en los idiomas que tengan un training set) y aplica a **todas las habitaciones**.

Reglas con las que están escritas:
- Solo datos **confirmados por el dueño**. Lo que no se sabe no se inventa: se manda a recepción.
- Trato de usted, breve, firmadas por «Hotel y Centro de Eventos Malibú».
- Cancelaciones, cambios de fecha y cobros **nunca se resuelven solos**: la IA recibe la solicitud y avisa que recepción responde.
- Se arranca en **modo borrador**: recepción lee cada respuesta antes de enviarla (el envío automático se habilita tras 20 mensajes de IA enviados).

## Datos confirmados

| Dato | Valor | Confirmado |
|---|---|---|
| Check-in / check-out | desde las 3:00 p. m. / hasta la 1:00 p. m. | configuración del bot |
| Desayuno | incluido en todas las habitaciones | dueño, 7-sep-2026 |
| Piscina | segundo piso, de 11:00 a. m. a 8:00 p. m., todos los días | configuración del bot |
| Niños menores de 12 años | gratis; no cuentan como persona adicional ni para la capacidad | dueño, 27-sep-2026 |
| Parqueadero | sí hay, sin costo para los huéspedes | dueño, 18-oct-2026 |
| Mascotas | no se permiten; solo con certificado médico | dueño, 18-oct-2026 |
| Wi-Fi | en todo el hotel y en las zonas de co-working | dueño, 18-oct-2026 |
| Cancelación | gratis hasta 24 horas antes de la llegada; después se cobra «el valor del hotel» | dueño, 18-oct-2026 |
| Pago de las reservas de Booking | se paga en el hotel | dueño, 18-oct-2026 |
| Factura electrónica | se pide a reservas@hotelmalibu.co | dueño, 18-oct-2026 |
| Check-in temprano / check-out tarde | se puede; se consulta con recepción | dueño, 18-oct-2026 |
| Dirección | Calle 32A #32-04, Sincelejo, Sucre, Colombia | página web del hotel |

## Los temas que más escriben los huéspedes de Booking (bandeja del 18-oct-2026)

Factura electrónica (varios), hora de check-in, cancelaciones, «¿se paga ahora o al llegar al hotel?» y agradecimientos. Los 5 primeros sets cubren eso.

## Respuestas

### 1. Factura electrónica
- **ES:** Con gusto. Las facturas electrónicas se solicitan por correo a reservas@hotelmalibu.co; por favor indique el número de su reserva y los datos para la factura. Cordialmente, Hotel y Centro de Eventos Malibú.
- **EN:** Of course. Electronic invoices are requested by email at reservas@hotelmalibu.co; please include your reservation number and your billing details. Kind regards, Hotel y Centro de Eventos Malibú.

### 2. Horario de entrada y salida
- **ES:** El check-in es a partir de las 3:00 p. m. y el check-out es hasta la 1:00 p. m. ¡Lo esperamos! Hotel y Centro de Eventos Malibú.
- **EN:** Check-in is from 3:00 p.m. and check-out is until 1:00 p.m. We look forward to welcoming you! Hotel y Centro de Eventos Malibú.

### 3. Check-in temprano o check-out tarde
- **ES:** Sí es posible solicitarlo. Para confirmarle la disponibilidad y las condiciones, nuestra recepción le responderá en este mismo chat. Hotel y Centro de Eventos Malibú.
- **EN:** Yes, you can request it. To confirm availability and conditions, our front desk will reply to you in this same chat. Hotel y Centro de Eventos Malibú.
- **Recepción:** responder la consulta a mano (la IA no sabe el costo ni la disponibilidad).

### 4. Cancelar la reserva
- **ES:** Con gusto le ayudamos. Nuestra política permite cancelar sin cobro hasta 24 horas antes de la llegada; si no se cancela dentro de ese plazo, se cobra el valor de la reserva según la tarifa del hotel. Nuestra recepción revisará su solicitud y le confirmará en este mismo chat. Hotel y Centro de Eventos Malibú.
- **EN:** We are happy to help. Our policy allows free cancellation up to 24 hours before arrival; if the reservation is not cancelled within that time, the reservation amount is charged at the hotel's rate. Our front desk will review your request and confirm in this same chat. Hotel y Centro de Eventos Malibú.
- **Recepción:** gestionar la cancelación; la IA no cancela ni promete devoluciones.
- **Por confirmar:** si el cobro tardío es toda la estadía o solo la primera noche (el texto dice «el valor de la reserva», como lo dijo el dueño).

### 5. ¿Cuándo y dónde se paga?
- **ES:** El pago de su reserva se realiza directamente en el hotel. Si tiene alguna duda, nuestra recepción con gusto le ayuda. Hotel y Centro de Eventos Malibú.
- **EN:** Payment for your reservation is made directly at the hotel. If you have any questions, our front desk will be happy to help. Hotel y Centro de Eventos Malibú.

### 6. Agradecimientos
- **ES:** ¡Gracias a usted! Quedamos atentos para lo que necesite. Hotel y Centro de Eventos Malibú.
- **EN:** Thank you! We remain at your disposal for anything you need. Hotel y Centro de Eventos Malibú.

### 7. Parqueadero
- **ES:** Sí, contamos con parqueadero sin costo para nuestros huéspedes. Hotel y Centro de Eventos Malibú.
- **EN:** Yes, we have parking at no cost for our guests. Hotel y Centro de Eventos Malibú.

### 8. Mascotas
- **ES:** No se permiten mascotas en el hotel; únicamente con certificado médico. Si necesita más información, nuestra recepción con gusto le ayuda. Hotel y Centro de Eventos Malibú.
- **EN:** Pets are not allowed at the hotel, except with a medical certificate. If you need more information, our front desk will be happy to help. Hotel y Centro de Eventos Malibú.

### 9. Wi-Fi
- **ES:** Sí, contamos con Wi-Fi en todo el hotel y también en las zonas de co-working. Hotel y Centro de Eventos Malibú.
- **EN:** Yes, we have Wi-Fi throughout the hotel and in the co-working areas. Hotel y Centro de Eventos Malibú.

### 10. Desayuno
- **ES:** Todas nuestras habitaciones incluyen desayuno. Hotel y Centro de Eventos Malibú.
- **EN:** All our rooms include breakfast. Hotel y Centro de Eventos Malibú.

### 11. Piscina
- **ES:** Contamos con piscina en el segundo piso, con horario de 11:00 a. m. a 8:00 p. m., todos los días. Hotel y Centro de Eventos Malibú.
- **EN:** We have a swimming pool on the second floor, open every day from 11:00 a.m. to 8:00 p.m. Hotel y Centro de Eventos Malibú.

### 12. Niños
- **ES:** Los niños menores de 12 años se alojan sin costo y no cuentan como persona adicional para la capacidad de la habitación. Hotel y Centro de Eventos Malibú.
- **EN:** Children under 12 stay free of charge and do not count as an additional person for the room capacity. Hotel y Centro de Eventos Malibú.

### 13. Ubicación
- **ES:** Estamos en la Calle 32A #32-04, Sincelejo, Sucre, Colombia. Hotel y Centro de Eventos Malibú.
- **EN:** We are located at Calle 32A #32-04, Sincelejo, Sucre, Colombia. Hotel y Centro de Eventos Malibú.

### 14. Cambiar fechas o la reserva
- **ES:** Con gusto revisamos su solicitud. Nuestra recepción verificará la disponibilidad y le responderá en este mismo chat. Hotel y Centro de Eventos Malibú.
- **EN:** We will gladly review your request. Our front desk will check availability and reply to you in this same chat. Hotel y Centro de Eventos Malibú.
- **Recepción:** gestionar el cambio a mano.

## Falta confirmar (no están en ningún set todavía)

Si el cobro por cancelar tarde o no llegar es toda la estadía o solo la primera noche; costo del check-in temprano o del check-out tarde; si la recepción atiende las 24 horas
(llegadas de madrugada); horario del desayuno; a qué se refiere el «certificado médico» de las mascotas (¿animales de asistencia?); eventos y salones.
Cuando la IA no encuentra un set, deja un aviso en el Centro de notificaciones de Vik: así se van agregando sets con las preguntas reales.
