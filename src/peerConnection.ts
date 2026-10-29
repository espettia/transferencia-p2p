export type ConnectionState = 'idle' | 'connecting' | 'waiting' | 'authenticating' | 'connected' | 'error';
import type { CatalogEntry } from './catalog';

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
type ChannelMessage = AuthMessage | { type: 'catalog-entry'; entry: CatalogEntry };
type TransferMessage =
  | { type: 'file-request'; id: string }
  | { type: 'file-start'; entry: CatalogEntry }
  | { type: 'file-chunk'; id: string; data: string }
  | { type: 'file-end'; id: string };
type TransferChannelMessage = ChannelMessage | TransferMessage;
type LocalFile = { entry: CatalogEntry; blob: Blob };

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
  private registered = false;
  private localFingerprint = '';
  private incomingTransfers = new Map<string, { entry: CatalogEntry; chunks: string[] }>();

  constructor(
    private readonly roomId: string,
    private readonly isHost: boolean,
    private readonly onStateChange: (state: ConnectionState, detail?: string) => void,
    private readonly onPeerIdentity?: (fingerprint: string) => void,
    private readonly onLocalIdentity?: (fingerprint: string) => void,
    private readonly onCatalogEntry?: (entry: CatalogEntry) => void,
    private readonly onFileRequest?: (id: string) => Promise<LocalFile | null>,
    private readonly onFileReceived?: (entry: CatalogEntry, blob: Blob) => Promise<void>,
    private readonly onTransferProgress?: (id: string, progress: number) => void,
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
      await this.initializeIdentity();
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
    this.registered = false;
    this.localFingerprint = '';
    this.incomingTransfers.clear();
  }

  sendCatalogEntry(entry: CatalogEntry): void {
    if (this.dataChannel?.readyState !== 'open') {
      throw new Error('El dispositivo todavía no está conectado.');
    }
    this.dataChannel.send(JSON.stringify({ type: 'catalog-entry', entry } satisfies ChannelMessage));
  }

  requestFile(id: string): void {
    if (this.dataChannel?.readyState !== 'open') {
      throw new Error('El dispositivo todavía no está conectado.');
    }
    this.dataChannel.send(JSON.stringify({ type: 'file-request', id } satisfies TransferMessage));
  }

  private send(message: TrackerMessage): void {
    const registration = message.type === 'create' || message.type === 'join';
    if (this.socket?.readyState === WebSocket.OPEN && (registration || this.registered)) {
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
      this.registered = true;
      this.onLocalIdentity?.(this.localFingerprint);
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
    channel.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data as string) as TransferChannelMessage;
        if (message.type === 'catalog-entry') {
          this.onCatalogEntry?.(message.entry);
          return;
        }
        if (message.type === 'file-request') {
          void this.sendFile(message.id).catch(() => {
            this.onStateChange('error', 'No se pudo enviar el archivo solicitado.');
          });
          return;
        }
        if (message.type === 'file-start') {
          this.incomingTransfers.set(message.entry.id, { entry: message.entry, chunks: [] });
          this.onTransferProgress?.(message.entry.id, 0);
          return;
        }
        if (message.type === 'file-chunk') {
          const transfer = this.incomingTransfers.get(message.id);
          if (!transfer) return;
          transfer.chunks.push(message.data);
          const received = transfer.chunks.reduce((total, chunk) => total + decodeBase64(chunk).byteLength, 0);
          this.onTransferProgress?.(message.id, Math.min(99, received / Math.max(1, transfer.entry.size) * 100));
          return;
        }
        if (message.type === 'file-end') {
          const transfer = this.incomingTransfers.get(message.id);
          if (!transfer) return;
          this.incomingTransfers.delete(message.id);
          const blob = new Blob(transfer.chunks.map(decodeBase64), { type: transfer.entry.type });
          await this.onFileReceived?.(transfer.entry, blob);
          this.onTransferProgress?.(message.id, 100);
          return;
        }
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

  private async sendFile(id: string): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open' || !this.onFileRequest) return;
    const localFile = await this.onFileRequest(id);
    if (!localFile) return;
    const { entry, blob } = localFile;
    this.dataChannel.send(JSON.stringify({ type: 'file-start', entry } satisfies TransferMessage));
    const chunkSize = 16 * 1024;
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const chunk = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
      this.dataChannel.send(JSON.stringify({
        type: 'file-chunk',
        id,
        data: encodeBase64(chunk),
      } satisfies TransferMessage));
      this.onTransferProgress?.(id, Math.min(99, ((offset + chunk.length) / blob.size) * 100));
      await waitForBuffer(this.dataChannel);
    }
    this.dataChannel.send(JSON.stringify({ type: 'file-end', id } satisfies TransferMessage));
  }

  private async startAuthentication(channel: RTCDataChannel): Promise<void> {
    if (!this.identity || !this.localIdentity) {
      throw new Error('La identidad del dispositivo no está disponible.');
    }
    channel.send(JSON.stringify({ type: 'auth-hello', ...this.localIdentity } satisfies AuthMessage));
  }

  private async initializeIdentity(): Promise<void> {
    this.identity = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify'],
    );
    const publicKey = await crypto.subtle.exportKey('jwk', this.identity.publicKey);
    this.localIdentity = { publicKey, nonce: randomNonce() };
    this.localFingerprint = await fingerprint(publicKey);
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

export async function fingerprint(publicKey: JsonWebKey): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(publicKey)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12).toUpperCase();
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

async function waitForBuffer(channel: RTCDataChannel): Promise<void> {
  while (channel.bufferedAmount > 1024 * 1024) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  }
}
