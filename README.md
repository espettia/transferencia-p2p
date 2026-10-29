# Transferencia P2P

Aplicación web estática para organizar una sala y transferir archivos directamente entre dispositivos.

## Desarrollo

Requiere Node.js 20 o posterior.

```bash
npm install
npm run dev
```

La aplicación genera huellas de sesión, muestra un QR que contiene únicamente esa huella, permite copiar o pegar la huella y puede activar la cámara para leerla. La conexión WebRTC usa un tracker WebSocket únicamente para la señalización; los archivos no pasan por ese servicio.

## Etapas del proyecto

Se implementará una etapa a la vez:

1. **Preparar base del proyecto y UI** — Completada.
2. **Implementar invitaciones, QR y cámara** — Completada; depende de la etapa 1.
3. **Integrar tracker y conexión WebRTC** — Completada; depende de la etapa 2.
4. **Implementar autenticación de pares** — Completada; depende de la etapa 3.
5. **Implementar IndexedDB y catálogo** — Completada; depende de la etapa 4.
6. **Implementar transferencias por bloques** — Completada; depende de la etapa 5.
7. **Validar, desplegar y documentar** — En progreso; depende de la etapa 6.

La siguiente etapa es **Validar, desplegar y documentar**.

La autenticación de pares se realiza después de abrir WebRTC: ambos dispositivos generan
una identidad ECDSA P-256 temporal, intercambian sus claves públicas y firman un desafío
común ligado a la invitación. La interfaz muestra la huella corta de la clave remota.

Al abrir la aplicación se crea o recupera inmediatamente una sala y se muestra su catálogo
local; la cámara solo se activa al pulsar **Acceder a sala**. IndexedDB conserva el catálogo
local y los archivos seleccionados. Cuando otra sesión se autentica, se transmiten únicamente
los metadatos del catálogo, nunca los archivos automáticamente.
El contenido se transfiere bajo demanda: al seleccionar “Transferir”, el dispositivo
remoto solicita el archivo y el emisor lo envía por el canal WebRTC en bloques de 16 KB.
Al completar la recepción, el blob se guarda en IndexedDB y el elemento queda disponible.
Además, se inicia una descarga del archivo para guardarlo en el sistema operativo,
normalmente en la carpeta de descargas configurada por el navegador.

La interfaz muestra debajo del QR la huella temporal de este dispositivo, generada al
registrarse en el tracker, y la huella del par autenticado. La misma identidad se
reutiliza durante WebRTC. Cada archivo del catálogo conserva la huella de la conexión
con la que fue compartido.

## Tracker WebSocket

El cliente espera un tracker compatible con estos mensajes JSON:

- Cliente → tracker: `{ "type": "create"|"join", "roomId": "..." }`
- Tracker → cliente: `{ "type": "ready", "roomId": "..." }` o `{ "type": "peer-joined" }`
- Relay: `{ "type": "offer"|"answer", "description": { ... } }` y `{ "type": "candidate", "candidate": { ... } }`
- Error: `{ "type": "error", "message": "..." }`

Configura la URL del tracker con `VITE_TRACKER_URL` si es necesario. Si no se configura, se usa el mismo origen seguro (`ws(s)://<host>/tracker`).

El QR no contiene una URL. Contiene únicamente una huella de sesión temporal de 36
caracteres hexadecimales. El segundo dispositivo abre la aplicación por separado,
escanea esa huella y el tracker la usa para encontrar la sala. Cualquiera que obtenga
la huella puede solicitar acceso a esa sesión.

La última sala se conserva en el almacenamiento persistente del navegador y se intenta
reconectar automáticamente al iniciar. Los archivos remotos permanecen en el catálogo como
no disponibles si la sesión que los compartió ya no está conectada. **Nueva sala** se habilita
cuando el catálogo no está vacío y borra la sala actual y todo el catálogo de IndexedDB antes
de iniciar una sesión nueva.

El despliegue incluye un tracker en `/tracker`. Cada sesión se registra primero en la
sala con `create` o `join`; el tracker responde `ready` antes de permitir la señalización.
Las salas admiten hasta 100 sesiones y se eliminan al cerrar sus conexiones.

## Producción

```bash
npm run build
npm run preview
```

El directorio `dist` generado por Vite puede desplegarse como sitio estático HTTPS.

Para desplegarlo en Cloudflare Workers:

```bash
npm run build
npx wrangler deploy
```
