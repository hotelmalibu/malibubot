# Certificados intermedios para leer la web del hotel

Estos `.pem` son certificados **públicos** de autoridades certificadoras (no llevan clave privada) y por eso pueden estar en el repositorio.

## Para qué sirven

Desde el **13-oct-2026** el hosting de `www.hotelmalibu.co` envía el certificado SSL de la web **sin su certificado intermedio**
(manda uno de Sectigo que no corresponde al certificado de RapidSSL instalado). Los navegadores completan la cadena solos, por eso la
web se ve normal, pero Node.js (el bot) no, y la sincronización con Vik fallaba con `fetch failed` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

`src/vikbooking/sincronizar.js` intenta primero la conexión normal. **Solo si falla por cadena incompleta** reintenta confiando en las
raíces de Node **más** los `.pem` de esta carpeta. No se desactiva ninguna verificación: el certificado se sigue comprobando hasta una raíz
de confianza y el nombre del dominio. Cuando el hosting arregle la cadena, la conexión normal vuelve a funcionar sola.

## Qué hay

| Archivo | Certificado | Emisor | Vigencia | SHA-256 |
|---|---|---|---|---|
| `rapidssl-tls-rsa-ca-g1.pem` | RapidSSL TLS RSA CA G1 (intermedio, `CA:TRUE, pathlen:0`) | DigiCert Global Root G2 | 2-nov-2017 → **2-nov-2027** | `44:22:E9:63:EE:53:CD:58:CC:9F:85:CD:40:BF:5F:FE:C0:09:5F:DF:1A:15:45:35:66:1C:1C:06:BC:AD:C6:9B` |

Origen: `http://cacerts.rapidssl.com/RapidSSLTLSRSACAG1.crt` (la dirección «CA Issuers» que trae el propio certificado de la web). Descargado el
14-oct-2026 y comprobado con `openssl verify` contra el certificado de la web y las raíces de Node.

## Mantenimiento

- Este intermedio **vence el 2-nov-2027**. Si el certificado de la web se renueva con otro intermedio, el panel mostrará «No se pudo verificar el
  certificado SSL…»: agrega aquí el `.pem` nuevo (o apunta `VIK_SYNC_CA_EXTRA` en Render a un archivo con él).
- El arreglo de fondo es que el hosting instale la **cadena completa** del certificado. Mientras no lo haga, el panel (Dashboard → Reservas por
  canal) muestra un aviso discreto.
- Para ver qué intermedio pide un certificado: `openssl x509 -in hoja.pem -noout -ext authorityInfoAccess` (línea «CA Issuers»).
