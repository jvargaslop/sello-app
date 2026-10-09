# Sello – tarjeta de fidelidad con QR/NFC y Wallet

Servidor Node (Express + Postgres). El cliente escanea un QR o acerca el celular a un sticker NFC, recibe su sello y puede guardar la tarjeta en Google Wallet o Apple Wallet. El negocio tiene su propio panel. Las dos partes están separadas.

```
public/c.html      app del cliente (se abre al escanear el sticker)
public/panel.html  panel del negocio (clave por negocio)
src/server.js      API, reglas de sellos, canje, panel
src/google.js      Google Wallet (enlace de guardado + actualización)
src/apple.js       Apple Wallet (.pkpass + servicio web + push)
src/images.js      imágenes de sellos y logo (sin fuentes externas)
schema.sql         tablas de Postgres
```

## 1. Puesta en marcha

1. Crea una base Postgres (Supabase o Neon tienen plan gratis) y copia la cadena de conexión.
2. `cp .env.example .env` y completa `BASE_URL` (HTTPS), `DATABASE_URL`.
3. `npm install && npm run migrate`
4. Crea un negocio:
   `npm run create-store -- "Café Galeras" cafe-galeras "Un café americano gratis" 10 "#0F6B57"`
   Te da el enlace del sticker, el QR (`/qr/<slug>.svg`) y la clave del panel (`/panel`).
5. `npm start`. Despliega en Render, Railway o Fly con HTTPS (Wallet lo exige).

Sin Google ni Apple configurados, todo funciona salvo los botones de Wallet.

## 2. Google Wallet

1. Crea una cuenta en la Google Wallet Business Console y copia tu **Issuer ID**.
2. En Google Cloud, habilita **Google Wallet API**, crea una cuenta de servicio y descarga su JSON.
3. En la Business Console, agrega el correo de la cuenta de servicio como usuario del emisor.
4. Pon `GOOGLE_ISSUER_ID` y `GOOGLE_SERVICE_ACCOUNT_JSON` en `.env`.
5. En modo demo solo pueden guardar pases los correos que agregues como **usuarios de prueba**. Para producción, solicita la aprobación de acceso en la consola.

## 3. Apple Wallet

Requiere cuenta Apple Developer (99 USD/año).

1. En Identifiers crea un **Pass Type ID** (por ejemplo `pass.com.tuempresa.sello`) y genera su certificado.
2. Exporta el certificado desde Keychain como `.p12` y conviértelo:
   ```
   openssl pkcs12 -in pass.p12 -clcerts -nokeys -out secrets/pass-cert.pem
   openssl pkcs12 -in pass.p12 -nocerts -out secrets/pass-key.pem
   ```
3. Descarga el certificado **WWDR G4** de Apple y conviértelo a PEM: `openssl x509 -inform der -in AppleWWDRCAG4.cer -out secrets/wwdr.pem`
4. Completa `APPLE_*` en `.env` (Team ID, Pass Type ID, rutas, clave si la pusiste).
5. Prueba en un iPhone real: abre `/c/<slug>`, toca "Añadir a Apple Wallet". Al dar un sello, el pase se actualiza solo.

## 4. Sticker NFC

- Compra tags **NTAG213** o **NTAG215** (cuestan centavos por unidad).
- Con una app gratuita (por ejemplo NFC Tools) escribe un registro de tipo URL con el enlace del negocio: `https://tu-dominio.com/c/<slug>`.
- Pega el tag junto al QR impreso. Los celulares con NFC lo leen sin abrir ninguna app.

## 5. Cómo se evita el abuso

- Un cliente = un dispositivo (cookie de 2 años). Máximo un sello por el tiempo mínimo que fije el negocio (por defecto 4 horas).
- Límite de peticiones por IP en las rutas de sellos y del panel.
- El canje usa un código de 4 dígitos que vale 10 minutos y solo lo valida el negocio con su clave.
- Pendiente: un enlace fijo se puede compartir. Para más seguridad, usa tags NFC con contador (NTAG 424 DNA), un código rotativo o verificar ubicación.

## 6. Estado y siguientes pasos

- El código no se ha ejecutado contra Postgres, Google ni Apple (aquí no hay red ni credenciales). Solo se revisó la sintaxis. Espera algún ajuste en la primera prueba, sobre todo en `src/apple.js` (la librería `passkit-generator` cambia su API entre versiones; el código usa la v3) y en el push a APNs.
- Falta: registro de negocios por autoservicio, cobro de la suscripción (Wompi, Nequi), identificación por teléfono con código SMS/WhatsApp para recuperar tarjetas, y tarjetas con otros formatos (puntos, niveles).

## 7. Datos de contacto y mensajes automáticos

