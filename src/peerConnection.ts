export type ConnectionState = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error';

type SignalMessage =
  | { type: 'ready'; roomId: string }
  | { type: 'peer-joined' }
  | { type: 'offer'; description: RTCSessionDescriptionInit }
  | { type: 'answer'; description: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }
  | { type: 'error'; message: string };

type SignalPayload = Exclude<SignalMessage, { type: 'ready' }>;
type TrackerMessage = SignalPayload | { type: 'create' | 'join'; roomId: string };

const trackerUrl = (): string => {
  const configured = (import.meta as ImportMeta & {
    env?: { VITE_TRACKER_URL?: string };
  }).env?.VITE_TRACKER_URL;
  if (configured) return configured;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/tracker`;
};

export class PeerConnection {
  private socket: WebSocket | null = null;
  private connection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(
    private readonly roomId: string,
    private readonly isHost: boolean,
    private readonly onStateChange: (state: ConnectionState, detail?: string) => void,
  ) {}

  async connect(): Promise<void> {
    if (!window.RTCPeerConnection || !window.WebSocket) {
      this.onStateChange('error', 'Este navegador no admite conexiones P2P.');
      return;
    }

    this.onStateChange('connecting');
    this.connection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    this.connection.onicecandidate = (event) => {
      if (event.candidate) this.send({ type: 'candidate', candidate: event.candidate.toJSON() });
    };
    this.connection.onconnectionstatechange = () => {
      const state = this.connection?.connectionState;
      if (state === 'connected') this.onStateChange('connected');
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.onStateChange('error', 'La conexión entre dispositivos se cerró.');
      }
    };
    this.connection.ondatachannel = (event) => this.attachDataChannel(event.channel);

    try {
      this.socket = new WebSocket(trackerUrl());
      await new Promise<void>((resolve, reject) => {
        if (!this.socket) return reject(new Error('No se pudo crear el tracker.'));
        this.socket.onopen = () => resolve();
        this.socket.onerror = () => reject(new Error('No se pudo conectar con el tracker.'));
      });
      this.socket.onmessage = (event) => {
        try {
          void this.handleSignal(JSON.parse(event.data as string) as SignalMessage);
        } catch {
          this.onStateChange('error', 'El tracker envió una respuesta no válida.');
        }
      };
      this.socket.onclose = () => {
        if (this.connection?.connectionState !== 'connected') {
          this.onStateChange('error', 'El tracker no está disponible.');
        }
      };
      this.send({ type: this.isHost ? 'create' : 'join', roomId: this.roomId });
    } catch (error) {
      this.close();
      this.onStateChange('error', error instanceof Error ? error.message : 'No se pudo iniciar la conexión.');
    }
  }

  close(): void {
    this.dataChannel?.close();
    this.connection?.close();
    this.socket?.close();
    this.dataChannel = null;
    this.connection = null;
    this.socket = null;
  }

  private send(message: TrackerMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private async handleSignal(message: SignalMessage): Promise<void> {
    if (!this.connection) return;
    if (message.type === 'error') {
      this.onStateChange('error', message.message);
      return;
    }
    if (message.type === 'ready') {
      this.onStateChange('waiting');
      return;
    }
    if (message.type === 'peer-joined' && this.isHost) {
      this.dataChannel = this.connection.createDataChannel('transfer');
      this.attachDataChannel(this.dataChannel);
      const offer = await this.connection.createOffer();
      await this.connection.setLocalDescription(offer);
      this.send({ type: 'offer', description: offer });
      return;
    }
    if (message.type === 'offer' && !this.isHost) {
      await this.connection.setRemoteDescription(message.description);
      const answer = await this.connection.createAnswer();
      await this.connection.setLocalDescription(answer);
      this.send({ type: 'answer', description: answer });
      await this.flushCandidates();
      return;
    }
    if (message.type === 'answer' && this.isHost) {
      await this.connection.setRemoteDescription(message.description);
      await this.flushCandidates();
      return;
    }
    if (message.type === 'candidate') {
      if (this.connection.remoteDescription) {
        await this.connection.addIceCandidate(message.candidate);
      } else {
        this.pendingCandidates.push(message.candidate);
      }
    }
  }

  private async flushCandidates(): Promise<void> {
    if (!this.connection) return;
    await Promise.all(this.pendingCandidates.map((candidate) => this.connection!.addIceCandidate(candidate)));
    this.pendingCandidates = [];
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    channel.onopen = () => this.onStateChange('connected');
  }
}
