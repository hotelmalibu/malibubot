# MALIBUBOT — Fase 1: eco de WhatsApp

Agente comercial de WhatsApp para el **Hotel y Centro de Eventos Malibú** (Sincelejo).
Esta es la **Fase 1**: un servidor que recibe mensajes de WhatsApp y los responde (eco).
Sirve para confirmar que el circuito **cliente → Meta → Render → cliente** funciona,
antes de añadir la IA (Fase 2), el Google Sheet, RAPYD, etc.

> Aún no hay Claude, ni Sheet, ni pagos. Solo el "tubo" de WhatsApp funcionando.

---

## Qué hace

- `GET /health` — comprobación de estado (Render lo usa).
- `GET /webhook/whatsapp` — verificación del webhook de Meta.
- `POST /webhook/whatsapp` — recibe mensajes, valida la firma y responde el eco.

---

## Estructura

```
malibubot/
├── src/
│   ├── index.js              # Servidor Express + endpoints del webhook
│   ├── config.js             # Carga y valida variables de entorno
│   └── whatsapp/
│       ├── firma.js          # Verifica la firma X-Hub-Signature-256 de Meta
│       ├── recibir.js        # Parsea los mensajes entrantes
│       └── enviar.js         # Envía texto y marca como leído (Graph API)
├── .env.example              # Plantilla de variables (copiar a .env)
├── .gitignore
├── render.yaml               # Blueprint opcional de Render
└── package.json
```

---

## 1) Montar en Claude Code

1. Descomprime el proyecto y ábrelo en Claude Code.
2. Instala dependencias:
   ```bash
   npm install
   ```
3. (Opcional, prueba local) copia la plantilla de variables:
   ```bash
   cp .env.example .env
   ```
   Complétala y ejecuta:
   ```bash
   npm run dev
   ```
   Para que Meta llegue a tu máquina en local necesitarías exponer el puerto
   (por ejemplo con un túnel tipo ngrok/cloudflared). **Es más simple desplegar
   directo en Render** (paso 3) y probar desde ahí.

---

## 2) Subir a GitHub

```bash
git init
git add .
git commit -m "MALIBUBOT Fase 1: eco de WhatsApp"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/malibubot.git
git push -u origin main
```

> El `.gitignore` ya evita subir `.env` y `credenciales/`. **No subas secretos.**

---

## 3) Desplegar en Render

1. En Render: **New → Web Service** y conecta el repo de GitHub.
2. Configuración:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
   - **Plan:** `Free` para probar. **Para producción, `Starter`** (always-on;
     el Free se duerme a los 15 min y perdería webhooks).
3. En **Environment**, agrega las variables (mismas de `.env.example`):
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_VERIFY_TOKEN`  ← un valor secreto que **tú inventas**
   - `WHATSAPP_APP_SECRET`
   - `GRAPH_API_VERSION` (p. ej. `v21.0`)
4. Deploy. Cuando termine, prueba en el navegador:
   `https://TU-SERVICIO.onrender.com/health` → debe responder `{ "ok": true, ... }`.

> Para esta prueba puedes usar la URL `…onrender.com` directamente. El subdominio
> `bot.hotelmalibu.co` (CNAME en Network Solutions) puedes conectarlo después.

---

## 4) Conectar con Meta (WhatsApp Cloud API)

En **developers.facebook.com** → tu App → **WhatsApp**:

1. **API Setup:** copia el **Phone number ID** y el **token** de acceso →
   ponlos en Render (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`).
2. **App Secret:** Settings → Basic → copia el **App Secret** →
   Render (`WHATSAPP_APP_SECRET`).
3. **Configuration → Webhook → Edit:**
   - **Callback URL:** `https://TU-SERVICIO.onrender.com/webhook/whatsapp`
   - **Verify Token:** el mismo valor de `WHATSAPP_VERIFY_TOKEN`.
   - Clic en **Verify and Save** (Render debe estar desplegado y arriba).
4. **Webhook fields:** suscríbete al campo **`messages`**.
5. Si usas el **número de prueba** de Meta, agrega tu número personal como
   destinatario permitido (**To**) para poder chatear con el bot.

---

## 5) Probar

Escríbele por WhatsApp al número conectado. Deberías recibir:

> **MALIBUBOT (prueba Fase 1) recibió tu mensaje: "hola"**

Si llega, la Fase 1 está lista. En los **logs de Render** verás la línea
`[msg] de … (text): hola`.

---

## Notas

- El eco es un **mensaje de texto libre**, que solo se puede enviar dentro de la
  **ventana de 24 h** que se abre cuando el cliente escribe primero. Como tú
  escribes primero en la prueba, funciona sin plantillas.
- El **token temporal** de Meta caduca en ~24 h. Para producción, genera un
  **token permanente de sistema** (System User) y actualízalo en Render.
- Usa en `GRAPH_API_VERSION` la versión que muestre tu panel de Meta.

---

## Consola de monitoreo y handoff humano (`/admin`)

El mismo servicio sirve un panel web para **ver las conversaciones en vivo** y
**delegar a una persona** cuando haga falta.

**Entrar:** abre `https://TU-SERVICIO.onrender.com/admin` y usa cualquier usuario
con la contraseña de `ADMIN_PASSWORD`. Sin esa variable, el panel queda cerrado.

**Qué permite:**
- Ver todas las conversaciones; las que necesitan a una persona se agrupan arriba
  en **"Necesitan atención"** con un indicador en coral.
- Abrir un chat y leer el historial completo (cliente, MALIBUBOT y recepción).
- **Tomar control:** el bot deja de responder ese chat y tú respondes desde el
  panel. El botón **Devolver al bot** reactiva la atención automática.
- Contador de mensajes sin leer por conversación.

**Cómo funciona el handoff:** cuando un chat está en modo humano, el webhook
registra los mensajes del cliente pero **no** genera respuesta del bot; así nunca
contestan los dos a la vez. Al devolverlo al bot, MALIBUBOT retoma.

**Notas:**
- El estado del panel es **en memoria**: se reinicia si el servicio se
  redespliega. El historial **duradero** se guardará en el Google Sheet en la
  Fase 2. Para el día a día en Render, usa el plan **Starter** (always-on) para
  que no se duerma.
- Un humano solo puede enviar texto libre dentro de la **ventana de 24 h** desde
  el último mensaje del cliente (regla de WhatsApp). Si está cerrada, el panel lo
  avisa.
- Protege el acceso: usa una contraseña fuerte y compártela solo con recepción.

---

## Siguiente fase

**Fase 2 — Agente + lectura:** conectar Claude (Haiku 4.5) con *tool use* y la
herramienta `consultar_disponibilidad` que lee la disponibilidad del Google Sheet.
