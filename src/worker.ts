interface RoomNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectId {}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ROOMS: RoomNamespace;
}

type Registration = { type: 'create' | 'join'; roomId: string };
type RelayMessage = { type: 'offer' | 'answer' | 'candidate'; [key: string]: unknown };

declare const WebSocketPair: {
  new (): { 0: WebSocket; 1: WebSocket };
};

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/tracker') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket upgrade required', { status: 426 });
      }
      return handleTracker(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleTracker(request: Request, env: WorkerEnv): Promise<Response> {
  const room = env.ROOMS.get(env.ROOMS.idFromName('pending'));
  return room.fetch(request);
}

export class Room {
  private readonly sockets = new Set<WebSocket>();
  private readonly socketRooms = new Map<WebSocket, string>();

  constructor(_state: unknown, _env: WorkerEnv) {}

  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1] as WebSocket & { accept(): void };
    server.accept();
    server.addEventListener('message', (event) => {
      void this.handleMessage(server, event.data);
    });
    server.addEventListener('close', () => this.remove(server));
    server.addEventListener('error', () => this.remove(server));
    this.sockets.add(server);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
  }

  private async handleMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return this.sendError(socket, 'Mensaje no válido.');
    let message: Registration | RelayMessage;
    try {
      message = JSON.parse(raw) as Registration | RelayMessage;
    } catch {
      this.sendError(socket, 'JSON no válido.');
      return;
    }

    if (message.type === 'create' || message.type === 'join') {
      await this.register(socket, message);
      return;
    }

    if (message.type === 'offer' || message.type === 'answer' || message.type === 'candidate') {
      const roomId = this.socketRooms.get(socket);
      if (!roomId) {
        this.sendError(socket, 'Registra el dispositivo antes de iniciar la señalización.');
        return;
      }
      this.broadcast(roomId, socket, message);
    }
  }

  private async register(socket: WebSocket, message: Registration): Promise<void> {
    const roomMembers = [...this.socketRooms.entries()]
      .filter(([, roomId]) => roomId === message.roomId)
      .map(([member]) => member);
    if (roomMembers.length >= 100 || this.socketRooms.has(socket)) {
      this.sendError(socket, 'La sala alcanzó el límite de 100 sesiones.');
      return;
    }
    this.socketRooms.set(socket, message.roomId);
    socket.send(JSON.stringify({ type: 'ready', roomId: message.roomId }));
    for (const member of roomMembers) {
      if (member.readyState === WebSocket.OPEN) member.send(JSON.stringify({ type: 'peer-joined' }));
    }
  }

  private broadcast(roomId: string, sender: WebSocket, message: RelayMessage): void {
    for (const [socket, socketRoom] of this.socketRooms) {
      if (socket !== sender && socketRoom === roomId && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    }
  }

  private sendError(socket: WebSocket, message: string): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'error', message }));
  }

  private remove(socket: WebSocket): void {
    this.sockets.delete(socket);
    this.socketRooms.delete(socket);
  }
}
