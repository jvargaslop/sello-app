# Despliegue paso a paso (GitHub + Neon + Render)

Tiempo estimado: 30 a 45 minutos. No necesitas consola en el servidor: las tablas se crean solas al arrancar y los negocios se crean desde la página `/admin`.

## Cuentas que necesitas
- GitHub (guardar el código)
- Neon (base de datos Postgres gratis)
- Render (el servidor)
- Opcional al inicio: Resend (correos), Google Wallet, Apple Wallet

## Atajo: desplegar con `render.yaml` (recomendado)
El proyecto trae un archivo `render.yaml` que configura el servicio por ti. Haz los pasos 1 y 2 de abajo (Neon y GitHub) y luego:
1. En Render: **New +** > **Blueprint**, elige tu repositorio y la rama `main`.
2. Render lee `render.yaml` y te pide **`DATABASE_URL`**: pega la cadena de Neon.
3. Pulsa **Apply** y espera a que el servicio diga **Live**.
4. Entra al servicio > **Environment**, copia el valor de **`ADMIN_KEY`** (Render lo generó) y úsalo en `/admin`.
5. Salta a "7. Crear tu primer negocio". Los pasos 3 al 6 ya los hizo el Blueprint.

Si cambias `render.yaml` más adelante, en Render ve a **Blueprints** y ejecuta **Manual Sync**.

## 1. Base de datos (Neon)
1. Entra a neon.tech y crea un proyecto. Elige la región más cercana a Colombia que aparezca.
2. En el panel del proyecto, botón **Connect**, copia la cadena de conexión (empieza con `postgres://` y termina con `?sslmode=require`).
3. Guárdala: es tu `DATABASE_URL`.

Si prefieres Supabase, usa la cadena del **Session pooler** y no la conexión directa (la directa puede no funcionar desde Render).

## 2. Subir el código a GitHub
1. Crea un repositorio **privado** vacío en GitHub (por ejemplo `sello-app`).
2. En tu computador, dentro de la carpeta del proyecto:
   ```
   git init
   git add .
   git status
   ```
   Revisa que **no** aparezcan `.env` ni `secrets/`. Si aparecen, detente y revisa el `.gitignore`.
3. Luego:
   ```
   git commit -m "Primera versión"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/sello-app.git
   git push -u origin main
   ```

## 3. Crear el servicio en Render
1. En render.com: **New +** > **Web Service**.
2. Conecta tu cuenta de GitHub, autoriza el acceso y elige el repositorio.
3. Completa:
   - **Runtime / Language:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free para probar. Para clientes reales, un plan de pago (el gratis se apaga a los 15 minutos sin visitas y el primer escaneo tardaría casi un minuto; además el envío diario de avisos no correría).
   - **Health Check Path** (en Advanced): `/health`

## 4. Variables de entorno (Environment)
Agrégalas en Render antes del primer despliegue:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | la cadena de Neon |
| `DATABASE_SSL` | `true` |
| `ADMIN_KEY` | una clave larga inventada por ti (24+ caracteres). Es la que usarás en `/admin` |
| `BASE_URL` | no hace falta en Render (se toma sola); úsala solo si tienes dominio propio |

Opcionales (después): las de Resend, WhatsApp, Google y Apple del archivo `.env.example`.

## 5. Primer despliegue
Pulsa **Create Web Service** y espera a que el estado diga **Live**. Revisa los logs: debe aparecer `Base de datos lista` y `Sello escuchando`.

## 6. Verificar
Abre `https://tu-servicio.onrender.com/health`. Debe responder `{"ok":true,...}`. Si usas dominio propio, agrégalo en Render (Settings > Custom Domains) y pon `BASE_URL` con esa dirección.

## 7. Crear tu primer negocio
1. Abre `https://tu-servicio.onrender.com/admin` e ingresa tu `ADMIN_KEY`.
2. Llena nombre, premio, número de sellos y color. Pulsa **Crear negocio**.
3. Aparece un mensaje listo para copiar con el enlace del sticker, el enlace del panel y la **clave del negocio** (solo se muestra una vez; si se pierde, usa "Nueva clave").
4. Descarga el QR, imprímelo y pégalo cerca de la caja.

## 8. Probar con tu celular
1. Escanea el QR: debe sumarte un sello y mostrar tu tarjeta.
2. Entra a `/panel` con la clave del negocio y revisa que aparezca la actividad.
3. Completa la tarjeta (baja el "tiempo mínimo entre sellos" a 0 en el panel mientras pruebas), toca "Canjear premio" y valida el código en el panel.

## 9. Sticker NFC (opcional)
Compra tags NTAG213 o NTAG215. Con una app gratuita (por ejemplo NFC Tools) escribe un registro de tipo URL con el enlace del sticker y pégalo junto al QR.

## 10. Wallet y mensajes
Hasta que configures Google y Apple, los botones de Wallet responden "no está configurado". Sigue las secciones 2, 3, 7 y 8 del `README.md`. Para los certificados de Apple en Render, usa **Secret Files** y pon sus rutas en las variables `APPLE_*`.

## 11. Actualizar la app
Cada `git push` a `main` despliega solo. Las tablas nuevas se crean en el arranque.

## Problemas frecuentes
| Síntoma | Causa probable |
|---|---|
| Logs: "No se pudo preparar la base de datos" | `DATABASE_URL` mal copiada o `DATABASE_SSL` distinta de `true` |
| `/admin` dice "Falta configurar ADMIN_KEY" | La variable no existe o el servicio no se redesplegó |
| Los enlaces y el QR muestran una dirección equivocada | `BASE_URL` mal puesta; bórrala para que se use la de Render |
| El primer escaneo tarda casi un minuto | Plan gratis dormido; sube a plan de pago |
| Botón de Wallet: "no está configurado" | Faltan las variables de Google o Apple |
