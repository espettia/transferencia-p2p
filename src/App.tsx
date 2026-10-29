import { ChangeEvent, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';
import './App.css';
import { ConnectionState, PeerConnection } from './peerConnection';
import { CatalogEntry, clearCatalog, deleteCatalogEntry, getLocalFile, listCatalog, markRemoteUnavailable, saveLocalFile, saveReceivedFile, saveRemoteEntry } from './catalog';

const INVITATION_KEY = 'transferencia-p2p-invitation';
const INVITATION_ROLE_KEY = 'transferencia-p2p-invitation-role';
const ROOM_CACHE_KEY = 'transferencia-p2p-last-room';
const ROOM_ROLE_CACHE_KEY = 'transferencia-p2p-last-room-role';

function createInvitation() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
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
  const [invitation, setInvitation] = useState(() => {
    const saved = window.localStorage.getItem(ROOM_CACHE_KEY)
      ?? window.sessionStorage.getItem(INVITATION_KEY);
    return saved && /^[0-9A-F]{36}$/i.test(saved) ? saved : createInvitation();
  });
  const [notice, setNotice] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionDetail, setConnectionDetail] = useState('');
  const [peerFingerprint, setPeerFingerprint] = useState('');
  const [localFingerprint, setLocalFingerprint] = useState('');
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [transferProgress, setTransferProgress] = useState<Record<string, number>>({});
  const [roomEntryOpen, setRoomEntryOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const peerRef = useRef<PeerConnection | null>(null);

  useEffect(() => {
    void listCatalog().then(setCatalog).catch(() => setCatalogError('No se pudo abrir el catálogo local.'));
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(INVITATION_KEY, invitation);
    window.localStorage.setItem(ROOM_CACHE_KEY, invitation);
  }, [invitation]);

  useEffect(() => {
    const roomId = invitation;
    const isGuest = (window.localStorage.getItem(ROOM_ROLE_CACHE_KEY)
      ?? window.sessionStorage.getItem(INVITATION_ROLE_KEY)) === 'guest';
    let disposed = false;
    let retryTimer: number | undefined;
    const peer = new PeerConnection(roomId, !isGuest, (state, detail) => {
      setConnectionState(state);
      setConnectionDetail(detail ?? '');
      if (state === 'connected' || state === 'swarm') setCatalogOpen(true);
      if (state === 'error' && !disposed) {
        retryTimer = window.setTimeout(() => setReconnectAttempt((attempt) => attempt + 1), 2500);
      }
    }, setPeerFingerprint, setLocalFingerprint, (entry) => {
      void saveRemoteEntry(entry).then(async () => setCatalog(await listCatalog()))
        .catch(() => setCatalogError('No se pudo actualizar el catálogo remoto.'));
    }, async (id) => getLocalFile(id), async (entry, blob) => {
      await saveReceivedFile(entry, blob);
      setCatalog(await listCatalog());
      downloadFile(blob, entry.name);
      setNotice(`"${entry.name}" se guardó en las descargas del dispositivo.`);
      window.setTimeout(() => setNotice(''), 3000);
    }, (id, progress) => {
      setTransferProgress((current) => ({ ...current, [id]: progress }));
    }, (peerId) => {
      void markRemoteUnavailable().then(async () => setCatalog(await listCatalog()))
        .catch(() => setCatalogError('No se pudo actualizar la disponibilidad del catálogo.'));
    });
    peerRef.current = peer;
    void peer.connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      peer.close();
      peerRef.current = null;
    };
  }, [invitation, reconnectAttempt]);

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
        if (!active) return;
        const token = result.data.trim();
        if (!/^[0-9A-F]{36}$/i.test(token)) {
          setCameraError('El QR no contiene una huella de sesión válida.');
          return;
        }
        window.sessionStorage.setItem(INVITATION_KEY, token.toUpperCase());
        window.sessionStorage.setItem(INVITATION_ROLE_KEY, 'guest');
        window.localStorage.setItem(ROOM_CACHE_KEY, token.toUpperCase());
        window.localStorage.setItem(ROOM_ROLE_CACHE_KEY, 'guest');
        window.location.reload();
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
      setNotice('Huella copiada');
    } catch {
      setNotice('No se pudo copiar la huella');
    }
    window.setTimeout(() => setNotice(''), 2200);
  };

  const startCamera = async () => {
    setCameraError('');
    setRoomEntryOpen(true);
    setCameraOpen(true);
  };

  const closeCamera = () => {
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
    setCameraOpen(false);
  };

  const pasteInvitation = async () => {
    const value = window.prompt('Pega aquí la huella de sesión');
    if (!value) return;
    try {
      const token = value.trim();
      if (!/^[0-9A-F]{36}$/i.test(token)) throw new Error('invalid fingerprint');
      window.sessionStorage.setItem(INVITATION_KEY, token.toUpperCase());
      window.sessionStorage.setItem(INVITATION_ROLE_KEY, 'guest');
      window.localStorage.setItem(ROOM_CACHE_KEY, token.toUpperCase());
      window.localStorage.setItem(ROOM_ROLE_CACHE_KEY, 'guest');
      window.location.reload();
    } catch {
      setNotice('La huella no es válida');
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

  const removeFile = async (entry: CatalogEntry) => {
    try {
      await deleteCatalogEntry(entry.id);
      setCatalog(await listCatalog());
      setNotice(`"${entry.name}" se eliminó del catálogo.`);
      window.setTimeout(() => setNotice(''), 3000);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'No se pudo eliminar el archivo.');
    }
  };

  const requestFile = (entry: CatalogEntry) => {
    if (!peerRef.current || connectionState !== 'connected') return;
    try {
      setTransferProgress((current) => ({ ...current, [entry.id]: 0 }));
      peerRef.current.requestFile(entry.id);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'No se pudo solicitar el archivo.');
    }
  };

  const createNewRoom = async () => {
    try {
      await clearCatalog();
      window.localStorage.removeItem(ROOM_CACHE_KEY);
      window.localStorage.removeItem(ROOM_ROLE_CACHE_KEY);
      window.sessionStorage.removeItem(INVITATION_KEY);
      window.sessionStorage.removeItem(INVITATION_ROLE_KEY);
      window.location.reload();
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'No se pudo crear una sala nueva.');
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <button className="header-qr" type="button" onClick={() => setCatalogOpen(true)} aria-label="Mostrar código QR de esta sala">
          <QrCode value={invitation} />
        </button>
        <div className="header-actions">
          <button className="new-room-button" type="button" onClick={createNewRoom} disabled={catalog.length === 0}>Nueva sala</button>
          <button className="access-room-button" type="button" onClick={startCamera}>Acceder a sala</button>
        </div>
      </header>

      {roomEntryOpen && <section className="pairing-grid initial-pairing" aria-label="Acceder a otra sala">
        <article className="pairing-card own-card">
          <div className="card-heading">
            <span className="step-badge">01</span>
            <div>
              <p className="card-kicker">Tu dispositivo</p>
              <h3>Mi QR</h3>
            </div>
          </div>
          <div className="qr-area"><QrCode value={invitation} /></div>
          <p className="card-description">Esta es tu sala actual</p>
          <p className="device-fingerprint">Huella: {localFingerprint || 'Registrando sesión'}</p>
          <button className="text-button" type="button" onClick={copyInvitation}>Copiar huella de sesión</button>
        </article>

        {roomEntryOpen && <div className="connector" aria-hidden="true">
          <span />
          <strong>o</strong>
          <span />
        </div>}

        {roomEntryOpen && <article className="pairing-card scan-card">
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
          <p className="card-description">{cameraError || (cameraOpen ? 'Apunta a la huella QR del otro dispositivo' : 'Escanea la huella QR del otro dispositivo')}</p>
          {cameraOpen ? (
            <button className="secondary-button" type="button" onClick={closeCamera}>Cerrar cámara</button>
          ) : (
            <button className="primary-button" type="button" onClick={startCamera}>Activar cámara <span>→</span></button>
          )}
          <button className="text-button" type="button" onClick={pasteInvitation}>Pegar huella</button>
        </article>}
      </section>}

      <p className={`notice${notice ? ' notice-visible' : ''}`} role="status">{notice}</p>
      <section className={`connection-status connection-${connectionState}`} aria-live="polite">
        <span className="connection-dot" aria-hidden="true" />
        <span>
          {connectionState === 'idle' && 'Listo para conectar'}
          {connectionState === 'connecting' && 'Conectando con el tracker…'}
          {connectionState === 'swarm' && 'Sesión activa en el swarm'}
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
            <p className="eyebrow">Sala actual</p>
            <h2 id="catalog-title">Catálogo de archivos</h2>
          </div>
          <label className="file-button">
            Añadir archivo
            <input type="file" onChange={addFile} />
          </label>
        </div>
        <p className="catalog-description">
          Los archivos se guardan en este dispositivo y se anuncian al conectar otra sesión.
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
                <button className="remove-button" type="button" onClick={() => removeFile(entry)}>Eliminar</button>
                {entry.owner === 'remote' && !entry.available && (
                  <button
                    className="transfer-button"
                    type="button"
                    onClick={() => requestFile(entry)}
                    disabled={transferProgress[entry.id] !== undefined && transferProgress[entry.id] < 100}
                  >
                    {transferProgress[entry.id] !== undefined && transferProgress[entry.id] < 100
                      ? `${Math.round(transferProgress[entry.id])}%`
                      : 'Transferir'}
                  </button>
                )}
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

function downloadFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
