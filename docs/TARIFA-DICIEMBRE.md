# Tarifa de diciembre (Navidad) en Valentina

## Qué pasó (30-oct-2026)

Una clienta pidió por WhatsApp el precio de una «habitación doble» para 1 noche el **28 de diciembre**. Valentina:
- le cotizó la **Estándar Ubique a $290.550** (la tarifa de fin de semana) diciendo que el 28 «cae domingo»: es **lunes**;
- tras la corrección, la **Estándar a $309.000**, y discutió con la clienta por la diferencia entre semana y fin de semana;
- **nunca ofreció la tarifa de Navidad**: la Junior Suite Twins (2 camas Queen, aire, TV, WiFi, desayuno) a $309.000 por noche
  para llegadas del 15-dic-2026 al 6-ene-2027, que es la que el hotel anuncia en Meta y Google.

La causa: la regla anterior decía «para 2 personas sin niños sigue la regla de siempre (Estándar / Ubique)»: la Twins solo se
ofrecía a familias y grupos de 3. Y el día de la semana lo calculaba de memoria.

## La regla ahora (`src/ia/agente.js`, sección «TARIFA DE DICIEMBRE»)

Para llegadas del **15-dic-2026 al 6-ene-2027**:
- **2 personas** (pareja, «habitación doble», «para dos»), **3 adultos** o **familias con niños** → la primera opción es la
  **Junior Suite Twins a $309.000 por noche, impuestos incluidos** («la tarifa de Navidad»).
- **1 persona sola** → Habitación Estándar ($309.000, el mismo precio).
- **No** ofrece la Estándar Ubique, **no** habla de tarifas distintas entre semana y fin de semana y **no** menciona el día de la semana.
- Si el cliente pide otra habitación (King, Triple, Suite de Lujo), le da el precio de esa.
- Fuera de esas fechas todo sigue como siempre (Estándar; Ubique de viernes a domingo).

## El día de la semana

El prompt trae un **CALENDARIO** calculado por el código (`calendarioSemanas()` en `src/util/fechas.js`: hoy + 150 días, una
línea por mes con los días del mes que caen en cada día de la semana) y la orden de no calcularlo de memoria.
`consultar_disponibilidad` también devuelve `diaSemana` de la fecha consultada.

## Cupo de la Twins

Hay **pocas Twins por noche** (**5**, las de «Junior Suite Navidad» en Vik Booking). Como ahora se ofrece a todas las parejas,
`src/datos/cupo.js` cuenta las reservas **confirmadas** (pagadas o con pago en el hotel) de la Twins —las del bot («Junior Suite
Twins») y las de Vik (nombre con «Navidad»)— noche por noche:
- `consultar_disponibilidad` devuelve `twinsDisponibles` para fechas de Navidad;
- las tres herramientas de reserva **rechazan** la Twins si en alguna noche no cabe y le dicen a Valentina que ofrezca la
  **Estándar al mismo precio** ($309.000);
- el número se cambia con `CUPO_TWINS` en Render (por defecto 5).
Canceladas, rechazadas y «en proceso» no cuentan.

## Por confirmar con el dueño

1. ¿La tarifa **Ubique** de fines de semana ($290.550) también vale del 15-dic al 6-ene? (hoy no se ofrece en esas fechas).
2. ¿Las demás habitaciones (King, Triple, Suite de Lujo) tienen **tarifa de diciembre** distinta de la del catálogo?
   Hoy Valentina usa los precios «desde» del catálogo (`src/datos/habitaciones.js`).
3. ¿Son 5 las Twins por noche? (`CUPO_TWINS`).

## Pruebas

`node scripts/probar-tarifa-diciembre.js` (calendario de 150 días, regla del prompt, cupo, herramientas). El comportamiento del modelo
real se prueba con el simulador del panel (`POST /admin/api/ia/simular`, ver `docs/FLUJO-DE-RESERVA.md`) con la conversación de arriba.
