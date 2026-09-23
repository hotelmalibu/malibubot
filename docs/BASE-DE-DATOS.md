# Base de datos de MALIBUBOT (PostgreSQL)

Sin base de datos, MALIBUBOT guarda todo en memoria y **lo pierde al reiniciarse**
(conversaciones, reservas, avisos ya enviados, ajustes). Con `DATABASE_URL`, todo se guarda
en PostgreSQL y se recupera al arrancar. El código ya está preparado: **crea las tablas solo**.

## Qué se guarda

| Tabla | Contenido |
|---|---|
| `conversaciones`, `mensajes` | Chats de WhatsApp y su historial |
| `reservas` | Reservas del bot, manuales y **las de Vik Booking** (fuente `vikbooking` / `vikbooking-ota`, referencia `vik:<número>`) |
| `vik_avisos` | Qué reservas de Vik Booking ya recibieron el WhatsApp de confirmación (evita repetirlo) |
| `ajustes`, `metricas`, `ocupacion_cache` | Meta semanal, consumo de IA y caché de ocupación |

## Crear la base (Neon, gratis)

1. Entra a **neon.tech** y crea una cuenta con tu correo (la creas tú).
2. **Create project**: nombre `malibubot`, región la más cercana a Render (por ejemplo *US East*), PostgreSQL 16.
3. En el panel del proyecto pulsa **Connect** y copia la **Connection string** (empieza por `postgresql://`).
   Elige la versión **Pooled connection** si la ofrece.
4. En **Render → tu servicio MALIBUBOT → Environment** agrega:
   - `DATABASE_URL` = la cadena que copiaste (es un secreto: no la compartas ni la pegues en chats).
5. Guarda: Render reinicia el servicio. En los **Logs** debe verse:
   `[db] Conectada a PostgreSQL y tablas listas. ✅`
6. Comprueba en `https://malibubot.onrender.com/health`: debe decir `"persistencia":"postgresql"`.

(Alternativas equivalentes: Supabase o Render PostgreSQL; solo cambia dónde se copia la cadena.)

## Notas

- Lo que hoy esté en memoria no se traslada: al activar la base, las conversaciones y reservas
  empiezan a guardarse desde ese momento.
- Haz una copia periódica desde el panel de Neon (Backups / Branches) si quieres respaldo.
- Si la base falla, el bot sigue funcionando en memoria y lo avisa en los logs.
