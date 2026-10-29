# Transferencia P2P

Aplicación web estática para emparejar dos dispositivos y transferir archivos directamente entre ellos.

## Desarrollo

Requiere Node.js 20 o posterior.

```bash
npm install
npm run dev
```

La aplicación genera invitaciones por sesión, muestra un QR real, permite copiar o pegar enlaces y puede activar la cámara para leer códigos QR. La conexión WebRTC usa un tracker WebSocket únicamente para la señalización; los archivos no pasan por ese servicio.

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

IndexedDB conserva el catálogo local y los archivos seleccionados. Tras autenticarse,
cada nuevo archivo comparte sus metadatos por WebRTC y aparece automáticamente en el
catálogo remoto.
El contenido se transfiere bajo demanda: al seleccionar “Transferir”, el dispositivo
remoto solicita el archivo y el emisor lo envía por el canal WebRTC en bloques de 16 KB.
Al completar la recepción, el blob se guarda en IndexedDB y el elemento queda disponible.

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

Configura la URL con `VITE_TRACKER_URL` (por ejemplo, `wss://tracker.example.com`). Si no se configura, se usa `ws(s)://<host>/tracker`.

El despliegue incluye un tracker en `/tracker`. Cada dispositivo se registra primero
en la sala con `create` o `join`; el tracker responde `ready` antes de permitir la
señalización. Las salas admiten dos dispositivos y se eliminan al cerrar sus conexiones.

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
