import { ChangeEvent, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';
import './App.css';
import { ConnectionState, fingerprint, PeerConnection } from './peerConnection';
import { CatalogEntry, listCatalog, saveLocalFile, saveRemoteEntry } from './catalog';

const INVITATION_KEY = 'transferencia-p2p-invitation';

function createInvitation() {
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${window.location.origin}/?invite=${encodeURIComponent(id)}`;
}

function QrCode({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: 190,
      margin: 1,
      color: { dark: '#17212b', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).catch(() => undefined);
  }, [value]);

  return (
    <canvas ref={canvasRef} className="qr-code" aria-label="Código QR de invitación" />
  );
}

export function App() {
  const inviteId = new URLSearchParams(window.location.search).get('invite');
  const [invitation, setInvitation] = useState(() => {
    const saved = window.sessionStorage.getItem(INVITATION_KEY);
    return saved ?? createInvitation();
  });
  const [notice, setNotice] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionDetail, setConnectionDetail] = useState('');
  const [peerFingerprint, setPeerFingerprint] = useState('');
  const [localFingerprint, setLocalFingerprint] = useState('');
  const [qrFingerprint, setQrFingerprint] = useState('');
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const peerRef = useRef<PeerConnection | null>(null);

  useEffect(() => {
    void listCatalog().then(setCatalog).catch(() => setCatalogError('No se pudo abrir el catálogo local.'));
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(INVITATION_KEY, invitation);
  }, [invitation]);

  useEffect(() => {
    const value = inviteId ?? new URL(invitation).searchParams.get('invite');
    if (!value) return;
    void fingerprintFromText(value).then(setQrFingerprint);
  }, [inviteId, invitation]);

  useEffect(() => {
    const roomId = inviteId ?? new URL(invitation).searchParams.get('invite');
    if (!roomId) return;
    const peer = new PeerConnection(roomId, !inviteId, (state, detail) => {
      setConnectionState(state);
      setConnectionDetail(detail ?? '');
    }, setPeerFingerprint, setLocalFingerprint, (entry) => {
      void saveRemoteEntry(entry).then(async () => setCatalog(await listCatalog()))
        .catch(() => setCatalogError('No se pudo actualizar el catálogo remoto.'));
    });
    peerRef.current = peer;
    void peer.connect();
    return () => {
      peer.close();
      peerRef.current = null;
    };
  }, [inviteId, invitation]);

  useEffect(() => {
    if (connectionState !== 'connected' || !peerRef.current) return;
    for (const entry of catalog.filter((item) => item.owner === 'local')) {
      try {
        peerRef.current.sendCatalogEntry({ ...entry, sharedWith: peerFingerprint });
      } catch {
        setCatalogError('No se pudo sincronizar el catálogo.');
        break;
      }
    }
  }, [connectionState, catalog]);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current) return;
    let active = true;
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        if (active) window.location.href = result.data;
      },
      { returnDetailedScanResult: true },
    );
    scannerRef.current = scanner;
    scanner.start().catch(() => {
      if (active) setCameraError('No se pudo acceder a la cámara. Revisa los permisos del navegador.');
    });
    return () => {
      active = false;
      scanner.stop();
      scanner.destroy();
      if (scannerRef.current === scanner) scannerRef.current = null;
    };
  }, [cameraOpen]);

  const copyInvitation = async () => {
    try {
      await navigator.clipboard.writeText(invitation);
      setNotice('Enlace copiado');
    } catch {
      setNotice('No se pudo copiar el enlace');
    }
    window.setTimeout(() => setNotice(''), 2200);
  };

  const startCamera = async () => {
    setCameraError('');
    setCameraOpen(true);
  };

  const closeCamera = () => {
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
    setCameraOpen(false);
  };

  const pasteInvitation = async () => {
    const value = window.prompt('Pega aquí el enlace de conexión');
    if (!value) return;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol');
      window.location.href = url.toString();
    } catch {
      setNotice('El enlace no es válido');
      window.setTimeout(() => setNotice(''), 2200);
    }
  };

  const addFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const entry = await saveLocalFile(file);
      setCatalog(await listCatalog());
      if (connectionState !== 'connected' || !peerRef.current) {
        setNotice('Archivo guardado localmente; conecta el otro dispositivo para sincronizarlo.');
        window.setTimeout(() => setNotice(''), 3000);
        return;
      }
      peerRef.current.sendCatalogEntry({ ...entry, sharedWith: peerFingerprint });
      setNotice('Archivo añadido al catálogo de ambos dispositivos.');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'No se pudo añadir el archivo.');
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">↗</div>
        <div>
          <p className="eyebrow">Transferencia directa</p>
          <h1>Transferencia P2P</h1>
        </div>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Sin cuentas · Sin nube · Privado</p>
        <h2 id="page-title">Comparte archivos<br /><span>directamente.</span></h2>
        <p className="hero-copy">
          Conecta dos dispositivos con un código QR y transfiere tus archivos de forma
          directa y segura.
        </p>
      </section>

      <section className="pairing-grid" aria-label="Opciones de emparejamiento">
        <article className="pairing-card own-card">
          <div className="card-heading">
            <span className="step-badge">01</span>
            <div>
              <p className="card-kicker">Tu dispositivo</p>
              <h3>Mi QR</h3>
            </div>
          </div>
          <div className="qr-area">
            <QrCode value={invitation} />
          </div>
          <p className="card-description">Escanea este código desde el otro dispositivo</p>
          <button className="secondary-button" type="button" onClick={copyInvitation}>Copiar enlace de conexión</button>
        </article>

        <div className="connector" aria-hidden="true">
          <span />
          <strong>o</strong>
          <span />
        </div>

        <article className="pairing-card scan-card">
          <div className="card-heading">
            <span className="step-badge">02</span>
            <div>
              <p className="card-kicker">Otro dispositivo</p>
              <h3>Escanear</h3>
            </div>
          </div>
          <div className={`camera-placeholder${cameraOpen ? ' camera-active' : ''}`} aria-label="Vista de cámara">
            {cameraOpen ? (
              <>
                <video ref={videoRef} className="camera-video" muted playsInline />
                <div className="camera-frame">
                  <span className="camera-corner top-left" />
                  <span className="camera-corner top-right" />
                  <span className="camera-corner bottom-left" />
                  <span className="camera-corner bottom-right" />
                </div>
              </>
            ) : (
              <div className="camera-frame">
                <span className="camera-corner top-left" />
                <span className="camera-corner top-right" />
                <span className="camera-corner bottom-left" />
                <span className="camera-corner bottom-right" />
                <span className="camera-center">⌁</span>
              </div>
            )}
          </div>
          <p className="card-description">{cameraError || (cameraOpen ? 'Apunta al código QR del otro dispositivo' : 'Escanea el QR del otro dispositivo')}</p>
          {cameraOpen ? (
            <button className="secondary-button" type="button" onClick={closeCamera}>Cerrar cámara</button>
          ) : (
            <button className="primary-button" type="button" onClick={startCamera}>Activar cámara <span>→</span></button>
          )}
          <button className="text-button" type="button" onClick={pasteInvitation}>Pegar enlace</button>
        </article>
      </section>

      <p className={`notice${notice ? ' notice-visible' : ''}`} role="status">{notice}</p>
      <section className="fingerprint-panel" aria-labelledby="fingerprint-title">
        <div className="fingerprint-heading">
          <p className="eyebrow">Identidad de conexión</p>
          <h2 id="fingerprint-title">Huellas</h2>
        </div>
        <div className="fingerprint-grid">
          <Fingerprint label="QR leído" value={qrFingerprint} />
          <Fingerprint label="Este dispositivo" value={localFingerprint} />
          <Fingerprint label="Dispositivo conectado" value={peerFingerprint} />
        </div>
      </section>
      <section className={`connection-status connection-${connectionState}`} aria-live="polite">
        <span className="connection-dot" aria-hidden="true" />
        <span>
          {connectionState === 'idle' && 'Listo para conectar'}
          {connectionState === 'connecting' && 'Conectando con el tracker…'}
          {connectionState === 'waiting' && 'Esperando al otro dispositivo…'}
          {connectionState === 'authenticating' && (connectionDetail || 'Verificando la identidad del otro dispositivo…')}
          {connectionState === 'connected' && (connectionDetail || 'Dispositivos autenticados y conectados directamente')}
          {connectionState === 'error' && (connectionDetail || 'No se pudo establecer la conexión')}
        </span>
        {peerFingerprint && <small className="peer-fingerprint">Huella: {peerFingerprint}</small>}
      </section>
      <section className="catalog-panel" aria-labelledby="catalog-title">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">Después de autenticar</p>
            <h2 id="catalog-title">Catálogo de archivos</h2>
          </div>
          <label className={`file-button${connectionState === 'connected' ? '' : ' file-button-disabled'}`}>
            Añadir archivo
            <input type="file" onChange={addFile} disabled={connectionState !== 'connected'} />
          </label>
        </div>
        <p className="catalog-description">
          {connectionState === 'connected'
            ? 'Los nuevos archivos aparecen automáticamente en el otro dispositivo.'
            : 'Autentica ambos dispositivos para habilitar el catálogo compartido.'}
        </p>
        {catalogError && <p className="catalog-error" role="alert">{catalogError}</p>}
        {catalog.length === 0 ? (
          <p className="catalog-empty">Todavía no hay archivos en el catálogo.</p>
        ) : (
          <ul className="catalog-list">
            {catalog.map((entry) => (
              <li className="catalog-item" key={entry.id}>
                <span className="file-icon" aria-hidden="true">□</span>
                <span className="file-details">
                  <strong>{entry.name}</strong>
                  <small>{formatSize(entry.size)} · {entry.owner === 'local' ? 'En este dispositivo' : 'Del otro dispositivo'}</small>
                </span>
                <span className={`file-state${entry.available ? ' file-state-ready' : ''}`}>
                  {entry.available ? 'Disponible' : 'Pendiente'}
                  {entry.sharedWith && <small> · {entry.sharedWith}</small>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer className="privacy-note">
        <span aria-hidden="true">◈</span>
        <p>Los archivos viajan directamente entre tus dispositivos.<br />No se almacenan en ningún servidor.</p>
      </footer>
    </main>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Fingerprint({ label, value }: { label: string; value: string }) {
  return (
    <label className="fingerprint-field">
      <span>{label}</span>
      <input type="text" value={value || 'Pendiente de autenticación'} readOnly />
    </label>
  );
}

async function fingerprintFromText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12).toUpperCase();
}