**Captura.** Tras escanear el sticker, la página del cliente ofrece (sin obligar) dejar nombre, correo, celular y día/mes de cumpleaños, con una casilla de autorización. Solo se guardan datos con autorización marcada; el cliente puede darse de baja o borrar sus datos desde su tarjeta, y cada correo trae enlace de baja. Sin año de nacimiento, para guardar lo mínimo.

**Envío.** Una tarea diaria (a las 10:00 hora de Colombia, configurable con `JOBS_HOUR`) manda:
- **Inactividad:** al cliente que lleva `inactivityDays` sin sellar (por defecto 30). Máximo 3 avisos seguidos sin que vuelva, y uno por periodo.
- **Cumpleaños:** el día del cumpleaños, una vez al año.
Cada negocio edita los textos y el canal desde el panel. Prueba primero con `npm run jobs -- --dry` (solo muestra lo que enviaría) y con el botón "Enviar prueba" del panel.

**Correo (Resend).** Crea cuenta, verifica tu dominio y pon `RESEND_API_KEY` y `EMAIL_FROM_ADDRESS`. Incluye cabecera `List-Unsubscribe` y enlace de baja.

**WhatsApp (Meta Cloud API, opcional).** Para escribir primero a un cliente, WhatsApp exige plantillas aprobadas por Meta (categoría marketing, con costo por mensaje). Crea dos plantillas con 3 variables:
- Inactividad: `Hola {{1}}, hace rato no te vemos por {{2}}. {{3}}`
- Cumpleaños: `Feliz cumpleaños, {{1}}. {{2}} te saluda. {{3}}`
Variables: nombre, negocio y detalle (en cumpleaños, el texto del panel). Con WhatsApp, el texto lo define la plantilla, no el editor del panel. Pon sus nombres en `WHATSAPP_TEMPLATE_*`.

**Cron externo.** Si tu hosting duerme el servidor (planes gratis), pon `JOBS_ENABLED=false` y programa `npm run jobs` una vez al día. Los envíos se registran en `message_log`, así que repetir la tarea no duplica mensajes.

**Datos personales (Colombia).** La Ley 1581 de 2012 exige autorización previa, expresa e informada y una política de tratamiento. `public/privacidad.html` es un borrador genérico: hazlo revisar por un abogado y define quién es responsable (el negocio) y encargado (tú). Considera además registrar las bases de datos en el RNBD si te aplica.

**Limitación conocida.** No se verifica que el correo o celular sean del cliente (no hay doble confirmación). Alguien podría escribir datos de un tercero; por eso cada mensaje trae baja inmediata. Una verificación por código es el siguiente paso recomendable.

## 8. Avisos automáticos por Wallet

Los avisos de inactividad y cumpleaños salen **primero como notificación de la tarjeta en Wallet** (gratis) y, si el cliente no la tiene guardada, por el canal elegido (correo o WhatsApp). El dueño lo activa o desactiva con "Avisar primero por la tarjeta en Wallet" en el panel.

- **Apple:** el aviso se escribe en el campo "Avisos" (reverso de la tarjeta) y el iPhone lo muestra en la pantalla de bloqueo cuando el campo cambia. Si el mismo texto se repite (por ejemplo, el cumpleaños del año siguiente), se alterna un carácter invisible para que Apple lo vuelva a notificar.
- **Google:** usa `addMessage` con notificación. Google permite máximo 3 por tarjeta cada 24 horas y el cliente debe tener activadas las notificaciones de tarjetas. El sistema envía como máximo un aviso automático al día por cliente.
- **Quién recibe:** clientes con la tarjeta guardada, aunque no hayan dejado correo ni celular, salvo quien se haya dado de baja. Los avisos de cumpleaños requieren que el cliente haya dejado su fecha.
- **Detección en Google:** Google no avisa cuándo alguien guarda la tarjeta; el sistema lo infiere porque el cliente tocó "Añadir a Google Wallet". Si la tarjeta no está guardada, Google responde 404 y se usa el siguiente canal.
- **Prueba rápida:** `npm run test-wallet -- <id-de-la-tarjeta> "Hola, es una prueba"` (el id sale de `select id from cards order by created_at desc limit 5;`). Con tu propio teléfono verás si llega la notificación.
- **Limitaciones:** no se puede confirmar que el cliente vio el aviso; Apple y Google dejan a cada persona silenciar las notificaciones de una tarjeta.

## 9. Administración (crear negocios sin consola)

Abre `/admin` e ingresa el valor de `ADMIN_KEY`. Desde ahí creas negocios, descargas su QR, copias el mensaje con la clave para el dueño y generas una clave nueva si la pierde. Las tablas se crean solas al arrancar el servidor. El paso a paso de despliegue está en `DEPLOY.md`.
