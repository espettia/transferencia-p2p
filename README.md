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
4. **Implementar autenticación de pares** — Pendiente; depende de la etapa 3.
5. **Implementar IndexedDB y catálogo** — Pendiente; depende de la etapa 4.
6. **Implementar transferencias por bloques** — Pendiente; depende de la etapa 5.
7. **Validar, desplegar y documentar** — Pendiente; depende de la etapa 6.

La siguiente etapa es **Implementar autenticación de pares**.

## Tracker WebSocket

El cliente espera un tracker compatible con estos mensajes JSON:

- Cliente → tracker: `{ "type": "create"|"join", "roomId": "..." }`
- Tracker → cliente: `{ "type": "ready", "roomId": "..." }` o `{ "type": "peer-joined" }`
- Relay: `{ "type": "offer"|"answer", "description": { ... } }` y `{ "type": "candidate", "candidate": { ... } }`
- Error: `{ "type": "error", "message": "..." }`

Configura la URL con `VITE_TRACKER_URL` (por ejemplo, `wss://tracker.example.com`). Si no se configura, se usa `ws(s)://<host>/tracker`.

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
