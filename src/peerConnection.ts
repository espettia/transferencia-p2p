export type ConnectionState = 'idle' | 'connecting' | 'waiting' | 'authenticating' | 'connected' | 'error';

type SignalMessage =
  | { type: 'ready'; roomId: string }
  | { type: 'peer-joined' }
  | { type: 'offer'; description: RTCSessionDescriptionInit }
  | { type: 'answer'; description: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }
  | { type: 'error'; message: string };

type SignalPayload = Exclude<SignalMessage, { type: 'ready' }>;
type TrackerMessage = SignalPayload | { type: 'create' | 'join'; roomId: string };
type AuthMessage =
  | { type: 'auth-hello'; publicKey: JsonWebKey; nonce: string }
  | { type: 'auth-proof'; signature: string };

type PeerIdentity = {
  publicKey: JsonWebKey;
  nonce: string;
};

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
  private identity: CryptoKeyPair | null = null;
  private localIdentity: PeerIdentity | null = null;
  private remoteIdentity: PeerIdentity | null = null;
  private remoteSignature: string | null = null;
  private localSignature: string | null = null;

  constructor(
    private readonly roomId: string,
    private readonly isHost: boolean,
    private readonly onStateChange: (state: ConnectionState, detail?: string) => void,
    private readonly onPeerIdentity?: (fingerprint: string) => void,
  ) {}

  async connect(): Promise<void> {
    if (!window.RTCPeerConnection || !window.WebSocket || !window.crypto?.subtle) {
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
    this.identity = null;
    this.localIdentity = null;
    this.remoteIdentity = null;
    this.remoteSignature = null;
    this.localSignature = null;
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
    channel.onopen = () => {
      this.onStateChange('authenticating', 'Verificando la identidad del otro dispositivo…');
      void this.startAuthentication(channel).catch(() => {
        this.onStateChange('error', 'No se pudo verificar la identidad del dispositivo.');
        this.close();
      });
    };
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as AuthMessage;
        void this.handleAuthentication(message);
      } catch {
        this.onStateChange('error', 'El dispositivo envió un mensaje no válido.');
        this.close();
      }
    };
    channel.onerror = () => {
      this.onStateChange('error', 'Falló el canal seguro entre dispositivos.');
    };
  }

  private async startAuthentication(channel: RTCDataChannel): Promise<void> {
    this.identity = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify'],
    );
    const publicKey = await crypto.subtle.exportKey('jwk', this.identity.publicKey);
    this.localIdentity = { publicKey, nonce: randomNonce() };
    channel.send(JSON.stringify({ type: 'auth-hello', ...this.localIdentity } satisfies AuthMessage));
  }

  private async handleAuthentication(message: AuthMessage): Promise<void> {
    if (message.type === 'auth-hello') {
      this.remoteIdentity = { publicKey: message.publicKey, nonce: message.nonce };
      await this.sendProofIfReady();
      return;
    }
    if (message.type === 'auth-proof') {
      this.remoteSignature = message.signature;
      await this.finishAuthenticationIfReady();
    }
  }

  private async sendProofIfReady(): Promise<void> {
    if (!this.dataChannel || !this.identity || !this.localIdentity || !this.remoteIdentity || this.localSignature) return;
    const transcript = await this.authenticationTranscript();
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      this.identity.privateKey,
      transcript,
    );
    this.localSignature = encodeBytes(new Uint8Array(signature));
    this.dataChannel.send(JSON.stringify({ type: 'auth-proof', signature: this.localSignature } satisfies AuthMessage));
    await this.finishAuthenticationIfReady();
  }

  private async finishAuthenticationIfReady(): Promise<void> {
    if (!this.remoteIdentity || !this.remoteSignature || !this.localIdentity || !this.identity) return;
    const transcript = await this.authenticationTranscript();
    const remoteKey = await crypto.subtle.importKey(
      'jwk',
      this.remoteIdentity.publicKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      remoteKey,
      decodeBytes(this.remoteSignature),
      transcript,
    );
    if (!valid) {
      this.onStateChange('error', 'La identidad del otro dispositivo no pudo verificarse.');
      this.close();
      return;
    }
    this.onPeerIdentity?.(await fingerprint(this.remoteIdentity.publicKey));
    this.onStateChange('connected', 'Dispositivos autenticados y conectados directamente');
  }

  private async authenticationTranscript(): Promise<ArrayBuffer> {
    if (!this.localIdentity || !this.remoteIdentity) throw new Error('Faltan datos de autenticación.');
    const identities = [this.localIdentity, this.remoteIdentity].sort((a, b) =>
      JSON.stringify(a.publicKey).localeCompare(JSON.stringify(b.publicKey)),
    );
    return new TextEncoder().encode(`${this.roomId}:${JSON.stringify(identities)}`).buffer;
  }
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return encodeBytes(bytes);
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeBytes(value: string): ArrayBuffer {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

async function fingerprint(publicKey: JsonWebKey): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(publicKey)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12).toUpperCase();
}
